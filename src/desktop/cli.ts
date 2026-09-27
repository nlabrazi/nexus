#!/usr/bin/env node

import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { ApprovalDecision } from '../codex/types';
import { RuntimeApprovalRequest } from '../runtime/types';
import { resolveDesktopConfig } from './config';
import { DesktopNode } from './node';
import { TaskBackend } from './types';

export * from './types';
export * from './config';
export * from './node';
export * from './ws-client';

export * from './types';
export * from './config';
export * from './node';

const VERSION = '0.4.1';

const HELP_TEXT = `
Nexus Desktop Node (v${VERSION})
Exécution autonome d'agents (Codex, Antigravity, Nexus Brain) hors de VS Code.

USAGE:
  nexus-desktop [COMMANDE] [OPTIONS]

COMMANDES:
  start           Démarrer le Desktop Node en arrière-plan / premier plan (défaut)
  status          Vérifier la validité du projet et afficher l'état du runtime
  exec <prompt>   Exécuter un prompt directement sur le projet configuré et afficher le résultat

OPTIONS:
  -p, --project <path>     Chemin absolu ou relatif vers le répertoire du projet (obligatoire ou via NEXUS_PROJECT_PATH)
  -n, --name <name>        Nom lisible du projet ou du nœud
  -b, --backend <backend>  Backend agent par défaut (codex, antigravity, brain) [défaut: codex]
  -c, --config <file>      Fichier de configuration JSON
  -C, --core <url>         URL de Nexus Core (ex: ws://vps.example.com:4040 ou http://localhost:4040)
  --node-id <id>           Identifiant unique du nœud Desktop
  -t, --token <token>      Jeton d'authentification pour Nexus Core
  -h, --help               Afficher cette aide
  -v, --version            Afficher la version

EXEMPLES:
  nexus-desktop start --project ./mon-projet
  nexus-desktop start --project ./mon-projet --core ws://vps.example.com:4040 --token secret123
  nexus-desktop status --project /home/user/code/app
  nexus-desktop exec --project ./mon-projet --backend codex "Créer un script de build"
  nexus-desktop exec --project ./mon-projet --backend brain "Que peux-tu me dire sur l'architecture ?"
`;

function createTerminalApprovalHandler(): (
  request: RuntimeApprovalRequest,
  signal: AbortSignal
) => Promise<ApprovalDecision> {
  return async (request, signal): Promise<ApprovalDecision> => {
    if (!process.stdin.isTTY) {
      console.warn(
        `[Nexus Security] Approbation refusée par défaut (terminal non interactif) : ${request.details}`
      );
      return 'decline';
    }

    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
    });

    try {
      console.error('\n⚠️  DEMANDE D’AUTORISATION NEXUS');
      console.error(`Agent    : ${request.agentName}`);
      console.error(`Nature   : ${request.kind}`);
      console.error(`Détails  :\n${request.details}\n`);

      const answer = await new Promise<string>((resolve) => {
        const onAbort = () => {
          rl.close();
          resolve('n');
        };
        signal.addEventListener('abort', onAbort, { once: true });

        rl.question('Autoriser cette action ? [y/N] : ', (res) => {
          signal.removeEventListener('abort', onAbort);
          resolve(res.trim().toLowerCase());
        });
      });

      return answer === 'y' || answer === 'yes' || answer === 'o' || answer === 'oui'
        ? 'accept'
        : 'decline';
    } finally {
      rl.close();
    }
  };
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const optionsConfig = {
    project: { type: 'string' as const, short: 'p' },
    name: { type: 'string' as const, short: 'n' },
    backend: { type: 'string' as const, short: 'b' },
    config: { type: 'string' as const, short: 'c' },
    core: { type: 'string' as const, short: 'C' },
    'node-id': { type: 'string' as const },
    token: { type: 'string' as const, short: 't' },
    help: { type: 'boolean' as const, short: 'h', default: false },
    version: { type: 'boolean' as const, short: 'v', default: false },
  };

  let parsed: {
    values: {
      project?: string;
      name?: string;
      backend?: string;
      config?: string;
      core?: string;
      'node-id'?: string;
      token?: string;
      help?: boolean;
      version?: boolean;
    };
    positionals: string[];
  };
  try {
    parsed = parseArgs({
      args: argv,
      options: optionsConfig,
      allowPositionals: true,
    });
  } catch (err) {
    console.error(`Erreur d'arguments : ${err instanceof Error ? err.message : String(err)}`);
    console.error('Utilisez --help pour voir les options disponibles.');
    return 1;
  }

  const { values, positionals } = parsed;

  if (values.help) {
    console.log(HELP_TEXT.trim());
    return 0;
  }

  if (values.version) {
    console.log(`nexus-desktop v${VERSION}`);
    return 0;
  }

  const command = positionals[0] && !positionals[0].startsWith('-') ? positionals[0] : 'start';

  try {
    const config = resolveDesktopConfig({
      project: values.project,
      name: values.name,
      backend: values.backend,
      config: values.config,
      core: values.core,
      nodeId: values['node-id'],
      authToken: values.token,
    });

    const approvalHandler = createTerminalApprovalHandler();
    const node = new DesktopNode(config, {
      requestApproval: approvalHandler,
    });

    if (command === 'status') {
      const status = await node.start();
      console.log('\n📊 ÉTAT DU NEXUS DESKTOP NODE');
      console.log(`• Nœud ID        : ${status.nodeId}`);
      console.log(`• Nom du nœud    : ${status.nodeName}`);
      console.log(`• État           : ${status.state}`);
      if (status.coreConnection) {
        console.log(
          `• Nexus Core     : ${status.coreConnection.status} (${status.coreConnection.url})`
        );
      }
      console.log(`• Projet actif   : ${status.activeProject.name} (${status.activeProject.path})`);
      console.log(`• Branche Git    : ${status.activeProject.currentBranch ?? 'sans dépôt Git'}`);
      console.log(`• Agent actif    : ${status.runtimeStatus.activeBackend}`);
      console.log(`• Projets totaux : ${status.projects.length}`);
      await node.stop();
      return 0;
    }

    if (command === 'exec') {
      const prompt = positionals.slice(1).join(' ').trim();
      if (!prompt) {
        console.error('Erreur : Aucun prompt fourni pour la commande exec.');
        console.error('Exemple : nexus-desktop exec --project ./repo "Mon prompt"');
        return 1;
      }

      await node.start();
      const activeProject = node.getActiveProject();
      const backend = (config.defaultBackend ?? 'codex') as TaskBackend;

      console.log(`🚀 Exécution avec ${backend} sur [${activeProject.name}]...`);
      const result = await node.executeTask(backend, prompt);

      console.log('\n--- RÉPONSE ---');
      console.log(result.text);

      if (result.fileSummary) {
        console.log(`\nFichiers modifiés :\n${result.fileSummary}`);
      }

      await node.stop();
      return 0;
    }

    if (command === 'start') {
      const status = await node.start();

      console.log('================================================================');
      console.log(`  🌟 NEXUS DESKTOP NODE v${VERSION}`);
      console.log('================================================================');
      console.log(`  • Nœud ID        : ${status.nodeId}`);
      console.log(`  • Nom            : ${status.nodeName}`);
      console.log(`  • État           : ${status.state}`);
      if (status.coreConnection) {
        console.log(
          `  • Nexus Core     : ${status.coreConnection.status} (${status.coreConnection.url})`
        );
      }
      console.log(`  • Projet actif   : ${status.activeProject.name}`);
      console.log(`  • Répertoire     : ${status.activeProject.path}`);
      console.log(`  • Branche Git    : ${status.activeProject.currentBranch ?? 'aucune'}`);
      console.log(`  • Agent défaut   : ${config.defaultBackend ?? 'codex'}`);
      console.log('================================================================');
      console.log('Desktop Node prêt. En attente de tâches (Ctrl+C pour quitter)...');

      const shutdown = async () => {
        console.log('\nInterruption reçue, arrêt du Desktop Node...');
        await node.stop();
        console.log('Desktop Node arrêté avec succès.');
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      // Keep running until killed
      await new Promise<void>(() => {});
      return 0;
    }

    console.error(`Commande inconnue : « ${command} ». Commandes valides : start, status, exec.`);
    return 1;
  } catch (error) {
    console.error(`\n❌ Erreur : ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (require.main === module) {
  runCli().then((code) => {
    if (code !== 0) {
      process.exit(code);
    }
  });
}
