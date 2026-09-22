import * as vscode from 'vscode';

import { TelegramClient } from './telegram/client';
import {
  RemoteBranchAction,
  RemotePromptReply,
  RemoteSessionAction,
  TelegramService,
} from './telegram/service';
import { formatFileSummary } from './telegram/file-summary';

import { CodexClient } from './codex/client';
import { CodexService } from './codex/service';
import { WorkspaceSessionPersistence } from './codex/persistence';
import { WorkspaceModelPreferences } from './codex/model-preferences';
import { DEFAULT_PROTECTED_BRANCHES, WorkspaceGuard } from './workspace/guard';

import { AntigravityClient } from './antigravity/client';
import { AntigravityService } from './antigravity/service';
import { WorkspaceAntigravitySessionPersistence } from './antigravity/persistence';
import { WorkspaceAntigravityModelPreferences } from './antigravity/model-preferences';
import { AgentBackendType } from './telegram/status';
import { registerSpeechTestCommand } from './speech/commands';
import { createConfiguredSpeechService } from './speech/configuration';

let telegramService: TelegramService | undefined;
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
  codexService = new CodexService(
    async (request, signal) => {
      return (await telegramService?.requestApproval(request, signal)) ?? 'decline';
    },
    (path) => workspaceGuard.validate(path),
    new WorkspaceSessionPersistence(context.workspaceState),
    new WorkspaceModelPreferences(context.workspaceState),
    {
      turnTimeoutHandler: async (request, signal) => {
        return (await telegramService?.requestTurnTimeoutContinuation(request, signal)) ?? false;
      },
    }
  );

  const agyConfig = vscode.workspace.getConfiguration('nexus.antigravity');
  antigravityService = new AntigravityService(
    async (request, signal) => {
      return (
        (await telegramService?.requestApproval(
          { ...request, agentName: 'Antigravity' },
          signal
        )) ?? 'decline'
      );
    },
    (path) => workspaceGuard.validate(path),
    new WorkspaceAntigravitySessionPersistence(context.workspaceState),
    new WorkspaceAntigravityModelPreferences(context.workspaceState),
    {
      executablePath: agyConfig.get<string>('path') || undefined,
      sandbox: agyConfig.get<boolean>('sandbox', true),
      dangerouslySkipPermissions: agyConfig.get<boolean>('dangerouslySkipPermissions', false),
      turnTimeoutHandler: async (request, signal) => {
        return (await telegramService?.requestTurnTimeoutContinuation(request, signal)) ?? false;
      },
    }
  );

  const statusCommand = vscode.commands.registerCommand('nexus.status', async () => {
    const workspace = vscode.workspace.workspaceFolders?.[0];

    const workspaceName = workspace?.name ?? 'No workspace';

    const telegramToken = await context.secrets.get('nexus.telegram.botToken');

    const allowedUserId = context.globalState.get<number>('nexus.telegram.allowedUserId');

    const allowedChatId = context.globalState.get<number>('nexus.telegram.allowedChatId');

    const telegramConfigured = Boolean(telegramToken);

    const telegramPaired = allowedUserId !== undefined && allowedChatId !== undefined;

    const codexSession = codexService?.getCurrentSessionId();

    const agySession = antigravityService?.getCurrentSessionId();

    const activeBackend =
      context.globalState.get<AgentBackendType>('nexus.activeBackend') ??
      vscode.workspace.getConfiguration('nexus').get<AgentBackendType>('defaultBackend', 'codex');

    vscode.window.showInformationMessage(
      [
        'Nexus: ON',
        `Backend: ${activeBackend === 'antigravity' ? 'Antigravity' : 'Codex'}`,
        `Workspace: ${workspaceName}`,
        `Telegram: ${telegramConfigured ? 'Configured' : 'Not configured'}`,
        `Paired: ${telegramPaired ? 'Yes' : 'No'}`,
        `Codex: ${codexSession ? 'Session active' : 'No session'}`,
        `Antigravity: ${agySession ? 'Session active' : 'No session'}`,
      ].join(' | ')
    );
  });

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

      startTelegramService(context, token);

      vscode.window.showInformationMessage('Nexus: Telegram configured.');
    }
  );

  const testTelegramCommand = vscode.commands.registerCommand('nexus.testTelegram', async () => {
    const token = await context.secrets.get('nexus.telegram.botToken');

    if (!token) {
      vscode.window.showWarningMessage('Nexus: Telegram is not configured.');

      return;
    }

    try {
      const client = new TelegramClient(token);

      const data = await client.getMe();

      vscode.window.showInformationMessage(`Nexus connected to @${data.result?.username}`);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Nexus: Unable to connect to Telegram: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  });

  const pairTelegramCommand = vscode.commands.registerCommand('nexus.pairTelegram', () => {
    if (!telegramService) {
      vscode.window.showWarningMessage('Nexus: Telegram is not configured.');

      return;
    }

    const pairingCode = telegramService.createPairingCode();

    vscode.window.showInformationMessage(`Send /pair ${pairingCode} to your Nexus Telegram bot`);
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
      await runLocalSessionAction({ type: 'new' });
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
        await runLocalSessionAction({ type: 'resume', sessionId: id.trim() });
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
      await runLocalAntigravitySessionAction({ type: 'new' });
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
        await runLocalAntigravitySessionAction({ type: 'resume', sessionId: id.trim() });
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
    selectBackendCommand,
    configureTelegramCommand,
    testTelegramCommand,
    pairTelegramCommand,
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

  const telegramToken = await context.secrets.get('nexus.telegram.botToken');

  if (telegramToken) {
    startTelegramService(context, telegramToken);
  }
}

function startTelegramService(context: vscode.ExtensionContext, token: string): void {
  telegramService?.stop();

  const client = new TelegramClient(token);

  telegramService = new TelegramService(context, client, {
    onRemotePrompt: handleRemoteCodexPrompt,
    transcribeVoice: async (audio, signal) => {
      const { service, language } = createConfiguredSpeechService(context);
      return service.transcribe(audio, { signal, language });
    },
    getStatus: async () => {
      await codexService?.refreshStatus();
      await antigravityService?.refreshStatus();
      const folders = vscode.workspace.workspaceFolders ?? [];
      const workspace = folders.length === 1 ? folders[0] : undefined;
      const activeBackend =
        context.globalState.get<AgentBackendType>('nexus.activeBackend') ??
        vscode.workspace.getConfiguration('nexus').get<AgentBackendType>('defaultBackend', 'codex');
      return {
        workspace: workspace ? { name: workspace.name, path: workspace.uri.fsPath } : undefined,
        workspaceCount: folders.length,
        activeBackend,
        codex: codexService?.getStatus(),
        antigravity: antigravityService?.getStatus(),
      };
    },
    onSessionAction: handleSessionAction,
    onStop: () => {
      const codexCancelled = codexService?.cancelCurrentWork() ?? false;
      const agyCancelled = antigravityService?.cancelCurrentWork() ?? false;
      return codexCancelled || agyCancelled;
    },
    onBranchAction: handleBranchAction,
    modelControls: {
      list: async () => {
        if (!codexService) {
          throw new Error('Codex indisponible.');
        }
        return codexService.listModels(workspaceGuard.targetPath());
      },
      select: async (selection, menuContext) => {
        if (!codexService) {
          throw new Error('Codex indisponible.');
        }
        await codexService.selectModel(workspaceGuard.targetPath(), selection, menuContext);
      },
    },
    onRemoteAntigravityPrompt: handleRemoteAntigravityPrompt,
    onAntigravitySessionAction: handleAntigravitySessionAction,
    antigravityModelControls: {
      list: async () => {
        if (!antigravityService) {
          throw new Error('Gemini Antigravity indisponible.');
        }
        return antigravityService.listModels(workspaceGuard.targetPath());
      },
      select: async (selection, menuContext) => {
        if (!antigravityService) {
          throw new Error('Gemini Antigravity indisponible.');
        }
        await antigravityService.selectModel(workspaceGuard.targetPath(), selection, menuContext);
      },
    },
    onAntigravityStop: () => antigravityService?.cancelCurrentWork() ?? false,
    getActiveBackend: () => {
      return (
        context.globalState.get<AgentBackendType>('nexus.activeBackend') ??
        vscode.workspace.getConfiguration('nexus').get<AgentBackendType>('defaultBackend', 'codex')
      );
    },
    setActiveBackend: async (backend: AgentBackendType) => {
      await context.globalState.update('nexus.activeBackend', backend);
    },
  });

  void telegramService.start();
}

async function handleRemoteCodexPrompt(prompt: string): Promise<RemotePromptReply> {
  if (!codexService) {
    throw new Error('Codex service unavailable.');
  }

  const workspace = workspaceGuard.targetPath();
  let files: readonly string[] = [];
  const text = await codexService.sendPrompt(prompt, workspace, (paths) => {
    files = paths;
  });
  return {
    text,
    fileSummary: formatFileSummary(files, codexService.getStatus().workspacePath ?? workspace),
  };
}

async function handleRemoteAntigravityPrompt(prompt: string): Promise<RemotePromptReply> {
  if (!antigravityService) {
    throw new Error('Gemini Antigravity service unavailable.');
  }

  const workspace = workspaceGuard.targetPath();
  let files: readonly string[] = [];
  const text = await antigravityService.sendPrompt(prompt, workspace, (paths) => {
    files = paths;
  });
  return {
    text,
    fileSummary: formatFileSummary(
      files,
      antigravityService.getStatus().workspacePath ?? workspace
    ),
  };
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

async function handleAntigravitySessionAction(action: RemoteSessionAction): Promise<string> {
  if (!antigravityService) {
    throw new Error('Gemini Antigravity service unavailable.');
  }
  const path = workspaceGuard.targetPath();
  return action.type === 'new'
    ? await antigravityService.newSession(path)
    : await antigravityService.resumeSession(path, action.sessionId);
}

async function switchWorkspaceBranch(path: string, name: string): Promise<string> {
  const runner = codexService ?? antigravityService;
  if (!runner) {
    throw new Error('Service unavailable.');
  }
  const branch = await runner.withWorkspaceOperation(() => workspaceGuard.switchBranch(path, name));
  const hasSession = Boolean(
    codexService?.getCurrentSessionId() || antigravityService?.getCurrentSessionId()
  );
  return (
    `✅ Branche courante : ${branch}.` +
    (hasSession
      ? '\nAvant le prochain prompt, utilisez /new ou /resume <id> pour associer la session à cette branche.'
      : '')
  );
}

async function handleBranchAction(action: RemoteBranchAction): Promise<string> {
  const path = workspaceGuard.targetPath();
  if (action.type === 'switch') {
    return switchWorkspaceBranch(path, action.name);
  }
  const branches = await workspaceGuard.listBranches(path);
  return [
    'Branches disponibles (références Git connues localement) :',
    ...branches.map(
      (branch) =>
        `${branch.current ? '→ ' : '• '}${branch.name}${branch.remote ? ' (distante)' : ''}${branch.protected ? ' 🔒 protégée' : ''}`
    ),
    branches.length
      ? 'Choisir : /switch <nom exact>\nExemples : /switch staging ou /switch origin/staging'
      : 'Aucune branche disponible.',
  ].join('\n');
}

async function runLocalSessionAction(action: RemoteSessionAction): Promise<void> {
  try {
    const id = await handleSessionAction(action);
    vscode.window.showInformationMessage(
      `Nexus : session Codex ${action.type === 'new' ? 'créée' : 'reprise'} — ${id}`
    );
  } catch (error) {
    vscode.window.showErrorMessage(
      `Nexus : ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function runLocalAntigravitySessionAction(action: RemoteSessionAction): Promise<void> {
  try {
    const id = await handleAntigravitySessionAction(action);
    vscode.window.showInformationMessage(
      `Nexus : session Antigravity ${action.type === 'new' ? 'créée' : 'reprise'} — ${id}`
    );
  } catch (error) {
    vscode.window.showErrorMessage(
      `Nexus : ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function deactivate() {
  telegramService?.stop();
  codexService?.stop();
  antigravityService?.stop();
}
