import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
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

  context.subscriptions.push(
    statusCommand,
    configureTelegramCommand
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

export function deactivate() { }
