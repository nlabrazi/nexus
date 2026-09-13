import * as vscode from 'vscode';
import { randomInt } from 'crypto';

let pairingCode: string | undefined;
let pairingExpiresAt = 0;

interface TelegramGetMeResponse {
  ok: boolean;
  result?: {
    username?: string;
    first_name: string;
  };
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    text?: string;
    from?: {
      id: number;
    };
    chat: {
      id: number;
    };
  };
}

interface TelegramUpdatesResponse {
  ok: boolean;
  result: TelegramUpdate[];
}

export async function activate(context: vscode.ExtensionContext) {
  const statusCommand = vscode.commands.registerCommand(
    'nexus.status',
    () => {
      const workspace = vscode.workspace.workspaceFolders?.[0];
      const workspaceName = workspace?.name ?? 'No workspace';

      vscode.window.showInformationMessage(
        `Nexus active — Workspace: ${workspaceName}`
      );
    }
  );

  const telegramToken = await context.secrets.get(
    'nexus.telegram.botToken'
  );

  if (telegramToken) {
    startTelegramPolling(context, telegramToken);
  }

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

      await context.secrets.store('nexus.telegram.botToken', token);

      vscode.window.showInformationMessage(
        'Nexus: Telegram token saved securely.'
      );
    }
  );

  const testTelegramCommand = vscode.commands.registerCommand(
    'nexus.testTelegram',
    async () => {
      const token = await context.secrets.get('nexus.telegram.botToken');

      if (!token) {
        vscode.window.showWarningMessage(
          'Nexus: Telegram is not configured.'
        );
        return;
      }

      try {
        const response = await fetch(
          `https://api.telegram.org/bot${token}/getMe`
        );

        const data = await response.json() as TelegramGetMeResponse;

        if (!response.ok || !data.ok) {
          throw new Error('Telegram API error');
        }

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
    async () => {
      pairingCode = randomInt(100000, 1000000).toString();
      pairingExpiresAt = Date.now() + 2 * 60 * 1000;

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
}

async function getTelegramUpdates(
  token: string,
  offset: number
): Promise<TelegramUpdatesResponse> {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=20`
  );

  if (!response.ok) {
    throw new Error(`Telegram HTTP error: ${response.status}`);
  }

  return await response.json() as TelegramUpdatesResponse;
}

async function sendTelegramMessage(
  token: string,
  chatId: number,
  text: string
) {
  await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
    }
  );
}

async function startTelegramPolling(
  context: vscode.ExtensionContext,
  token: string
) {
  let offset = context.globalState.get<number>(
    'nexus.telegram.updateOffset',
    0
  );


  while (true) {
    try {
      const data = await getTelegramUpdates(token, offset);

      for (const update of data.result) {
        offset = update.update_id + 1;
        await context.globalState.update(
          'nexus.telegram.updateOffset',
          offset
        );

        const text = update.message?.text;
        const userId = update.message?.from?.id;
        const chatId = update.message?.chat.id;

        if (!text || !userId || !chatId) {
          continue;
        }

        console.log(`Received message from ${userId}: ${text}`);
      }
    } catch (error) {
      console.error('Telegram polling error:', error);

      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

export function deactivate() { }
