import * as vscode from 'vscode';

import { TelegramClient } from './telegram/client';
import { RemotePromptReply, RemoteSessionAction, TelegramService } from './telegram/service';
import { formatFileSummary } from './telegram/file-summary';

import { CodexClient } from './codex/client';
import { CodexService } from './codex/service';
import { DEFAULT_PROTECTED_BRANCHES, WorkspaceGuard } from './workspace/guard';

let telegramService: TelegramService | undefined;
let codexService: CodexService | undefined;

const workspaceGuard = new WorkspaceGuard(() => ({
  trusted: vscode.workspace.isTrusted,
  folders: (vscode.workspace.workspaceFolders ?? []).map(folder => ({
    scheme: folder.uri.scheme, path: folder.uri.fsPath,
  })),
  dirtyDocuments: [...vscode.workspace.textDocuments, ...vscode.workspace.notebookDocuments]
    .filter(document => document.isDirty)
    .map(document => ({ scheme: document.uri.scheme, path: document.uri.fsPath })),
  protectedBranches: vscode.workspace.getConfiguration('nexus').get<string[]>('git.protectedBranches', DEFAULT_PROTECTED_BRANCHES),
}));

export async function activate(
  context: vscode.ExtensionContext
) {
  codexService = new CodexService(async (request, signal) => {
    return await telegramService?.requestApproval(request, signal) ?? 'decline';
  }, path => workspaceGuard.validate(path));

  const statusCommand = vscode.commands.registerCommand(
    'nexus.status',
    async () => {
      const workspace =
        vscode.workspace.workspaceFolders?.[0];

      const workspaceName =
        workspace?.name ?? 'No workspace';

      const telegramToken =
        await context.secrets.get(
          'nexus.telegram.botToken'
        );

      const allowedUserId =
        context.globalState.get<number>(
          'nexus.telegram.allowedUserId'
        );

      const allowedChatId =
        context.globalState.get<number>(
          'nexus.telegram.allowedChatId'
        );

      const telegramConfigured =
        Boolean(telegramToken);

      const telegramPaired =
        allowedUserId !== undefined &&
        allowedChatId !== undefined;

      const codexSession =
        codexService?.getCurrentSessionId();

      vscode.window.showInformationMessage(
        [
          'Nexus: ON',
          `Workspace: ${workspaceName}`,
          `Telegram: ${telegramConfigured
            ? 'Configured'
            : 'Not configured'
          }`,
          `Paired: ${telegramPaired
            ? 'Yes'
            : 'No'
          }`,
          `Codex: ${codexSession
            ? 'Session active'
            : 'No session'
          }`,
        ].join(' | ')
      );
    }
  );

  const configureTelegramCommand =
    vscode.commands.registerCommand(
      'nexus.configureTelegram',
      async () => {
        const token =
          await vscode.window.showInputBox({
            prompt: 'Enter your Telegram bot token',
            password: true,
            ignoreFocusOut: true,
          });

        if (!token) {
          return;
        }

        await context.secrets.store(
          'nexus.telegram.botToken',
          token
        );

        startTelegramService(context, token);

        vscode.window.showInformationMessage(
          'Nexus: Telegram configured.'
        );
      }
    );

  const testTelegramCommand =
    vscode.commands.registerCommand(
      'nexus.testTelegram',
      async () => {
        const token =
          await context.secrets.get(
            'nexus.telegram.botToken'
          );

        if (!token) {
          vscode.window.showWarningMessage(
            'Nexus: Telegram is not configured.'
          );

          return;
        }

        try {
          const client =
            new TelegramClient(token);

          const data =
            await client.getMe();

          vscode.window.showInformationMessage(
            `Nexus connected to @${data.result?.username}`
          );
        } catch (error) {
          vscode.window.showErrorMessage(
            `Nexus: Unable to connect to Telegram: ${error instanceof Error
              ? error.message
              : String(error)
            }`
          );
        }
      }
    );

  const pairTelegramCommand =
    vscode.commands.registerCommand(
      'nexus.pairTelegram',
      () => {
        if (!telegramService) {
          vscode.window.showWarningMessage(
            'Nexus: Telegram is not configured.'
          );

          return;
        }

        const pairingCode =
          telegramService.createPairingCode();

        vscode.window.showInformationMessage(
          `Send /pair ${pairingCode} to your Nexus Telegram bot`
        );
      }
    );

  const testCodexCommand =
    vscode.commands.registerCommand(
      'nexus.testCodex',
      async () => {
        const client = new CodexClient();

        try {
          await client.start();

          vscode.window.showInformationMessage(
            'Nexus: Codex connected.'
          );
        } catch (error) {
          vscode.window.showErrorMessage(
            `Nexus: Codex connection failed: ${error instanceof Error
              ? error.message
              : String(error)
            }`
          );
        } finally {
          client.stop();
        }
      }
    );

  const startCodexSessionCommand =
    vscode.commands.registerCommand(
      'nexus.startCodexSession',
      async () => {
        if (!codexService) {
          vscode.window.showErrorMessage(
            'Nexus: Codex service unavailable.'
          );

          return;
        }

        try {
          const sessionId =
            await codexService.startSession(
              workspaceGuard.targetPath()
            );

          vscode.window.showInformationMessage(
            `Nexus: Codex session started — ${sessionId}`
          );
        } catch (error) {
          vscode.window.showErrorMessage(
            `Nexus: Unable to start Codex session: ${error instanceof Error
              ? error.message
              : String(error)
            }`
          );
        }
      }
    );

  const testCodexPromptCommand =
    vscode.commands.registerCommand(
      'nexus.testCodexPrompt',
      async () => {
        if (
          !codexService ||
          !codexService.isSessionActive()
        ) {
          vscode.window.showWarningMessage(
            'Nexus: Start a Codex session first.'
          );

          return;
        }

        try {
          const response =
            await codexService.sendPrompt(
              'Reply only with: Nexus connected'
            );

          vscode.window.showInformationMessage(
            `Codex: ${response}`
          );
        } catch (error) {
          vscode.window.showErrorMessage(
            `Nexus: Codex prompt failed: ${error instanceof Error
              ? error.message
              : String(error)
            }`
          );
        }
      }
    );

  const newCodexSessionCommand = vscode.commands.registerCommand('nexus.newCodexSession', async () => {
    await runLocalSessionAction({ type: 'new' });
  });

  const resumeCodexSessionCommand = vscode.commands.registerCommand('nexus.resumeCodexSession', async () => {
    const id = await vscode.window.showInputBox({
      prompt: 'Identifiant de la session Codex à reprendre dans le workspace courant',
      ignoreFocusOut: true,
    });
    if (id?.trim()) {
      await runLocalSessionAction({ type: 'resume', sessionId: id.trim() });
    }
  });

  context.subscriptions.push(
    statusCommand,
    configureTelegramCommand,
    testTelegramCommand,
    pairTelegramCommand,
    testCodexCommand,
    startCodexSessionCommand,
    testCodexPromptCommand,
    newCodexSessionCommand,
    resumeCodexSessionCommand
  );

  const statusBar =
    vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );

  statusBar.text =
    '$(radio-tower) Nexus: ON';

  statusBar.tooltip =
    'Nexus is running';

  statusBar.command =
    'nexus.status';

  statusBar.show();

  context.subscriptions.push(statusBar);

  const telegramToken =
    await context.secrets.get(
      'nexus.telegram.botToken'
    );

  if (telegramToken) {
    startTelegramService(
      context,
      telegramToken
    );
  }
}

function startTelegramService(
  context: vscode.ExtensionContext,
  token: string
): void {
  telegramService?.stop();

  const client =
    new TelegramClient(token);

  telegramService =
    new TelegramService(
      context,
      client,
      handleRemoteCodexPrompt,
      () => {
        const folders = vscode.workspace.workspaceFolders ?? [];
        const workspace = folders.length === 1 ? folders[0] : undefined;
        return {
          workspace: workspace ? { name: workspace.name, path: workspace.uri.fsPath } : undefined,
          workspaceCount: folders.length,
          codex: codexService?.getStatus(),
        };
      },
      handleSessionAction
    );

  void telegramService.start();
}

async function handleRemoteCodexPrompt(
  prompt: string
): Promise<RemotePromptReply> {
  if (!codexService) {
    throw new Error(
      'Codex service unavailable.'
    );
  }

  const workspace = workspaceGuard.targetPath();
  let files: readonly string[] = [];
  const text = await codexService.sendPrompt(prompt, workspace, paths => { files = paths; });
  return { text, fileSummary: formatFileSummary(files, codexService.getStatus().workspacePath ?? workspace) };
}

async function handleSessionAction(action: RemoteSessionAction): Promise<string> {
  if (!codexService) {
    throw new Error('Codex service unavailable.');
  }
  const path = workspaceGuard.targetPath();
  return action.type === 'new'
    ? await codexService.newSession(path)
    : await codexService.resumeSession(path, action.sessionId);
}

async function runLocalSessionAction(action: RemoteSessionAction): Promise<void> {
  try {
    const id = await handleSessionAction(action);
    vscode.window.showInformationMessage(`Nexus : session ${action.type === 'new' ? 'créée' : 'reprise'} — ${id}`);
  } catch (error) {
    vscode.window.showErrorMessage(`Nexus : ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function deactivate() {
  telegramService?.stop();
  codexService?.stop();
}
