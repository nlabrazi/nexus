import type * as vscode from 'vscode';
import { randomInt } from 'crypto';
import { TelegramClient } from './client';
import { TelegramUpdate } from './types';
import { TelegramApprovals, TelegramPeer } from './approvals';
import { ApprovalDecision, CodexApprovalRequest } from '../codex/types';
import { formatTelegramStatus, NexusStatusSnapshot } from './status';
import { TELEGRAM_HELP } from './help';

export interface RemotePromptReply { text: string; fileSummary?: string }

type RemotePromptHandler = (
  prompt: string
) => Promise<string | RemotePromptReply>;

export type RemoteSessionAction = { type: 'new' } | { type: 'resume'; sessionId: string };
export type RemoteBranchAction = { type: 'list' } | { type: 'switch'; name: string };

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

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly client: TelegramClient,
    private readonly onRemotePrompt?: RemotePromptHandler,
    private readonly getStatus?: () => NexusStatusSnapshot,
    private readonly onSessionAction?: (action: RemoteSessionAction) => Promise<string>,
    private readonly onStop?: () => boolean,
    private readonly onBranchAction?: (action: RemoteBranchAction) => Promise<string>
  ) {
    this.approvals = new TelegramApprovals(client, () => this.getApprovalPeer());
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
      }
    }
  }

  stop(): void {
    this.running = false;
    this.abortController?.abort();
    this.approvals.cancelAll();
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) {
      await this.approvals.handleCallback(update.callback_query);
      return;
    }
    const text = update.message?.text;
    const userId = update.message?.from?.id;
    const chatId = update.message?.chat.id;
    const chatType = update.message?.chat.type;

    if (
      !text ||
      userId === undefined ||
      chatId === undefined
    ) {
      return;
    }

    // Pairing
    if (text.startsWith('/pair ')) {
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

    // Commands
    const command = text.trim();
    if (/^\/help(?:\s|$)/.test(command)) {
      await this.client.sendMessage(chatId, command === '/help' ? TELEGRAM_HELP : 'Usage : /help', 'markdown');
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
        await this.client.sendMessage(chatId, 'Une opération Git ou Codex est en cours. Attendez sa fin.');
        return;
      }
      this.remoteBranchRunning = true;
      void this.runBranchCommand(chatId, name === '/branches' ? { type: 'list' } : { type: 'switch', name: branch },
        this.abortController!.signal);
      return;
    }
    if (/^\/stop(?:\s|$)/.test(command)) {
      if (command !== '/stop') {
        await this.client.sendMessage(chatId, 'Usage : /stop');
        return;
      }
      if (!this.onStop) {
        await this.client.sendMessage(chatId, 'L’arrêt de Codex est indisponible.');
        return;
      }
      let cancelled: boolean;
      try {
        cancelled = this.onStop() || this.remotePromptRunning || this.remoteSessionRunning;
      } catch {
        await this.client.sendMessage(chatId, '❌ Impossible de demander l’arrêt de Codex. Vérifiez son état dans VS Code.');
        return;
      }
      this.operationGeneration++;
      this.remotePromptRunning = false;
      this.remoteSessionRunning = false;
      this.approvals.cancelAll();
      await this.client.sendMessage(chatId, cancelled
        ? '⏹ Requête annulée côté Nexus. Si Codex était lancé, la connexion a été fermée et son arrêt demandé.\nL’arrêt des commandes enfants n’est pas garanti : vérifiez les commandes et fichiers avant de continuer.\nL’identifiant de la session sélectionnée est conservé, s’il existe.'
        : '⚪ Aucune requête Codex en cours.');
      return;
    }
    if (/^\/(new|resume)(?:\s|$)/.test(command)) {
      const [name, id, ...extra] = command.split(/\s+/);
      if ((name === '/new' && id !== undefined) ||
        (name === '/resume' && (!id || extra.length > 0))) {
        await this.client.sendMessage(chatId, name === '/new' ? 'Usage : /new' : 'Usage : /resume <id>');
        return;
      }
      if (!this.onSessionAction) {
        await this.client.sendMessage(chatId, 'La gestion des sessions Codex est indisponible.');
        return;
      }
      if (this.remotePromptRunning || this.remoteSessionRunning || this.remoteBranchRunning) {
        await this.client.sendMessage(chatId, 'Une requête Codex est déjà en cours. Attendez sa fin.');
        return;
      }
      this.remoteSessionRunning = true;
      const action: RemoteSessionAction = name === '/new' ? { type: 'new' } : { type: 'resume', sessionId: id };
      void this.runSessionCommand(chatId, action, this.abortController!.signal);
      return;
    }

    if (text.trim() === '/status') {
      let status: string;
      try {
        status = this.getStatus
          ? formatTelegramStatus(this.getStatus(), this.remotePromptRunning)
          : 'Statut indisponible.';
      } catch {
        status = 'Impossible de lire le statut de Nexus.';
      }
      await this.client.sendMessage(chatId, status, 'markdown');
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

  private async runSessionCommand(chatId: number, action: RemoteSessionAction, signal: AbortSignal, generation = this.operationGeneration): Promise<void> {
    try {
      const id = await this.onSessionAction!(action);
      if (!signal.aborted && generation === this.operationGeneration) {
        await this.client.sendMessage(chatId,
          `✅ Session Codex ${action.type === 'new' ? 'créée' : 'reprise'}.\nID session : ${id}`);
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
}
