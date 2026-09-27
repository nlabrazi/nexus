#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createCoreTelegramService } from '../telegram/core-bridge';
import { NexusCore } from './nexus-core';

export * from './types';
export * from './presence';
export * from './ws-connection';
export * from './task-router';
export * from './nexus-core';

const VERSION = '0.4.1';

const HELP_TEXT = `
Nexus Core Server (v${VERSION})
Serveur central de coordination et de suivi de présence des Desktop Nodes.

USAGE:
  nexus-core [OPTIONS]

OPTIONS:
  -p, --port <port>        Port d'écoute HTTP (défaut: 4040 ou NEXUS_CORE_PORT)
  -H, --host <host>        Adresse d'écoute (défaut: 127.0.0.1 ou NEXUS_CORE_HOST)
  -t, --token <token>      Jeton(s) d'authentification admis (ou NEXUS_CORE_AUTH_TOKENS)
  -T, --telegram-token <t> Jeton Telegram Bot pour démarrer le bot relié à Core (ou TELEGRAM_BOT_TOKEN)
  --public-dir <dir>       Répertoire des fichiers statiques Web PWA (ou NEXUS_PUBLIC_DIR)
  -h, --help               Afficher cette aide
  -v, --version            Afficher la version

EXEMPLES:
  nexus-core --port 4040 --token secret-token-123
  nexus-core --port 4040 --token secret-token-123 --telegram-token 123456:ABC-DEF
  NEXUS_CORE_PORT=4040 NEXUS_CORE_AUTH_TOKENS=mon-token nexus-core
`;

export async function runCoreCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    process.loadEnvFile?.();
  } catch { }

  const optionsConfig = {
    port: { type: 'string' as const, short: 'p' },
    host: { type: 'string' as const, short: 'H' },
    token: { type: 'string' as const, short: 't' },
    'telegram-token': { type: 'string' as const, short: 'T' },
    'public-dir': { type: 'string' as const },
    help: { type: 'boolean' as const, short: 'h', default: false },
    version: { type: 'boolean' as const, short: 'v', default: false },
  };

  let parsed: {
    values: {
      port?: string;
      host?: string;
      token?: string;
      'telegram-token'?: string;
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

  if (values.help) {
    console.log(HELP_TEXT.trim());
    return 0;
  }

  if (values.version) {
    console.log(`nexus-core v${VERSION}`);
    return 0;
  }

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
    // Generate a temporary development token if none provided
    const devToken = randomBytes(16).toString('hex');
    authTokens = [devToken];
    console.warn(`[Nexus Security] Aucun jeton spécifié. Jeton temporaire généré : ${devToken}`);
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

    const telegramToken =
      values['telegram-token'] ??
      process.env.TELEGRAM_BOT_TOKEN ??
      process.env.NEXUS_TELEGRAM_TOKEN;
    let telegram: ReturnType<typeof createCoreTelegramService> | undefined;
    let telegramPolling: Promise<void> | undefined;

    if (telegramToken) {
      telegram = createCoreTelegramService(core, telegramToken);
      const envUserId = process.env.TELEGRAM_ALLOWED_USER_ID;
      const envChatId = process.env.TELEGRAM_ALLOWED_CHAT_ID ?? envUserId;
      if (envUserId) {
        await telegram.context.globalState.update(
          'nexus.telegram.allowedUserId',
          parseInt(envUserId, 10)
        );
        if (envChatId) {
          await telegram.context.globalState.update(
            'nexus.telegram.allowedChatId',
            parseInt(envChatId, 10)
          );
        }
      }
      telegramPolling = telegram.service.start();
    }

    console.log('================================================================');
    console.log(`  🌐 NEXUS CORE SERVER v${VERSION}`);
    console.log('================================================================');
    console.log(`  • URL HTTP       : http://${host}:${port}`);
    console.log(`  • Jetons admis   : ${authTokens.length} configuré(s)`);
    console.log('  • Heartbeat      : 15s (délai de grâce 45s)');
    if (publicDir) {
      console.log(`  • Web PWA Client : Actif (http://${host}:${port}/)`);
    }
    if (telegramToken && telegram) {
      const allowedUser = telegram.context.globalState.get<number>('nexus.telegram.allowedUserId');
      if (allowedUser !== undefined) {
        console.log(`  • Telegram Bot   : Actif et appairé (utilisateur ID ${allowedUser})`);
      } else {
        const pairingCode = telegram.service.createPairingCode();
        console.log('  • Telegram Bot   : Actif (routage agents via Core)');
        console.log(`  👉 Appairage     : Envoyez "/pair ${pairingCode}" à votre bot sur Telegram`);
      }
    }
    console.log('================================================================');
    console.log('Nexus Core actif. En attente de connexions (Ctrl+C pour quitter)...');

    const shutdown = async () => {
      console.log('\nInterruption reçue, arrêt de Nexus Core...');
      if (telegram) {
        await telegram.service.stop();
        if (telegramPolling) {
          try {
            await telegramPolling;
          } catch { }
        }
      }
      await core.stop();
      console.log('Nexus Core arrêté avec succès.');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Keep running
    await new Promise<void>(() => { });
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
