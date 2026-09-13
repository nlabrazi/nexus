const { execFileSync } = require('node:child_process');
const { mkdirSync, existsSync, writeFileSync, realpathSync, lstatSync } = require('node:fs');
const { join, resolve } = require('node:path');
// Setup is local-only; inherited Git variables must not select another repository.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));

const base = resolve(__dirname, '..', '.nexus-dev');
const project = join(base, 'project');
for (const directory of [base, project]) {
  mkdirSync(directory, { recursive: true });
  if (lstatSync(directory).isSymbolicLink()) {
    throw new Error(`Le dossier de test ne doit pas être un lien symbolique : ${directory}`);
  }
}
const git = (...args) => execFileSync('git', ['--no-optional-locks', '-C', project, ...args], {
  encoding: 'utf8', env, timeout: 5000,
});
if (!existsSync(join(project, '.git'))) {
  git('init', '--template=', '-b', 'nexus-test');
}
const root = git('rev-parse', '--show-toplevel').replace(/\r?\n$/, '');
if (realpathSync(root) !== realpathSync(project)) {
  throw new Error('Le dossier de test doit posséder son propre dépôt Git.');
}
try {
  writeFileSync(join(project, 'README.md'), '# Projet de test Nexus\n\nCe dépôt sert aux essais Telegram. Ses fichiers sont conservés entre deux lancements F5.\n', { flag: 'wx' });
} catch (error) {
  if (error.code !== 'EEXIST') { throw error; }
}
console.log(`Dossier de test prêt : ${project}`);
console.log(`Branche : ${git('symbolic-ref', '--short', 'HEAD').trim()}`);
