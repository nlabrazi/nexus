import { isAbsolute, resolve } from 'path';
import { assertSameWorkspace, WorkspaceIdentity, WorkspaceValidator } from '../workspace/guard';
import { AntigravityClient, AntigravityClientOptions } from './client';
import { AntigravityError } from './errors';
import { AntigravityModelPreferences } from './model-preferences';
import { AntigravitySessionPersistence } from './persistence';
import {
  AntigravityServiceStatus,
  AntigravitySession,
  ModelMenu,
  ModelSelection,
} from './types';

type SessionAction = 'ensure' | 'new' | 'resume';

export class AntigravityService {
  private readonly client: AntigravityClient;
  private sessionId?: string;
  private workspacePath?: string;
  private workspaceIdentity?: WorkspaceIdentity;
  private sessionConnection?: number;
  private turnRunning = false;
  private workspaceOperation = false;
  private modelChanging = false;
  private modelSelection?: ModelSelection;
  private modelRevision = 0;
  private generation = 0;
  private sessionOperation?: { key: string; promise: Promise<string> };

  constructor(
    private readonly validateWorkspace?: WorkspaceValidator,
    private readonly persistence?: AntigravitySessionPersistence,
    private readonly modelPreferences?: AntigravityModelPreferences,
    options?: AntigravityClientOptions
  ) {
    this.client = new AntigravityClient(options);
    this.modelSelection = modelPreferences?.load();
    const saved = persistence?.load();
    if (saved) {
      this.sessionId = saved.id;
      this.workspacePath = saved.workspace.root;
      this.workspaceIdentity = saved.workspace;
    }
  }

  startSession(cwd: string): Promise<string> {
    return this.changeSession('ensure', cwd);
  }

  newSession(cwd: string): Promise<string> {
    return this.changeSession('new', cwd);
  }

  resumeSession(cwd: string, sessionId: string): Promise<string> {
    return this.changeSession('resume', cwd, sessionId);
  }

  async refreshStatus(): Promise<void> {
    // Antigravity telemetry updates are pushed via NDJSON events on stdout
  }

  async withWorkspaceOperation<T>(operation: () => Promise<T>): Promise<T> {
    if (this.workspaceOperation || this.turnRunning || this.sessionOperation || this.modelChanging) {
      throw new Error(
        'Une opération Git ou Antigravity est en cours. Attendez sa fin avant de changer de branche.'
      );
    }
    this.workspaceOperation = true;
    try {
      return await operation();
    } finally {
      this.workspaceOperation = false;
    }
  }

  private modelContext(path: string): string {
    return JSON.stringify([
      this.normalizeWorkspace(path),
      this.generation,
      this.sessionId,
      this.workspaceIdentity,
      this.modelRevision,
    ]);
  }

  async listModels(path: string): Promise<ModelMenu> {
    const context = this.modelContext(path);
    const generation = this.generation;
    const models = await this.client.listModels();
    this.assertCurrent(generation);
    if (context !== this.modelContext(path)) {
      throw new Error('Le contexte a changé. Rouvrez /model.');
    }
    const telemetry = this.sessionId
      ? this.client.getConversationTelemetry(this.sessionId)
      : undefined;
    return {
      models,
      context,
      selected: this.modelSelection
        ? { ...this.modelSelection }
        : telemetry?.model
        ? { model: telemetry.model, effort: telemetry.reasoningEffort ?? '' }
        : undefined,
    };
  }

  async selectModel(path: string, selection: ModelSelection, context: string): Promise<void> {
    if (this.turnRunning || this.sessionOperation || this.workspaceOperation || this.modelChanging) {
      throw new Error('Une opération Git ou Antigravity est en cours. Attendez sa fin puis rouvrez /model.');
    }
    if (context !== this.modelContext(path)) {
      throw new Error('Le contexte a changé. Rouvrez /model.');
    }
    this.modelChanging = true;
    try {
      const menu = await this.listModels(path);
      if (menu.context !== context) {
        throw new Error('Le contexte a changé. Rouvrez /model.');
      }
      const model = menu.models.find(m => m.model === selection.model);
      if (
        !model ||
        !model.supportedReasoningEfforts.some(opt => opt.reasoningEffort === selection.effort)
      ) {
        throw new Error('Ce modèle ou cet effort n’est plus disponible. Rouvrez /model.');
      }
      await this.modelPreferences?.save(selection);
      this.modelSelection = { ...selection };
      this.modelRevision++;
    } finally {
      this.modelChanging = false;
    }
  }

  private async changeSession(
    action: SessionAction,
    cwd: string,
    sessionId?: string
  ): Promise<string> {
    if (this.modelChanging) {
      throw new Error('Un changement de modèle est en cours. Attendez sa fin.');
    }
    if (this.workspaceOperation) {
      throw new Error('Un changement de branche est en cours. Attendez sa fin.');
    }
    const path = this.normalizeWorkspace(cwd);
    const id = sessionId?.trim();
    if (action === 'resume' && (!id || /\s/.test(id))) {
      throw new Error('Indiquez un identifiant de session valide : /resume <id>.');
    }
    if (this.turnRunning) {
      throw new Error('Un turn Antigravity est en cours. Attendez sa fin avant de changer de session.');
    }
    const key = JSON.stringify([action, path, id]);
    if (this.sessionOperation) {
      if (action !== 'new' && this.sessionOperation.key === key) {
        return await this.sessionOperation.promise;
      }
      throw new Error('Une opération de session Antigravity est déjà en cours.');
    }
    const generation = this.generation;
    const operation = {
      key,
      promise: Promise.resolve().then(() => this.selectSession(action, path, generation, id)),
    };
    this.sessionOperation = operation;
    try {
      return await operation.promise;
    } finally {
      if (this.sessionOperation === operation) {
        this.sessionOperation = undefined;
      }
    }
  }

  private async selectSession(
    action: SessionAction,
    path: string,
    generation: number,
    id?: string
  ): Promise<string> {
    this.assertCurrent(generation);
    const workspace = this.validateWorkspace ? await this.validateWorkspace(path) : undefined;
    this.assertCurrent(generation);
    path = workspace?.root ?? path;

    if (action === 'ensure' && this.sessionId && this.workspacePath !== path) {
      throw new Error(
        'La session appartient à un autre workspace. Utilisez /new ou /resume <id> explicitement.'
      );
    }
    if (action === 'ensure' && this.sessionId) {
      assertSameWorkspace(this.workspaceIdentity, workspace);
    }

    const targetId = action === 'resume' ? id : action === 'ensure' ? this.sessionId : undefined;
    if (targetId === this.sessionId && this.workspacePath === path && this.isSessionActive()) {
      this.workspaceIdentity = workspace;
      await this.persistSelection(generation);
      return targetId!;
    }

    // Start or restart process if necessary
    const conversationId = await this.client.start({
      cwd: path,
      conversationId: targetId,
      selection: this.modelSelection,
      forceNew: action === 'new',
    });
    this.assertCurrent(generation);

    const connection = this.client.getConnectionId();
    if (connection === undefined) {
      throw new Error('Le processus Antigravity est indisponible.');
    }

    if (this.validateWorkspace) {
      assertSameWorkspace(workspace, await this.validateWorkspace(path));
      this.assertCurrent(generation, connection);
    }

    this.sessionId = conversationId;
    this.workspacePath = path;
    this.workspaceIdentity = workspace;
    this.sessionConnection = connection;
    await this.persistSelection(generation);
    return conversationId;
  }

  private async persistSelection(generation: number): Promise<void> {
    if (!this.persistence || !this.sessionId || !this.workspaceIdentity) {
      return;
    }
    try {
      await this.persistence.save({
        version: 1,
        id: this.sessionId,
        workspace: this.workspaceIdentity,
      });
    } catch (error) {
      this.assertCurrent(generation);
      throw new Error(
        'La session est sélectionnée, mais sa sauvegarde a échoué. Aucun nouveau prompt n’a été lancé. Vérifiez le stockage de VS Code puis réessayez.',
        { cause: error }
      );
    }
    this.assertCurrent(generation, this.sessionConnection);
  }

  private normalizeWorkspace(cwd: string): string {
    if (!cwd.trim() || !isAbsolute(cwd)) {
      throw new Error('Un chemin de workspace absolu est requis.');
    }
    return resolve(cwd);
  }

  private assertCurrent(generation: number, connection?: number): void {
    if (
      this.generation !== generation ||
      (connection !== undefined && this.client.getConnectionId() !== connection)
    ) {
      throw new Error('Opération Antigravity annulée : le processus a été arrêté ou remplacé.');
    }
  }

  async sendPrompt(
    prompt: string,
    cwd = this.workspacePath,
    onFilesChanged?: (paths: readonly string[]) => void
  ): Promise<string> {
    if (!prompt.trim()) {
      throw new Error('Antigravity prompt cannot be empty');
    }
    if (!cwd) {
      throw new Error('No active Antigravity session.');
    }
    const path = this.normalizeWorkspace(cwd);
    if (this.turnRunning || this.sessionOperation || this.workspaceOperation || this.modelChanging) {
      throw new Error('An Antigravity turn or session operation is already running.');
    }

    this.turnRunning = true;
    const generation = this.generation;
    try {
      const id = await this.selectSession('ensure', path, generation);
      this.assertCurrent(generation);
      if (this.validateWorkspace) {
        assertSameWorkspace(this.workspaceIdentity, await this.validateWorkspace(path));
        this.assertCurrent(generation);
      }
      return await this.client.runTurn(id, prompt, onFilesChanged);
    } catch (error) {
      if (
        this.generation === generation &&
        error instanceof AntigravityError &&
        error.code === 'session_lost'
      ) {
        this.sessionConnection = undefined;
      }
      throw error;
    } finally {
      if (this.generation === generation) {
        this.turnRunning = false;
      }
    }
  }

  getCurrentSessionId(): string | undefined {
    return this.sessionId;
  }

  isSessionActive(): boolean {
    return (
      this.sessionId !== undefined &&
      this.sessionConnection !== undefined &&
      this.sessionConnection === this.client.getConnectionId()
    );
  }

  isTurnRunning(): boolean {
    return this.turnRunning;
  }

  getStatus(): AntigravityServiceStatus {
    return {
      ...this.client.getStatus(),
      ...(this.sessionId ? this.client.getConversationTelemetry(this.sessionId) : {}),
      ...(this.modelSelection ? { modelSelection: { ...this.modelSelection } } : {}),
      ...(this.modelChanging ? { modelChanging: true } : {}),
      ...(this.workspaceOperation ? { branchChanging: true } : {}),
      sessionId: this.sessionId,
      workspacePath: this.workspacePath,
      ...(this.workspaceIdentity?.git ? { sessionBranch: this.workspaceIdentity.git.branch } : {}),
      sessionActive: this.isSessionActive(),
      sessionChanging: this.sessionOperation !== undefined,
    };
  }

  cancelCurrentWork(): boolean {
    if (!this.turnRunning && !this.sessionOperation) {
      return false;
    }
    this.generation++;
    this.sessionOperation = undefined;
    this.client.stop();
    this.sessionConnection = undefined;
    this.turnRunning = false;
    return true;
  }

  stop(): void {
    this.generation++;
    this.sessionOperation = undefined;
    this.client.stop();
    this.sessionId = undefined;
    this.workspacePath = undefined;
    this.workspaceIdentity = undefined;
    this.sessionConnection = undefined;
    this.turnRunning = false;
  }
}
