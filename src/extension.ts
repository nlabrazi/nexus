import { existsSync } from 'node:fs';
import { formatDiagnostics } from './diagnostics/status';
import { getLoggingStatus } from './logging/persistence';
import { initializeLogging } from './logging/persistence';
import { logger } from './logging/logger';
import * as vscode from 'vscode';

import { CodexClient } from './codex/client';
import { CodexService } from './codex/service';
import { WorkspaceSessionPersistence } from './codex/persistence';
import { WorkspaceModelPreferences } from './codex/model-preferences';
import { DEFAULT_PROTECTED_BRANCHES, WorkspaceGuard } from './workspace/guard';

import { AntigravityClient } from './antigravity/client';
import { AntigravityService } from './antigravity/service';
import { WorkspaceAntigravitySessionPersistence } from './antigravity/persistence';
import { WorkspaceAntigravityModelPreferences } from './antigravity/model-preferences';
import { AgentBackendType, RemoteSessionAction } from './runtime/types';
import { registerSpeechTestCommand } from './speech/commands';
import { NexusRuntime } from './runtime';

let nexusRuntime: NexusRuntime | undefined;
let codexService: CodexService | undefined;
let antigravityService: AntigravityService | undefined;

const workspaceGuard = new WorkspaceGuard(() => ({
  trusted: vscode.workspace.isTrusted,
  folders: (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
    scheme: folder.uri.scheme,
    path: folder.uri.fsPath,
  })),
  dirtyDocuments: [...vscode.workspace.textDocuments, ...vscode.workspace.notebookDocuments]
    .filter((document) => document.isDirty)
    .map((document) => ({ scheme: document.uri.scheme, path: document.uri.fsPath })),
  protectedBranches: vscode.workspace
    .getConfiguration('nexus')
    .get<string[]>('git.protectedBranches', DEFAULT_PROTECTED_BRANCHES),
}));

export async function activate(context: vscode.ExtensionContext) {
  const stopLogging = initializeLogging('extension', context.logUri.fsPath);
  const output = vscode.window.createOutputChannel('Nexus Logs');
  const removeLogOutput = logger.addSink((record) => output.appendLine(JSON.stringify(record)));
  context.subscriptions.push(output, {
    dispose: () => {
      removeLogOutput();
      stopLogging();
    },
  });
  logger.info('Extension', 'activate', { status: 'success' });
  const agyConfig = vscode.workspace.getConfiguration('nexus.antigravity');

  nexusRuntime = new NexusRuntime({
    workspaceGuard,
    targetPath: () => workspaceGuard.targetPath(),
    requestApproval: async () => 'decline',
    requestTurnTimeoutContinuation: async () => false,
    codexPersistence: new WorkspaceSessionPersistence(context.workspaceState),
    codexModelPreferences: new WorkspaceModelPreferences(context.workspaceState),
    antigravityPersistence: new WorkspaceAntigravitySessionPersistence(context.workspaceState),
    antigravityModelPreferences: new WorkspaceAntigravityModelPreferences(context.workspaceState),
    antigravityConfig: {
      executablePath: agyConfig.get<string>('path') || undefined,
      sandbox: agyConfig.get<boolean>('sandbox', true),
      dangerouslySkipPermissions: agyConfig.get<boolean>('dangerouslySkipPermissions', false),
    },
    defaultBackend:
      context.globalState.get<AgentBackendType>('nexus.activeBackend') ??
      vscode.workspace.getConfiguration('nexus').get<AgentBackendType>('defaultBackend', 'codex'),
  });

  codexService = nexusRuntime.getCodexService();
  antigravityService = nexusRuntime.getAntigravityService();

  const statusCommand = vscode.commands.registerCommand('nexus.status', async () => {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    const workspaceName = workspace?.name ?? 'No workspace';
    const status = await nexusRuntime?.getStatus();
    const activeBackend = status?.activeBackend ?? 'codex';
    vscode.window.showInformationMessage(
      `Nexus active — Workspace: ${workspaceName} (${activeBackend})`
    );
  });

  const diagnosticsCommand = vscode.commands.registerCommand('nexus.diagnostics', async () => {
    const snapshot = await nexusRuntime!.getStatus();
    const report = formatDiagnostics(
      { ...snapshot, tts: getTtsDiagnostic() },
      {
        lastError: logger.getLastError(),
        logsAvailable: getLoggingStatus().available,
      }
    );
    output.appendLine(report);
    output.show(true);
  });

  const testCodexCommand = vscode.commands.registerCommand('nexus.testCodex', async () => {
    const client = new CodexClient();

    try {
      await client.start();

      vscode.window.showInformationMessage('Nexus: Codex connected.');
    } catch (error) {
      vscode.window.showErrorMessage(
        `Nexus: Codex connection failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      client.stop();
    }
  });

  const startCodexSessionCommand = vscode.commands.registerCommand(
    'nexus.startCodexSession',
    async () => {
      if (!codexService) {
        vscode.window.showErrorMessage('Nexus: Codex service unavailable.');

        return;
      }

      try {
        const sessionId = await codexService.startSession(workspaceGuard.targetPath());

        vscode.window.showInformationMessage(`Nexus: Codex session started — ${sessionId}`);
      } catch (error) {
        vscode.window.showErrorMessage(
          `Nexus: Unable to start Codex session: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  );

  const testCodexPromptCommand = vscode.commands.registerCommand(
    'nexus.testCodexPrompt',
    async () => {
      if (!codexService?.isSessionActive()) {
        vscode.window.showWarningMessage('Nexus: Start a Codex session first.');

        return;
      }

      try {
        const response = await codexService.sendPrompt('Reply only with: Nexus connected');

        vscode.window.showInformationMessage(`Codex: ${response}`);
      } catch (error) {
        vscode.window.showErrorMessage(
          `Nexus: Codex prompt failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  const newCodexSessionCommand = vscode.commands.registerCommand(
    'nexus.newCodexSession',
    async () => {
      await runLocalSessionAction('codex', { type: 'new' });
    }
  );

  const switchBranchCommand = vscode.commands.registerCommand('nexus.switchBranch', async () => {
    try {
      const path = workspaceGuard.targetPath();
      const branches = await workspaceGuard.listBranches(path);
      const selected = await vscode.window.showQuickPick(
        branches.map((branch) => ({
          label: branch.name,
          description: [
            branch.current ? 'actuelle' : '',
            branch.protected ? 'protégée' : '',
            branch.remote ? 'distante' : 'locale',
          ]
            .filter(Boolean)
            .join(' · '),
          branch,
        })),
        { placeHolder: 'Choisir la branche de travail' }
      );
      if (selected) {
        vscode.window.showInformationMessage(
          await switchWorkspaceBranch(path, selected.branch.name)
        );
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        `Nexus : ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  const resumeCodexSessionCommand = vscode.commands.registerCommand(
    'nexus.resumeCodexSession',
    async () => {
      const id = await vscode.window.showInputBox({
        prompt: 'Identifiant de la session Codex à reprendre dans le workspace courant',
        ignoreFocusOut: true,
      });
      if (id?.trim()) {
        await runLocalSessionAction('codex', { type: 'resume', sessionId: id.trim() });
      }
    }
  );

  const selectBackendCommand = vscode.commands.registerCommand('nexus.selectBackend', async () => {
    const current =
      context.globalState.get<AgentBackendType>('nexus.activeBackend') ??
      vscode.workspace.getConfiguration('nexus').get<AgentBackendType>('defaultBackend', 'codex');
    const selected = await vscode.window.showQuickPick(
      [
        {
          label: '🤖 Codex',
          value: 'codex' as const,
          description: current === 'codex' ? '(actif)' : '',
        },
        {
          label: '✨ Gemini Antigravity',
          value: 'antigravity' as const,
          description: current === 'antigravity' ? '(actif)' : '',
        },
        {
          label: '🧠 Claude Code',
          value: 'claude' as const,
          description: current === 'claude' ? '(actif)' : '',
        },
      ],
      { placeHolder: 'Choisir le backend agent actif pour Nexus' }
    );
    if (selected) {
      await context.globalState.update('nexus.activeBackend', selected.value);
      vscode.window.showInformationMessage(`Nexus : Backend actif défini sur ${selected.label}.`);
    }
  });

  const testAntigravityCommand = vscode.commands.registerCommand(
    'nexus.testAntigravity',
    async () => {
      const agyConfig = vscode.workspace.getConfiguration('nexus.antigravity');
      const client = new AntigravityClient({
        executablePath: agyConfig.get<string>('path') || undefined,
        sandbox: agyConfig.get<boolean>('sandbox', true),
      });

      try {
        await client.checkInstalled();
        const models = await client.listModels();
        vscode.window.showInformationMessage(
          `Nexus: Gemini Antigravity connected (${models.length} modèles disponibles).`
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          `Nexus: Antigravity connection failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  const startAntigravitySessionCommand = vscode.commands.registerCommand(
    'nexus.startAntigravitySession',
    async () => {
      if (!antigravityService) {
        vscode.window.showErrorMessage('Nexus: Antigravity service unavailable.');
        return;
      }

      try {
        const sessionId = await antigravityService.startSession(workspaceGuard.targetPath());
        vscode.window.showInformationMessage(`Nexus: Antigravity session started — ${sessionId}`);
      } catch (error) {
        vscode.window.showErrorMessage(
          `Nexus: Unable to start Antigravity session: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  const newAntigravitySessionCommand = vscode.commands.registerCommand(
    'nexus.newAntigravitySession',
    async () => {
      await runLocalSessionAction('antigravity', { type: 'new' });
    }
  );

  const resumeAntigravitySessionCommand = vscode.commands.registerCommand(
    'nexus.resumeAntigravitySession',
    async () => {
      const id = await vscode.window.showInputBox({
        prompt: 'Identifiant de la session Antigravity à reprendre dans le workspace courant',
        ignoreFocusOut: true,
      });
      if (id?.trim()) {
        await runLocalSessionAction('antigravity', { type: 'resume', sessionId: id.trim() });
      }
    }
  );

  const testAntigravityPromptCommand = vscode.commands.registerCommand(
    'nexus.testAntigravityPrompt',
    async () => {
      if (!antigravityService?.isSessionActive()) {
        vscode.window.showWarningMessage('Nexus: Start an Antigravity session first.');
        return;
      }

      try {
        const response = await antigravityService.sendPrompt(
          'Reply only with: Nexus connected',
          workspaceGuard.targetPath()
        );
        vscode.window.showInformationMessage(`Antigravity: ${response}`);
      } catch (error) {
        vscode.window.showErrorMessage(
          `Nexus: Antigravity prompt failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  context.subscriptions.push(
    registerSpeechTestCommand(context),
    statusCommand,
    diagnosticsCommand,
    selectBackendCommand,
    testCodexCommand,
    startCodexSessionCommand,
    testCodexPromptCommand,
    newCodexSessionCommand,
    resumeCodexSessionCommand,
    testAntigravityCommand,
    startAntigravitySessionCommand,
    newAntigravitySessionCommand,
    resumeAntigravitySessionCommand,
    testAntigravityPromptCommand,
    switchBranchCommand
  );

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);

  statusBar.text = '$(radio-tower) Nexus: ON';

  statusBar.tooltip = 'Nexus is running';

  statusBar.command = 'nexus.status';

  statusBar.show();

  context.subscriptions.push(statusBar);
}

async function runLocalSessionAction(
  backend: 'codex' | 'antigravity',
  action: RemoteSessionAction
): Promise<void> {
  const label = backend === 'antigravity' ? 'Antigravity' : 'Codex';
  if (!nexusRuntime) {
    throw new Error(`${label} service unavailable.`);
  }
  try {
    const id = await nexusRuntime.handleSessionAction(backend, action);
    vscode.window.showInformationMessage(
      `Nexus : session ${label} ${action.type === 'new' ? 'créée' : 'reprise'} — ${id}`
    );
  } catch (error) {
    vscode.window.showErrorMessage(
      `Nexus : ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function switchWorkspaceBranch(path: string, name: string): Promise<string> {
  if (!nexusRuntime) {
    throw new Error('Service unavailable.');
  }
  return nexusRuntime.switchBranch(name, path);
}

export function deactivate() {
  nexusRuntime?.stop();
}

function getTtsDiagnostic(): string {
  const config = vscode.workspace.getConfiguration('nexus.speech.tts');
  if (!config.get<boolean>('enabled', true)) {
    return 'désactivé';
  }
  const python = config.get<string>('pythonPath', '');
  const model = config.get<string>('modelPath', '');
  return python && model && existsSync(python) && existsSync(model) && existsSync(`${model}.json`)
    ? 'Piper configuré (synthèse et FFmpeg non vérifiés)'
    : 'Piper indisponible (configuration locale incomplète)';
}
