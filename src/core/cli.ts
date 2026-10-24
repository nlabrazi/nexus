#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { initializeLogging } from '../logging/persistence';
import { logger, registerLogSecret } from '../logging/logger';
import { parseArgs } from 'node:util';
import { NexusCore } from './nexus-core';

export * from './types';
export * from './presence';
export * from './ws-connection';
export * from './task-router';
export * from './nexus-core';

const VERSION = '1.3.0';

const HELP_TEXT = `
Nexus Core Server (v${VERSION})
Serveur central de coordination et de suivi de présence des Desktop Nodes.

USAGE:
  nexus-core [OPTIONS]

OPTIONS:
  -p, --port <port>        Port d'écoute HTTP (défaut: 4040 ou NEXUS_CORE_PORT)
  -H, --host <host>        Adresse d'écoute (défaut: 127.0.0.1 ou NEXUS_CORE_HOST)
  -t, --token <token>      Jeton(s) d'authentification admis (ou NEXUS_CORE_AUTH_TOKENS)
  --public-dir <dir>       Répertoire des fichiers statiques Web PWA (ou NEXUS_PUBLIC_DIR)
  -h, --help               Afficher cette aide
  -v, --version            Afficher la version

EXEMPLES:
  nexus-core --port 4040 --token secret-token-123
  NEXUS_CORE_PORT=4040 NEXUS_CORE_AUTH_TOKENS=mon-token nexus-core
`;

export async function runCoreCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    process.loadEnvFile?.();
  } catch {}

  const optionsConfig = {
    port: { type: 'string' as const, short: 'p' },
    host: { type: 'string' as const, short: 'H' },
    token: { type: 'string' as const, short: 't' },
    'public-dir': { type: 'string' as const },
    help: { type: 'boolean' as const, short: 'h', default: false },
    version: { type: 'boolean' as const, short: 'v', default: false },
  };

  let parsed: {
    values: {
      port?: string;
      host?: string;
      token?: string;
      'public-dir'?: string;
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

  const { values } = parsed;
  if (values.token) registerLogSecret(values.token);

  if (values.help) {
    console.log(HELP_TEXT.trim());
    return 0;
  }

  if (values.version) {
    console.log(`nexus-core v${VERSION}`);
    return 0;
  }

  initializeLogging('core');

  const port = Number(values.port ?? process.env.NEXUS_CORE_PORT ?? 4040);
  const host = values.host ?? process.env.NEXUS_CORE_HOST ?? '127.0.0.1';

  const rawTokens =
    values.token ?? process.env.NEXUS_CORE_AUTH_TOKENS ?? process.env.NEXUS_AUTH_TOKEN;
  let authTokens: string[];
  if (rawTokens) {
    authTokens = rawTokens
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  } else {
    logger.error('Core', 'configure_auth', { status: 'missing_token' });
    process.stderr.write(
      'Configurez NEXUS_CORE_AUTH_TOKENS dans .env avant de démarrer Nexus Core.\n'
    );
    return 1;
  }

  try {
    const publicDirCandidate =
      values['public-dir'] ??
      process.env.NEXUS_PUBLIC_DIR ??
      (existsSync(join(__dirname, '../web/.output/public'))
        ? join(__dirname, '../web/.output/public')
        : existsSync(join(__dirname, 'web'))
          ? join(__dirname, 'web')
          : undefined);
    const publicDir =
      publicDirCandidate && existsSync(publicDirCandidate) ? publicDirCandidate : undefined;

    const core = new NexusCore({
      port,
      host,
      authTokens,
      publicDir,
    });

    await core.start();

    console.log('================================================================');
    console.log(`  🌐 NEXUS CORE SERVER v${VERSION}`);
    console.log('================================================================');
    console.log(`  • URL HTTP       : http://${host}:${port}`);
    console.log(`  • Jetons admis   : ${authTokens.length} configuré(s)`);
    console.log('  • Heartbeat      : 15s (délai de grâce 45s)');
    if (publicDir) {
      console.log(`  • Web PWA Client : Actif (http://${host}:${port}/)`);
    }
    console.log('================================================================');
    console.log('Nexus Core actif. En attente de connexions (Ctrl+C pour quitter)...');

    const shutdown = async () => {
      console.log('\nInterruption reçue, arrêt de Nexus Core...');
      await core.stop();
      console.log('Nexus Core arrêté avec succès.');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Keep running
    await new Promise<void>(() => {});
    return 0;
  } catch (error) {
    console.error(
      `\n❌ Erreur de démarrage Nexus Core : ${error instanceof Error ? error.message : String(error)}`
    );
    return 1;
  }
}

if (require.main === module) {
  runCoreCli().then((code) => {
    if (code !== 0) {
      process.exit(code);
    }
  });
}
