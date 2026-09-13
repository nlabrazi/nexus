import * as vscode from 'vscode';
import { TelegramClient } from './telegram/client';
import { TelegramService } from './telegram/service';

let telegramService: TelegramService | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const statusCommand = vscode.commands.registerCommand(
    'nexus.status',
    async () => {
      const workspace = vscode.workspace.workspaceFolders?.[0];
      const workspaceName = workspace?.name ?? 'No workspace';

      const telegramToken = await context.secrets.get(
        'nexus.telegram.botToken'
      );

      const allowedUserId = context.globalState.get<number>(
        'nexus.telegram.allowedUserId'
      );

      const allowedChatId = context.globalState.get<number>(
        'nexus.telegram.allowedChatId'
      );

      const telegramConfigured = Boolean(telegramToken);
      const telegramPaired = Boolean(
        allowedUserId && allowedChatId
      );

      vscode.window.showInformationMessage(
        [
          'Nexus: ON',
          `Workspace: ${workspaceName}`,
          `Telegram: ${telegramConfigured ? 'Configured' : 'Not configured'}`,
          `Paired: ${telegramPaired ? 'Yes' : 'No'}`,
        ].join(' | ')
      );
    }
  );

  const configureTelegramCommand = vscode.commands.registerCommand(
    'nexus.configureTelegram',
    async () => {
      const token = await vscode.window.showInputBox({
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

  const testTelegramCommand = vscode.commands.registerCommand(
    'nexus.testTelegram',
    async () => {
      const token = await context.secrets.get(
        'nexus.telegram.botToken'
      );

      if (!token) {
        vscode.window.showWarningMessage(
          'Nexus: Telegram is not configured.'
        );
        return;
      }

      try {
        const client = new TelegramClient(token);
        const data = await client.getMe();

        vscode.window.showInformationMessage(
          `Nexus connected to @${data.result?.username}`
        );
      } catch {
        vscode.window.showErrorMessage(
          'Nexus: Unable to connect to Telegram.'
        );
      }
    }
  );

  const pairTelegramCommand = vscode.commands.registerCommand(
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

  context.subscriptions.push(
    statusCommand,
    configureTelegramCommand,
    testTelegramCommand,
    pairTelegramCommand
  );

  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );

  statusBar.text = '$(radio-tower) Nexus: ON';
  statusBar.tooltip = 'Nexus is running';
  statusBar.command = 'nexus.status';

  statusBar.show();

  context.subscriptions.push(statusBar);

  const telegramToken = await context.secrets.get(
    'nexus.telegram.botToken'
  );

  if (telegramToken) {
    startTelegramService(context, telegramToken);
  }
}

function startTelegramService(
  context: vscode.ExtensionContext,
  token: string
): void {
  telegramService?.stop();

  const client = new TelegramClient(token);

  telegramService = new TelegramService(
    context,
    client
  );

  void telegramService.start();
}

export function deactivate() {
  telegramService?.stop();
}
