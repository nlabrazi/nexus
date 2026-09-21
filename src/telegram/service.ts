import type * as vscode from 'vscode';
import { randomInt } from 'crypto';
import { TelegramClient } from './client';
import { TelegramUpdate } from './types';
import { TelegramApprovals, TelegramPeer } from './approvals';
import { ApprovalDecision, CodexApprovalRequest, ModelControls } from '../codex/types';
import { formatTelegramStatus, NexusStatusSnapshot, AgentBackendType } from './status';
import { TELEGRAM_HELP } from './help';
import { TelegramModels } from './models';

export interface RemotePromptReply { text: string; fileSummary?: string }

type RemotePromptHandler = (
  prompt: string
) => Promise<string | RemotePromptReply>;

export type RemoteSessionAction = { type: 'new' } | { type: 'resume'; sessionId: string };
export type RemoteBranchAction = { type: 'list' } | { type: 'switch'; name: string };

export interface TelegramServiceOptions {
  onRemotePrompt?: RemotePromptHandler;
  getStatus?: () => NexusStatusSnapshot | Promise<NexusStatusSnapshot>;
  onSessionAction?: (action: RemoteSessionAction) => Promise<string>;
  onStop?: () => boolean;
  onBranchAction?: (action: RemoteBranchAction) => Promise<string>;
  modelControls?: ModelControls;
  onRemoteAntigravityPrompt?: RemotePromptHandler;
  onAntigravitySessionAction?: (action: RemoteSessionAction) => Promise<string>;
  antigravityModelControls?: ModelControls;
  onAntigravityStop?: () => boolean;
  getActiveBackend?: () => AgentBackendType;
  setActiveBackend?: (backend: AgentBackendType) => Promise<void> | void;
}

export class TelegramService {
  private pairingCode?: string;
  private pairingExpiresAt = 0;
  private running = false;
  private abortController?: AbortController;
  private remotePromptRunning = false;
  private remoteSessionRunning = false;
  private remoteBranchRunning = false;
  private operationGeneration = 0;
  private readonly approvals: TelegramApprovals;
  private readonly models: TelegramModels;
  private readonly antigravityModels: TelegramModels;
  private statusRunning = false;

  private readonly onRemotePrompt?: RemotePromptHandler;
  private readonly getStatus?: () => NexusStatusSnapshot | Promise<NexusStatusSnapshot>;
  private readonly onSessionAction?: (action: RemoteSessionAction) => Promise<string>;
  private readonly onStop?: () => boolean;
  private readonly onBranchAction?: (action: RemoteBranchAction) => Promise<string>;
  private readonly onRemoteAntigravityPrompt?: RemotePromptHandler;
  private readonly onAntigravitySessionAction?: (action: RemoteSessionAction) => Promise<string>;
  private readonly onAntigravityStop?: () => boolean;
  private readonly customGetActiveBackend?: () => AgentBackendType;
  private readonly customSetActiveBackend?: (backend: AgentBackendType) => Promise<void> | void;
  private activeBackend: AgentBackendType = 'codex';

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly client: TelegramClient,
    onRemotePromptOrOptions?: RemotePromptHandler | TelegramServiceOptions,
    getStatus?: () => NexusStatusSnapshot | Promise<NexusStatusSnapshot>,
    onSessionAction?: (action: RemoteSessionAction) => Promise<string>,
    onStop?: () => boolean,
    onBranchAction?: (action: RemoteBranchAction) => Promise<string>,
    modelControls?: ModelControls,
    onRemoteAntigravityPrompt?: RemotePromptHandler,
    onAntigravitySessionAction?: (action: RemoteSessionAction) => Promise<string>,
    antigravityModelControls?: ModelControls,
    onAntigravityStop?: () => boolean,
    getActiveBackend?: () => AgentBackendType,
    setActiveBackend?: (backend: AgentBackendType) => Promise<void> | void
  ) {
    let codexModelControls: ModelControls | undefined;
    let agyModelControls: ModelControls | undefined;

    if (typeof onRemotePromptOrOptions === 'object' && onRemotePromptOrOptions !== null) {
      const opts = onRemotePromptOrOptions;
      this.onRemotePrompt = opts.onRemotePrompt;
      this.getStatus = opts.getStatus;
      this.onSessionAction = opts.onSessionAction;
      this.onStop = opts.onStop;
      this.onBranchAction = opts.onBranchAction;
      codexModelControls = opts.modelControls;
      this.onRemoteAntigravityPrompt = opts.onRemoteAntigravityPrompt;
      this.onAntigravitySessionAction = opts.onAntigravitySessionAction;
      agyModelControls = opts.antigravityModelControls;
      this.onAntigravityStop = opts.onAntigravityStop;
      this.customGetActiveBackend = opts.getActiveBackend;
      this.customSetActiveBackend = opts.setActiveBackend;
    } else {
      this.onRemotePrompt = onRemotePromptOrOptions;
      this.getStatus = getStatus;
      this.onSessionAction = onSessionAction;
      this.onStop = onStop;
      this.onBranchAction = onBranchAction;
      codexModelControls = modelControls;
      this.onRemoteAntigravityPrompt = onRemoteAntigravityPrompt;
      this.onAntigravitySessionAction = onAntigravitySessionAction;
      agyModelControls = antigravityModelControls;
      this.onAntigravityStop = onAntigravityStop;
      this.customGetActiveBackend = getActiveBackend;
      this.customSetActiveBackend = setActiveBackend;
    }

    this.activeBackend = this.context.globalState.get<AgentBackendType>('nexus.activeBackend') ?? 'codex';

    this.approvals = new TelegramApprovals(client, () => this.getApprovalPeer());
    this.models = new TelegramModels(
      client,
      () => this.getApprovalPeer(),
      codexModelControls,
      () => this.remotePromptRunning || this.remoteSessionRunning || this.remoteBranchRunning,
      'Codex',
      'codex'
    );
    this.antigravityModels = new TelegramModels(
      client,
      () => this.getApprovalPeer(),
      agyModelControls,
      () => this.remotePromptRunning || this.remoteSessionRunning || this.remoteBranchRunning,
      'Antigravity',
      'antigravity'
    );
  }

  getActiveBackend(): AgentBackendType {
    if (this.customGetActiveBackend) {
      return this.customGetActiveBackend();
    }
    return this.context.globalState.get<AgentBackendType>('nexus.activeBackend') ?? this.activeBackend;
  }

  async setBackend(backend: AgentBackendType): Promise<void> {
    this.activeBackend = backend;
    await this.context.globalState.update('nexus.activeBackend', backend);
    if (this.customSetActiveBackend) {
      await this.customSetActiveBackend(backend);
    }
  }

  requestApproval(request: CodexApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision> {
    return this.approvals.request(request, signal);
  }

  private getApprovalPeer(): TelegramPeer | undefined {
    const userId = this.context.globalState.get<number>('nexus.telegram.allowedUserId');
    const chatId = this.context.globalState.get<number>('nexus.telegram.allowedChatId');
    return this.running && userId !== undefined && chatId !== undefined
      ? { userId, chatId } : undefined;
  }

  createPairingCode(): string {
    this.pairingCode = randomInt(100000, 1000000).toString();
    this.pairingExpiresAt = Date.now() + 2 * 60 * 1000;

    return this.pairingCode;
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    const controller = new AbortController();
    this.abortController = controller;

    let offset = this.context.globalState.get<number>(
      'nexus.telegram.updateOffset',
      0
    );

    try {
      while (!controller.signal.aborted) {
        try {
          const data = await this.client.getUpdates(
            offset,
            controller.signal
          );

          for (const update of data.result) {
            if (controller.signal.aborted) {
              break;
            }
            // A stale batch or repeated update must never replay a Codex action
            // or move the persisted offset backwards after a restart.
            if (update.update_id < offset) {
              continue;
            }
            offset = update.update_id + 1;

            await this.context.globalState.update(
              'nexus.telegram.updateOffset',
              offset
            );

            if (!controller.signal.aborted) {
              await this.handleUpdate(update);
            }
          }
        } catch (error) {
          if (controller.signal.aborted) {
            break;
          }

          this.approvals.cancelAll();
          this.models.cancel();
          this.antigravityModels.cancel();
          console.error('Telegram polling failed.');

          await new Promise(resolve =>
            setTimeout(resolve, 3000)
          );
        }
      }
    } finally {
      if (this.abortController === controller) {
        this.abortController = undefined;
        this.running = false;
        this.approvals.cancelAll();
        this.models.cancel();
        this.antigravityModels.cancel();
      }
    }
  }

  stop(): void {
    this.models.cancel();
    this.antigravityModels.cancel();
    this.running = false;
    this.abortController?.abort();
    this.approvals.cancelAll();
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) {
      if (update.callback_query.data?.startsWith('model:')) {
        if (this.models.hasActiveMenu()) {
          void this.models.handleCallback(update.callback_query);
        } else if (this.antigravityModels.hasActiveMenu()) {
          void this.antigravityModels.handleCallback(update.callback_query);
        } else {
          const picker = this.getActiveBackend() === 'antigravity' ? this.antigravityModels : this.models;
          void picker.handleCallback(update.callback_query);
        }
      } else { await this.approvals.handleCallback(update.callback_query); }
      return;
    }
    const text = update.message?.text;
    const voice = update.message?.voice;
    const userId = update.message?.from?.id;
    const chatId = update.message?.chat.id;
    const chatType = update.message?.chat.type;

    if (
      (!text && !voice) ||
      userId === undefined ||
      chatId === undefined
    ) {
      return;
    }

    // Pairing
    if (text?.startsWith('/pair ')) {
      const receivedCode = text.split(' ')[1];

      const isValid =
        this.pairingCode !== undefined &&
        receivedCode === this.pairingCode &&
        Date.now() < this.pairingExpiresAt &&
        chatType === 'private';

      if (!isValid) {
        return;
      }

      this.approvals.cancelAll();
      this.models.cancel();
      this.antigravityModels.cancel();

      await this.context.globalState.update(
        'nexus.telegram.allowedUserId',
        userId
      );

      await this.context.globalState.update(
        'nexus.telegram.allowedChatId',
        chatId
      );

      this.pairingCode = undefined;
      this.pairingExpiresAt = 0;

      await this.client.sendMessage(
        chatId,
        '✅ Nexus paired successfully.'
      );

      console.log('Telegram account paired.');

      return;
    }

    // Authorization
    const allowedUserId = this.context.globalState.get<number>(
      'nexus.telegram.allowedUserId'
    );

    const allowedChatId = this.context.globalState.get<number>(
      'nexus.telegram.allowedChatId'
    );

    if (
      userId !== allowedUserId ||
      chatId !== allowedChatId ||
      chatType !== 'private'
    ) {
      return;
    }

    if (voice) {
      await this.client.sendMessage(chatId,
        '🎙 Message vocal reçu. La transcription n’est pas encore disponible. Utilisez /codex <instruction> pour envoyer votre demande par écrit.');
      return;
    }

    if (!text) { return; }

    // Commands
    const command = text.trim();
    if (/^\/model(?:\s|$)/.test(command)) {
      if (command !== '/model') { await this.client.sendMessage(chatId, 'Usage : /model'); }
      else {
        const picker = this.getActiveBackend() === 'antigravity' ? this.antigravityModels : this.models;
        void picker.open();
      }
      return;
    }
    if (/^\/help(?:\s|$)/.test(command)) {
      await this.client.sendMessage(chatId, command === '/help' ? TELEGRAM_HELP : 'Usage : /help', 'markdown');
      return;
    }
    if (/^\/backend(?:\s|$)/.test(command)) {
      const parts = command.split(/\s+/);
      if (parts.length === 1) {
        const current = this.getActiveBackend();
        const other = current === 'antigravity' ? 'codex' : 'antigravity';
        const label = current === 'antigravity' ? '✨ Gemini Antigravity' : '🤖 Codex';
        await this.client.sendMessage(chatId, `Backend actif : ${label}.\nUtilisez /backend ${other} pour basculer.`);
        return;
      }
      if (parts.length === 2) {
        const target = parts[1].toLowerCase();
        if (target === 'codex') {
          await this.setBackend('codex');
          await this.client.sendMessage(chatId, '✅ Backend actif défini sur : 🤖 Codex.');
          return;
        }
        if (target === 'antigravity' || target === 'agy' || target === 'gemini') {
          await this.setBackend('antigravity');
          await this.client.sendMessage(chatId, '✅ Backend actif défini sur : ✨ Gemini Antigravity.');
          return;
        }
      }
      await this.client.sendMessage(chatId, 'Usage : /backend [codex|antigravity]');
      return;
    }
    if (/^\/(branches|switch)(?:\s|$)/.test(command)) {
      const [name, branch, ...extra] = command.split(/\s+/);
      if ((name === '/branches' && branch !== undefined) ||
        (name === '/switch' && (!branch || extra.length > 0))) {
        await this.client.sendMessage(chatId, name === '/branches' ? 'Usage : /branches' : 'Usage : /switch <branche>');
        return;
      }
      if (!this.onBranchAction) {
        await this.client.sendMessage(chatId, 'La gestion des branches est indisponible.');
        return;
      }
      if (this.remoteBranchRunning || (name === '/switch' && (this.remotePromptRunning || this.remoteSessionRunning))) {
        const backendName = this.getActiveBackend() === 'antigravity' ? 'Antigravity' : 'Codex';
        await this.client.sendMessage(chatId, `Une opération Git ou ${backendName} est en cours. Attendez sa fin.`);
        return;
      }
      this.remoteBranchRunning = true;
      if (name === '/switch') {
        this.models.cancel();
        this.antigravityModels.cancel();
      }
      void this.runBranchCommand(chatId, name === '/branches' ? { type: 'list' } : { type: 'switch', name: branch },
        this.abortController!.signal);
      return;
    }
    if (/^\/stop(?:\s|$)/.test(command)) {
      if (command !== '/stop') {
        await this.client.sendMessage(chatId, 'Usage : /stop');
        return;
      }
      if (!this.onStop && !this.onAntigravityStop) {
        await this.client.sendMessage(chatId, 'L’arrêt de Codex est indisponible.');
        return;
      }
      let cancelled: boolean;
      try {
        const codexCancelled = this.onStop ? this.onStop() : false;
        const agyCancelled = this.onAntigravityStop ? this.onAntigravityStop() : false;
        cancelled = codexCancelled || agyCancelled || this.remotePromptRunning || this.remoteSessionRunning;
      } catch {
        const name = this.getActiveBackend() === 'antigravity' ? 'Antigravity' : 'Codex';
        await this.client.sendMessage(chatId, `❌ Impossible de demander l’arrêt de ${name}. Vérifiez son état dans VS Code.`);
        return;
      }
      this.operationGeneration++;
      this.models.cancel();
      this.antigravityModels.cancel();
      this.remotePromptRunning = false;
      this.remoteSessionRunning = false;
      this.approvals.cancelAll();
      const agentName = this.getActiveBackend() === 'antigravity' ? 'Antigravity' : 'Codex';
      await this.client.sendMessage(chatId, cancelled
        ? `⏹ Requête annulée côté Nexus. Si ${agentName} était lancé, la connexion a été fermée et son arrêt demandé.\nL’arrêt des commandes enfants n’est pas garanti : vérifiez les commandes et fichiers avant de continuer.\nL’identifiant de la session sélectionnée est conservé, s’il existe.`
        : `⚪ Aucune requête ${agentName} en cours.`);
      return;
    }
    if (/^\/(new|resume)(?:\s|$)/.test(command)) {
      const [name, id, ...extra] = command.split(/\s+/);
      if ((name === '/new' && id !== undefined) ||
        (name === '/resume' && (!id || extra.length > 0))) {
        await this.client.sendMessage(chatId, name === '/new' ? 'Usage : /new' : 'Usage : /resume <id>');
        return;
      }
      const backend = this.getActiveBackend();
      const handler = backend === 'antigravity' ? this.onAntigravitySessionAction : this.onSessionAction;
      const backendName = backend === 'antigravity' ? 'Antigravity' : 'Codex';
      if (!handler) {
        await this.client.sendMessage(chatId, `La gestion des sessions ${backendName} est indisponible.`);
        return;
      }
      if (this.remotePromptRunning || this.remoteSessionRunning || this.remoteBranchRunning) {
        await this.client.sendMessage(chatId, `Une requête ${backendName} est déjà en cours. Attendez sa fin.`);
        return;
      }
      this.remoteSessionRunning = true;
      this.models.cancel();
      this.antigravityModels.cancel();
      const action: RemoteSessionAction = name === '/new' ? { type: 'new' } : { type: 'resume', sessionId: id };
      void this.runSessionCommand(chatId, action, backendName, handler, this.abortController!.signal);
      return;
    }

    if (text.trim() === '/status') {
      if (!this.statusRunning) { void this.runStatusCommand(chatId, this.abortController!.signal); }
      return;
    }

    if (text === '/ping') {
      await this.client.sendMessage(chatId, 'pong');
    }

    if (text === '/codex') {
      await this.client.sendMessage(
        chatId,
        'Usage: /codex <instruction>'
      );

      return;
    }

    if (text.startsWith('/codex ')) {
      const prompt = text.slice('/codex '.length).trim();

      if (!prompt) {
        await this.client.sendMessage(
          chatId,
          'Usage: /codex <instruction>'
        );

        return;
      }

      if (!this.onRemotePrompt) {
        await this.client.sendMessage(
          chatId,
          'Codex is unavailable.'
        );

        return;
      }

      if (this.remotePromptRunning || this.remoteSessionRunning || this.remoteBranchRunning) {
        await this.client.sendMessage(chatId, 'A Codex turn is already running.');
        return;
      }

      // Polling must continue while Codex waits for an approval callback.
      this.remotePromptRunning = true;
      void this.runRemotePrompt(chatId, prompt, this.abortController!.signal);
      return;
    }

    const isAgyMatch = /^\/(antigravity|agy|gemini)(?:\s|$)/.test(text);
    if (isAgyMatch) {
      const match = /^\/(antigravity|agy|gemini)(?:\s+([\s\S]*))?$/.exec(text);
      const cmd = match?.[1] ?? 'antigravity';
      const prompt = match?.[2]?.trim();

      if (!prompt) {
        await this.client.sendMessage(
          chatId,
          `Usage: /${cmd} <instruction>`
        );
        return;
      }

      if (!this.onRemoteAntigravityPrompt) {
        await this.client.sendMessage(
          chatId,
          'Gemini Antigravity is unavailable.'
        );
        return;
      }

      if (this.remotePromptRunning || this.remoteSessionRunning || this.remoteBranchRunning) {
        await this.client.sendMessage(chatId, 'An Antigravity turn is already running.');
        return;
      }

      this.remotePromptRunning = true;
      void this.runRemoteAntigravityPrompt(chatId, prompt, this.abortController!.signal);
      return;
    }
  }

  private async runStatusCommand(chatId: number, signal: AbortSignal): Promise<void> {
    this.statusRunning = true;
    const peer = this.getApprovalPeer();
    try {
      let status: string;
      try {
        if (this.getStatus) {
          const snapshot = await this.getStatus();
          const activeBackend = snapshot.activeBackend ?? this.getActiveBackend();
          status = formatTelegramStatus({ ...snapshot, activeBackend }, this.remotePromptRunning);
        } else {
          status = 'Statut indisponible.';
        }
      } catch { status = 'Impossible de lire le statut de Nexus.'; }
      const current = this.getApprovalPeer();
      if (!signal.aborted && peer && current?.userId === peer.userId && current.chatId === peer.chatId) {
        await this.client.sendMessage(chatId, status, 'markdown');
      }
    } catch { console.warn('[Telegram] Status delivery failed.'); }
    finally { this.statusRunning = false; }
  }

  private async runBranchCommand(chatId: number, action: RemoteBranchAction, signal: AbortSignal): Promise<void> {
    try {
      const response = await this.onBranchAction!(action);
      if (!signal.aborted) { await this.client.sendMessage(chatId, response); }
    } catch (error) {
      if (!signal.aborted) {
        await this.client.sendMessage(chatId, `❌ ${error instanceof Error ? error.message : String(error)}`)
          .catch(() => console.error('[Telegram] Branch response delivery failed.'));
      }
    } finally { this.remoteBranchRunning = false; }
  }

  private async runSessionCommand(
    chatId: number,
    action: RemoteSessionAction,
    backendName: string,
    handler: (action: RemoteSessionAction) => Promise<string>,
    signal: AbortSignal,
    generation = this.operationGeneration
  ): Promise<void> {
    try {
      const id = await handler(action);
      if (!signal.aborted && generation === this.operationGeneration) {
        await this.client.sendMessage(chatId,
          `✅ Session ${backendName} ${action.type === 'new' ? 'créée' : 'reprise'}.\nID session : ${id}`);
      }
    } catch (error) {
      if (!signal.aborted && generation === this.operationGeneration) {
        await this.client.sendMessage(chatId,
          `❌ ${error instanceof Error ? error.message : String(error)}`
        ).catch(() => console.error('[Telegram] Session response delivery failed.'));
      }
    } finally {
      if (generation === this.operationGeneration) { this.remoteSessionRunning = false; }
    }
  }

  private async runRemotePrompt(chatId: number, prompt: string, signal: AbortSignal, generation = this.operationGeneration): Promise<void> {
    try {
      await this.client.sendMessage(chatId, '⏳ Codex is working...');
      if (signal.aborted || generation !== this.operationGeneration) {
        return;
      }
      const response = await this.onRemotePrompt!(prompt);
      if (!signal.aborted && generation === this.operationGeneration) {
        await this.client.sendMessage(chatId, typeof response === 'string' ? response : response.text, 'markdown');
        if (!signal.aborted && generation === this.operationGeneration && typeof response !== 'string' && response.fileSummary) {
          await this.client.sendMessage(chatId, response.fileSummary, 'markdown');
        }
      }
    } catch (error) {
      if (!signal.aborted && generation === this.operationGeneration) {
        await this.client.sendMessage(chatId,
          `❌ ${error instanceof Error ? error.message : String(error)}`
        ).catch(() => console.error('[Telegram] Codex response delivery failed.'));
      }
    } finally {
      if (generation === this.operationGeneration) { this.remotePromptRunning = false; }
    }
  }

  private async runRemoteAntigravityPrompt(chatId: number, prompt: string, signal: AbortSignal, generation = this.operationGeneration): Promise<void> {
    try {
      await this.client.sendMessage(chatId, '⏳ Gemini Antigravity is working...');
      if (signal.aborted || generation !== this.operationGeneration) {
        return;
      }
      const response = await this.onRemoteAntigravityPrompt!(prompt);
      if (!signal.aborted && generation === this.operationGeneration) {
        await this.client.sendMessage(chatId, typeof response === 'string' ? response : response.text, 'markdown');
        if (!signal.aborted && generation === this.operationGeneration && typeof response !== 'string' && response.fileSummary) {
          await this.client.sendMessage(chatId, response.fileSummary, 'markdown');
        }
      }
    } catch (error) {
      if (!signal.aborted && generation === this.operationGeneration) {
        await this.client.sendMessage(chatId,
          `❌ ${error instanceof Error ? error.message : String(error)}`
        ).catch(() => console.error('[Telegram] Antigravity response delivery failed.'));
      }
    } finally {
      if (generation === this.operationGeneration) { this.remotePromptRunning = false; }
    }
  }
}
