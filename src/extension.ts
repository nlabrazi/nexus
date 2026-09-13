import * as vscode from 'vscode';

import { TelegramClient } from './telegram/client';
import { TelegramService } from './telegram/service';

import { CodexClient } from './codex/client';
import { CodexService } from './codex/service';

let telegramService: TelegramService | undefined;
let codexService: CodexService | undefined;

export async function activate(
  context: vscode.ExtensionContext
) {
  codexService = new CodexService();

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
        const workspace =
          vscode.workspace.workspaceFolders?.[0];

        if (!workspace) {
          vscode.window.showWarningMessage(
            'Nexus: No workspace opened.'
          );

          return;
        }

        if (!codexService) {
          vscode.window.showErrorMessage(
            'Nexus: Codex service unavailable.'
          );

          return;
        }

        try {
          const sessionId =
            await codexService.startSession(
              workspace.uri.fsPath
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

  context.subscriptions.push(
    statusCommand,
    configureTelegramCommand,
    testTelegramCommand,
    pairTelegramCommand,
    testCodexCommand,
    startCodexSessionCommand,
    testCodexPromptCommand
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
      handleRemoteCodexPrompt
    );

  void telegramService.start();
}

async function handleRemoteCodexPrompt(
  prompt: string
): Promise<string> {
  if (!codexService) {
    throw new Error(
      'Codex service unavailable.'
    );
  }

  const workspace =
    vscode.workspace.workspaceFolders?.[0];

  if (!workspace) {
    throw new Error(
      'No workspace is currently open in VS Code.'
    );
  }

  if (!codexService.isSessionActive()) {
    await codexService.startSession(
      workspace.uri.fsPath
    );
  }

  return await codexService.sendPrompt(prompt);
}

export function deactivate() {
  telegramService?.stop();
  codexService?.stop();
}
