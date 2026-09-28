#!/usr/bin/env node

import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { ApprovalDecision } from '../codex/types';
import { RuntimeApprovalRequest } from '../runtime/types';
import { resolveDesktopConfig } from './config';
import { DesktopNode } from './node';
import { loadProjectRegistry } from './registry';
import { TaskBackend } from './types';

export * from './types';
export * from './config';
export * from './node';
export * from './ws-client';
export * from './registry';

const VERSION = '1.0.0';

const HELP_TEXT = `
Nexus Desktop Node (v${VERSION})
Exécution autonome d'agents (Codex, Antigravity, Nexus Brain) hors de VS Code.

USAGE:
  nexus-desktop [COMMANDE] [OPTIONS]

COMMANDES:
  start           Démarrer le Desktop Node en arrière-plan / premier plan (défaut)
  status          Vérifier la validité du projet et afficher l'état du runtime
  exec <prompt>   Exécuter un prompt directement sur le projet configuré et afficher le résultat
  projects        Gérer le registre explicite de projets (list, add, remove, set-default)
  memory          Gérer la mémoire de décisions architecturales (show, add, clear)

OPTIONS:
  -p, --project <path>     Chemin absolu ou relatif vers le répertoire du projet (ou via registre)
  -n, --name <name>        Nom lisible du projet ou du nœud
  -b, --backend <backend>  Backend agent par défaut (codex, antigravity, brain) [défaut: codex]
  -c, --config <file>      Fichier de configuration JSON
  -C, --core <url>         URL de Nexus Core (ex: ws://vps.example.com:4040 ou http://localhost:4040)
  --node-id <id>           Identifiant unique du nœud Desktop
  -t, --token <token>      Jeton d'authentification pour Nexus Core
  -h, --help               Afficher cette aide
  -v, --version            Afficher la version

EXEMPLES:
  nexus-desktop start
  nexus-desktop start --project ./mon-projet
  nexus-desktop projects list
  nexus-desktop projects add /chemin/vers/projet --name MonProjet
  nexus-desktop projects set-default MonProjet
  nexus-desktop projects remove MonProjet
  nexus-desktop memory show
  nexus-desktop memory add "Choix SQLite" "Utiliser SQLite pour la persistance locale"
  nexus-desktop memory clear
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
  try {
    process.loadEnvFile?.();
  } catch {}

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

  if (command === 'projects' || command === 'project') {
    const subCommand = positionals[1] ?? 'list';
    const registry = loadProjectRegistry();

    if (subCommand === 'list') {
      const list = registry.list();
      const defaultProj = registry.getDefault();
      console.log('\n📂 PROJETS ENREGISTRÉS DANS NEXUS');
      console.log(`Registre : ${registry.getFilePath()}\n`);
      if (list.length === 0) {
        console.log('Aucun projet enregistré. Utilisez :');
        console.log('  nexus-desktop projects add <chemin> [--name <nom>]');
        return 0;
      }
      for (const p of list) {
        const isDefault = p.id === defaultProj?.id;
        const star = isDefault ? '⭐ [Défaut] ' : '   ';
        console.log(`${star}• ${p.name} (id: ${p.id})`);
        console.log(`     Chemin  : ${p.path}`);
        if (p.defaultBackend) {
          console.log(`     Backend : ${p.defaultBackend}`);
        }
      }
      console.log(`\nTotal : ${list.length} projet(s)`);
      return 0;
    }

    if (subCommand === 'add') {
      const targetPath = positionals[2];
      if (!targetPath) {
        console.error('Erreur : Spécifiez le chemin du projet à ajouter.');
        console.error('Usage  : nexus-desktop projects add <chemin> [--name <nom>]');
        return 1;
      }
      try {
        const backend =
          values.backend === 'codex' || values.backend === 'antigravity'
            ? values.backend
            : undefined;
        const added = registry.add({
          path: targetPath,
          name: values.name,
          defaultBackend: backend,
        });
        console.log(`✅ Projet enregistré avec succès : "${added.name}" (id: ${added.id})`);
        console.log(`   Chemin : ${added.path}`);
        return 0;
      } catch (err) {
        console.error(`❌ Erreur : ${err instanceof Error ? err.message : String(err)}`);
        return 1;
      }
    }

    if (subCommand === 'remove' || subCommand === 'rm') {
      const targetId = positionals[2];
      if (!targetId) {
        console.error('Erreur : Spécifiez l’ID ou le nom du projet à retirer.');
        console.error('Usage  : nexus-desktop projects remove <id>');
        return 1;
      }
      const removed = registry.remove(targetId);
      if (removed) {
        console.log(`✅ Projet retiré du registre : ${targetId}`);
        return 0;
      }
      console.error(`❌ Projet introuvable dans le registre : ${targetId}`);
      return 1;
    }

    if (subCommand === 'set-default' || subCommand === 'default') {
      const targetId = positionals[2];
      if (!targetId) {
        console.error('Erreur : Spécifiez l’ID ou le nom du projet par défaut.');
        console.error('Usage  : nexus-desktop projects set-default <id>');
        return 1;
      }
      try {
        const proj = registry.setDefault(targetId);
        console.log(`⭐ Projet par défaut défini : "${proj.name}" (id: ${proj.id})`);
        return 0;
      } catch (e: unknown) {
        console.error(`❌ ${e instanceof Error ? e.message : String(e)}`);
        return 1;
      }
    }

    console.error(`Sous-commande de projet inconnue : ${subCommand}`);
    console.error('Sous-commandes disponibles : list, add, remove, set-default');
    return 1;
  }

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

    if (command === 'memory') {
      const memorySub = positionals[1] ?? 'show';
      await node.start();
      const activeProject = node.getActiveProject();

      if (memorySub === 'show' || memorySub === 'list') {
        const snapshot = node.getProjectMemorySnapshot();
        console.log(`\n🧠 MÉMOIRE DU PROJET : ${activeProject.name}`);
        console.log(`• Fichier : ${snapshot.memoryFilePath}`);
        console.log(
          `• Existe  : ${snapshot.exists ? 'Oui' : 'Non (aucun fichier .nexus/memory.md)'}`
        );
        console.log(`• Décisions consignées : ${snapshot.decisions.length}`);
        if (snapshot.decisions.length > 0) {
          console.log('\n--- DÉCISIONS ARCHITECTURALES ---');
          for (const d of snapshot.decisions) {
            console.log(`• [${d.date}] ${d.title} (${d.status})`);
            console.log(`  ID : ${d.id}`);
            console.log(`  Décision : ${d.decision}`);
            if (d.context) {
              console.log(`  Contexte : ${d.context}`);
            }
            console.log('');
          }
        }
      } else if (memorySub === 'add') {
        const title = positionals[2];
        const decisionText = positionals.slice(3).join(' ').trim();
        if (!title || !decisionText) {
          console.error('Erreur : Titre et texte de décision requis.');
          console.error(
            'Exemple : nexus-desktop memory add "Choix SQLite" "Utiliser SQLite pour la persistance locale"'
          );
          await node.stop();
          return 1;
        }
        const recorded = node.recordProjectDecision({ title, decision: decisionText });
        console.log(
          `✅ Décision consignée avec succès (ID: ${recorded.id}) pour [${activeProject.name}]`
        );
      } else if (memorySub === 'clear') {
        node.clearProjectMemory();
        console.log(`🧹 Mémoire réinitialisée pour [${activeProject.name}]`);
      } else {
        console.error(
          `Sous-commande de mémoire inconnue : ${memorySub}. Utilisez show, add ou clear.`
        );
        await node.stop();
        return 1;
      }

      await node.stop();
      return 0;
    }

    console.error(
      `Commande inconnue : « ${command} ». Commandes valides : start, status, exec, projects, memory.`
    );
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
