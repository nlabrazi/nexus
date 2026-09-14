import { isAbsolute, resolve } from 'path';
import { CodexClient } from './client';
import { CodexApprovalHandler, CodexServiceStatus, CodexThread } from './types';
import { CodexError } from './errors';
import { assertSameWorkspace, WorkspaceIdentity, WorkspaceValidator } from '../workspace/guard';
import { SessionPersistence } from './persistence';

type SessionAction = 'ensure' | 'new' | 'resume';

export class CodexService {
  private readonly client: CodexClient;
  private sessionId?: string;
  private workspacePath?: string;
  private workspaceIdentity?: WorkspaceIdentity;
  private sessionConnection?: number;
  private turnRunning = false;
  private workspaceOperation = false;
  private generation = 0;
  private sessionOperation?: { key: string; promise: Promise<string> };

  constructor(approvalHandler?: CodexApprovalHandler, private readonly validateWorkspace?: WorkspaceValidator,
    private readonly persistence?: SessionPersistence) {
    this.client = new CodexClient(approvalHandler);
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

  async withWorkspaceOperation<T>(operation: () => Promise<T>): Promise<T> {
    if (this.workspaceOperation || this.turnRunning || this.sessionOperation) {
      throw new Error('Une opération Git ou Codex est en cours. Attendez sa fin avant de changer de branche.');
    }
    this.workspaceOperation = true;
    try { return await operation(); }
    finally { this.workspaceOperation = false; }
  }

  private async changeSession(action: SessionAction, cwd: string, sessionId?: string): Promise<string> {
    if (this.workspaceOperation) { throw new Error('Un changement de branche est en cours. Attendez sa fin.'); }
    const path = this.normalizeWorkspace(cwd);
    const id = sessionId?.trim();
    if (action === 'resume' && (!id || /\s/.test(id))) {
      throw new Error('Indiquez un identifiant de session valide : /resume <id>.');
    }
    if (this.turnRunning) {
      throw new Error('Un turn Codex est en cours. Attendez sa fin avant de changer de session.');
    }
    const key = JSON.stringify([action, path, id]);
    if (this.sessionOperation) {
      // Repeated "ensure/resume" joins the same operation; "new" is never queued.
      if (action !== 'new' && this.sessionOperation.key === key) {
        return await this.sessionOperation.promise;
      }
      throw new Error('Une opération de session Codex est déjà en cours.');
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

  private async selectSession(action: SessionAction, path: string, generation: number, id?: string): Promise<string> {
    this.assertCurrent(generation);
    const workspace = this.validateWorkspace ? await this.validateWorkspace(path) : undefined;
    this.assertCurrent(generation);
    path = workspace?.root ?? path;
    if (action === 'ensure' && this.sessionId && this.workspacePath !== path) {
      throw new Error('La session appartient à un autre workspace. Utilisez /new ou /resume <id> explicitement.');
    }
    if (action === 'ensure' && this.sessionId) {
      assertSameWorkspace(this.workspaceIdentity, workspace);
    }
    const targetId = action === 'resume' ? id : action === 'ensure' ? this.sessionId : undefined;
    if (targetId === this.sessionId && this.workspacePath === path && this.isSessionActive()) {
      // Explicit resume can deliberately bind the same conversation to a new branch.
      this.workspaceIdentity = workspace;
      await this.persistSelection(generation);
      return targetId!;
    }

    await this.client.start();
    this.assertCurrent(generation);
    const connection = this.client.getConnectionId();
    if (connection === undefined) {
      throw new Error('Le processus Codex est indisponible.');
    }
    let thread: CodexThread;
    if (targetId) {
      // Inspect the saved workspace before applying any resume overrides.
      try {
        const metadata = await this.client.readSession(targetId);
        this.assertCurrent(generation, connection);
        this.checkThread(metadata.thread, path, targetId);
        thread = (await this.client.resumeSession(targetId, path)).thread;
      } catch (error) {
        if (targetId === this.sessionId && error instanceof CodexError && error.code === 'session_lost') {
          this.sessionConnection = undefined;
        }
        throw error;
      }
    } else {
      thread = (await this.client.startSession(path)).thread;
    }
    this.assertCurrent(generation, connection);
    this.checkThread(thread, path, targetId);
    if (this.validateWorkspace) {
      assertSameWorkspace(workspace, await this.validateWorkspace(path));
      this.assertCurrent(generation, connection);
    }
    // Commit the selection only after success; a failed resume keeps the old one.
    this.sessionId = thread.id;
    this.workspacePath = path;
    this.workspaceIdentity = workspace;
    this.sessionConnection = connection;
    await this.persistSelection(generation);
    return thread.id;
  }

  private async persistSelection(generation: number): Promise<void> {
    if (!this.persistence || !this.sessionId || !this.workspaceIdentity) { return; }
    try {
      await this.persistence.save({ version: 1, id: this.sessionId, workspace: this.workspaceIdentity });
    } catch (error) {
      this.assertCurrent(generation);
      throw new Error('La session est sélectionnée, mais sa sauvegarde a échoué. Aucun nouveau prompt n’a été lancé. Vérifiez le stockage de VS Code puis réessayez.', { cause: error });
    }
    this.assertCurrent(generation, this.sessionConnection);
  }

  private checkThread(thread: CodexThread, path: string, expectedId?: string): void {
    if (!thread || typeof thread.id !== 'string' || !thread.id.trim() ||
      (expectedId !== undefined && thread.id !== expectedId)) {
      throw new Error('Codex a renvoyé une session invalide.');
    }
    if (typeof thread.cwd !== 'string' || !isAbsolute(thread.cwd) || resolve(thread.cwd) !== path) {
      throw new Error('Le workspace de cette session ne correspond pas au workspace ciblé.');
    }
    if (thread.status?.type === 'active' || thread.status?.type === 'systemError') {
      throw new Error('Cette session Codex est occupée ou en erreur ; elle ne peut pas être reprise.');
    }
  }

  private normalizeWorkspace(cwd: string): string {
    if (!cwd.trim() || !isAbsolute(cwd)) {
      throw new Error('Un chemin de workspace absolu est requis.');
    }
    return resolve(cwd);
  }

  private assertCurrent(generation: number, connection?: number): void {
    if (this.generation !== generation ||
      (connection !== undefined && this.client.getConnectionId() !== connection)) {
      throw new Error('Opération Codex annulée : le processus a été arrêté ou remplacé.');
    }
  }

  async sendPrompt(prompt: string, cwd = this.workspacePath, onFilesChanged?: (paths: readonly string[]) => void): Promise<string> {
    if (!prompt.trim()) {
      throw new Error('Codex prompt cannot be empty');
    }
    if (!cwd) {
      throw new Error('No active Codex session.');
    }
    const path = this.normalizeWorkspace(cwd);
    if (this.turnRunning || this.sessionOperation || this.workspaceOperation) {
      throw new Error('A Codex turn or session operation is already running.');
    }
    // Reserve the whole request, including session startup, before the first await.
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
      if (this.generation === generation && error instanceof CodexError && error.code === 'session_lost') {
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
    return this.sessionId !== undefined && this.sessionConnection !== undefined &&
      this.sessionConnection === this.client.getConnectionId();
  }

  isTurnRunning(): boolean {
    return this.turnRunning;
  }

  getStatus(): CodexServiceStatus {
    return {
      ...this.client.getStatus(),
      sessionId: this.sessionId,
      workspacePath: this.workspacePath,
      ...(this.workspaceIdentity?.git ? { sessionBranch: this.workspaceIdentity.git.branch } : {}),
      sessionActive: this.isSessionActive(),
      sessionChanging: this.sessionOperation !== undefined,
    };
  }

  cancelCurrentWork(): boolean {
    if (!this.turnRunning && !this.sessionOperation) { return false; }
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
