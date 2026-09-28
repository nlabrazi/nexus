import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@vscode/test-cli';

// Activation must never reuse a developer's paired Telegram bot or saved credentials.
const profile = mkdtempSync(join(tmpdir(), 'nexus-extension-tests-'));
process.on('exit', () => {
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch {}
});

export default defineConfig({
  files: 'out/test/**/*.test.js',
  launchArgs: [
    `--user-data-dir=${join(profile, 'user')}`,
    `--extensions-dir=${join(profile, 'extensions')}`,
    '--skip-welcome',
    '--skip-release-notes',
  ],
  env: { NEXUS_LOG_DIR: join(profile, 'logs') },
  mocha: { timeout: 20000 },
});
