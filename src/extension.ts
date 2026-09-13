import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  const command = vscode.commands.registerCommand('nexus.status', () => {
    const workspace = vscode.workspace.workspaceFolders?.[0];

    const workspaceName = workspace?.name ?? 'No workspace';

    vscode.window.showInformationMessage(
      `Nexus active — Workspace: ${workspaceName}`
    );
  });

  context.subscriptions.push(command);

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
