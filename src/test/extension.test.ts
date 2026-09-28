import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

suite('Nexus extension integration', () => {
  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension('nabster.nexus');
    assert.ok(extension, 'Nexus must be installed in the extension test host');
    await extension.activate();
  });

  test('activation registers diagnostics and preserves the existing entry points', async () => {
    const commands = new Set(await vscode.commands.getCommands(true));
    for (const command of [
      'nexus.diagnostics',
      'nexus.status',
      'nexus.pairTelegram',
      'nexus.startCodexSession',
      'nexus.startAntigravitySession',
      'nexus.testSpeechToText',
    ])
      assert.ok(commands.has(command), `Missing command: ${command}`);
  });

  test('diagnostics can run without a workspace, credentials or an agent process', async () => {
    await vscode.commands.executeCommand('nexus.diagnostics');
  });
});
