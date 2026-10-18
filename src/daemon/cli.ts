import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { AuthGuard, getOrCreateDaemonToken } from '../security/auth';
import { JailGuard } from '../security/jail';
import { NexusDaemonServer } from './daemon-server';

function getTailscaleIp(): string | undefined {
  const nets = networkInterfaces();
  for (const [name, addrs] of Object.entries(nets)) {
    if (name.includes('tailscale')) {
      for (const addr of addrs ?? []) {
        if (addr.family === 'IPv4' && !addr.internal) {
          return addr.address;
        }
      }
    }
  }
  return undefined;
}

export async function runDaemonCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const envCandidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.env.HOME ?? '', 'code/bricolage/nexus/.env'),
  ];
  for (const p of envCandidates) {
    if (existsSync(p)) {
      try {
        process.loadEnvFile?.(p);
        break;
      } catch {}
    }
  }
  const optionsConfig = {
    port: { type: 'string' as const, short: 'p' },
    host: { type: 'string' as const, short: 'H' },
    root: { type: 'string' as const, short: 'r' },
    token: { type: 'string' as const, short: 't' },
    project: { type: 'string' as const },
    tailscale: { type: 'boolean' as const, default: false },
    help: { type: 'boolean' as const, short: 'h', default: false },
  };

  const parsed = parseArgs({
    args: argv,
    options: optionsConfig,
    allowPositionals: true,
  });

  if (parsed.values.help) {
    console.log(`
🛡️ Nexus Secure Daemon
Daemon local unifié et sécurisé pour piloter Codex, Antigravity et vos projets dev.

USAGE:
  nexus-daemon [OPTIONS]

OPTIONS:
  -p, --port <port>        Port d'écoute (défaut: 4040 ou NEXUS_PORT)
  -H, --host <host>        Adresse d'écoute (défaut: 127.0.0.1)
  -r, --root <dir>         Racine autorisée pour le confinement (défaut: ~/code ou cwd)
  -t, --token <token>      Jeton d'authentification Bearer (défaut: généré dans ~/.nexus/daemon.token)
      --project <dir>      Dossier de projet actif au démarrage
      --tailscale          Lie le daemon à l'adresse IP de l'interface Tailscale
  -h, --help               Afficher cette aide
`);
    return 0;
  }

  const port = parseInt(parsed.values.port ?? process.env.NEXUS_PORT ?? '4040', 10);
  let host = parsed.values.host ?? '127.0.0.1';

  if (parsed.values.tailscale) {
    const tsIp = getTailscaleIp();
    if (tsIp) {
      host = tsIp;
    } else {
      console.warn('⚠️ Interface Tailscale non détectée, écoute par défaut sur 127.0.0.1');
    }
  }

  // Confinement root (jail)
  const defaultRoot = resolve(process.env.HOME ?? '.', 'code');
  const allowedRoot = resolve(
    parsed.values.root ?? (existsSync(defaultRoot) ? defaultRoot : process.cwd())
  );
  const jail = new JailGuard({ allowedRoots: [allowedRoot] });

  // Security Auth
  const token = getOrCreateDaemonToken(parsed.values.token ?? process.env.NEXUS_TOKEN);
  const auth = new AuthGuard([token]);

  const cwd = process.cwd();
  const initialProject = parsed.values.project
    ? resolve(parsed.values.project)
    : jail.isPathAllowed(cwd)
      ? cwd
      : allowedRoot;

  const daemon = new NexusDaemonServer({
    port,
    host,
    jail,
    auth,
    initialProject,
  });

  await daemon.start();

  console.log('================================================================');
  console.log('  🛡️ NEXUS SECURE DAEMON v1.0.0');
  console.log('================================================================');
  console.log(`  • URL HTTP & WS  : http://${host}:${port}`);
  console.log(`  • Confinement    : ${allowedRoot} (🔒 Jail étanche actif)`);
  console.log(
    `  • Interface      : ${host === '127.0.0.1' ? '127.0.0.1 (Local uniquement)' : `${host} (VPN Tailscale)`}`
  );
  console.log(`  • Jeton Bearer   : ${token}`);
  console.log('================================================================');
  console.log('Daemon actif et sécurisé. En attente de connexions (Ctrl+C pour quitter)...');

  const shutdown = async () => {
    console.log('\nInterruption reçue, arrêt du daemon sécurisé...');
    await daemon.stop();
    console.log('Daemon arrêté avec succès.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return 0;
}

if (require.main === module) {
  runDaemonCli().catch((err) => {
    console.error('Erreur fatale au démarrage du daemon :', err);
    process.exit(1);
  });
}
