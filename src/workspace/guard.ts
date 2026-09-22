import { execFile } from 'node:child_process';
import { lstat, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { workspaceEnvironment } from './environment';

const execute = promisify(execFile);
export const DEFAULT_PROTECTED_BRANCHES = ['main', 'master'];

export interface WorkspaceContext {
  trusted: boolean;
  folders: { scheme: string; path: string }[];
  dirtyDocuments: { scheme: string; path: string }[];
  protectedBranches: readonly string[];
}

export interface WorkspaceIdentity {
  root: string;
  git?: { directory: string; branch: string };
}

export interface WorkspaceBranch {
  name: string;
  localName: string;
  remote: boolean;
  current: boolean;
  protected: boolean;
}

export type WorkspaceValidator = (path: string) => Promise<WorkspaceIdentity>;
type GitRunner = (cwd: string, args: string[]) => Promise<string>;

export class WorkspaceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'WorkspaceError';
  }
}

export function assertSameWorkspace(
  expected: WorkspaceIdentity | undefined,
  actual: WorkspaceIdentity | undefined
): void {
  if (!expected && !actual) {
    return;
  }
  if (
    !expected ||
    !actual ||
    relative(expected.root, actual.root) !== '' ||
    expected.git?.directory !== actual.git?.directory ||
    expected.git?.branch !== actual.git?.branch
  ) {
    throw new WorkspaceError(
      'workspace_changed',
      `Le workspace ou la branche a changé depuis la sélection de la session (branche attendue : ${expected?.git?.branch ?? 'sans dépôt'}, actuelle : ${actual?.git?.branch ?? 'sans dépôt'}). Rétablissez le contexte précédent, ou utilisez /new ou /resume <id> explicitement.`
    );
  }
}

export class WorkspaceGuard {
  constructor(
    private readonly context: () => WorkspaceContext,
    private readonly git: GitRunner = runGit
  ) {}

  targetPath(): string {
    return this.target(this.context());
  }

  private target(context: WorkspaceContext): string {
    if (!context.trusted) {
      throw new WorkspaceError(
        'untrusted',
        'Le workspace n’est pas approuvé dans VS Code. Vérifiez sa confiance avant de lancer Codex.'
      );
    }
    if (context.folders.length !== 1) {
      throw new WorkspaceError(
        'ambiguous_workspace',
        context.folders.length === 0
          ? 'Aucun workspace ouvert. Ouvrez le dossier du projet dans VS Code.'
          : 'Plusieurs dossiers sont ouverts. Ouvrez uniquement le projet à cibler dans cette fenêtre avant de lancer Codex.'
      );
    }
    const folder = context.folders[0];
    if (folder.scheme !== 'file' || !isAbsolute(folder.path)) {
      throw new WorkspaceError(
        'unsupported_workspace',
        'Nexus nécessite un dossier accessible localement par l’extension (URI file et chemin absolu).'
      );
    }
    return folder.path;
  }

  async validate(path: string): Promise<WorkspaceIdentity> {
    return this.inspect(path, false);
  }

  private async inspect(path: string, forBranches: boolean): Promise<WorkspaceIdentity> {
    const context = this.context();
    const target = this.target(context);
    if (!isAbsolute(path)) {
      throw new WorkspaceError('invalid_root', 'Le chemin du workspace doit être absolu.');
    }
    let root: string;
    try {
      root = await realpath(path);
      if (!(await stat(root)).isDirectory()) {
        throw new Error('Not a directory');
      }
      if (dirname(root) === root) {
        throw new WorkspaceError(
          'invalid_root',
          'La racine du système de fichiers ne peut pas être utilisée comme projet Nexus.'
        );
      }
      if (relative(root, await realpath(target)) !== '') {
        throw new WorkspaceError(
          'wrong_workspace',
          'Le workspace demandé ne correspond pas au dossier ouvert dans VS Code.'
        );
      }
    } catch (error) {
      if (error instanceof WorkspaceError) {
        throw error;
      }
      throw new WorkspaceError(
        'workspace_missing',
        'Le dossier du workspace est absent ou inaccessible. Rouvrez un dossier existant dans VS Code.',
        { cause: error }
      );
    }
    await this.checkDirtyDocuments(root, context.dirtyDocuments);
    const git = await this.inspectGit(root, forBranches ? [] : context.protectedBranches);
    // VS Code can change while Git is being queried. Read editor state again before returning.
    const latest = this.context();
    if (relative(root, await realpath(this.target(latest))) !== '') {
      throw new WorkspaceError(
        'wrong_workspace',
        'Le dossier ouvert a changé pendant les vérifications. Relancez la demande depuis le projet voulu.'
      );
    }
    await this.checkDirtyDocuments(root, latest.dirtyDocuments);
    if (git && !forBranches) {
      this.checkProtectedBranch(git.branch, latest.protectedBranches);
    }
    return { root, ...(git ? { git } : {}) };
  }

  async listBranches(path: string): Promise<WorkspaceBranch[]> {
    const workspace = await this.inspect(path, true);
    if (!workspace.git) {
      throw new WorkspaceError('no_repository', 'Ce workspace ne contient pas de dépôt Git.');
    }
    const refs = await this.git(workspace.root, [
      'for-each-ref',
      '--sort=refname',
      '--format=%(refname)%09%(symref)',
      'refs/heads/',
      'refs/remotes/',
    ]);
    const protectedBranches = this.context().protectedBranches;
    return refs
      .trimEnd()
      .split('\n')
      .filter(Boolean)
      .flatMap((row) => {
        const [ref, symbolic] = row.split('\t');
        if (symbolic) {
          return [];
        }
        const remote = ref.startsWith('refs/remotes/');
        const name = ref.slice(remote ? 'refs/remotes/'.length : 'refs/heads/'.length);
        const localName = remote ? name.slice(name.indexOf('/') + 1) : name;
        return [
          {
            name,
            localName,
            remote,
            current: !remote && name === workspace.git!.branch,
            protected: protectedBranches.includes(localName),
          },
        ];
      });
  }

  async switchBranch(path: string, name: string): Promise<string> {
    const before = await this.inspect(path, true);
    const branches = await this.listBranches(path);
    // Prefer an exact local name; remote selections explicitly create a tracking branch.
    const branch =
      branches.find((branch) => !branch.remote && branch.name === name) ??
      branches.find((branch) => branch.remote && branch.name === name);
    if (!branch) {
      throw new WorkspaceError(
        'unknown_branch',
        'Branche inconnue. Consultez /branches et utilisez /switch <nom exact>.'
      );
    }
    this.checkProtectedBranch(branch.localName, this.context().protectedBranches);
    if (branch.current) {
      return branch.localName;
    }
    if (
      branch.remote &&
      branches.some((candidate) => !candidate.remote && candidate.name === branch.localName)
    ) {
      throw new WorkspaceError(
        'branch_exists',
        `La branche locale « ${branch.localName} » existe déjà. Utilisez /switch ${branch.localName}.`
      );
    }
    if (await this.git(before.root, ['status', '--porcelain', '--untracked-files=all'])) {
      throw new WorkspaceError(
        'dirty_worktree',
        'Le dépôt contient des modifications locales. Faites un commit ou un stash dans VS Code avant de changer de branche.'
      );
    }
    assertSameWorkspace(before, await this.inspect(path, true));
    this.checkProtectedBranch(branch.localName, this.context().protectedBranches);
    try {
      await this.git(
        before.root,
        branch.remote
          ? [
              'switch',
              '--no-guess',
              '--no-overwrite-ignore',
              '--track',
              '-c',
              branch.localName,
              `refs/remotes/${branch.name}`,
            ]
          : ['switch', '--no-guess', '--no-overwrite-ignore', '--', branch.name]
      );
    } catch (error) {
      const detail = (error as { stderr?: string }).stderr?.trim();
      throw new WorkspaceError(
        'switch_failed',
        `Git a refusé le changement de branche. ${detail || 'Vérifiez git status dans VS Code.'}`,
        { cause: error }
      );
    }
    return branch.localName;
  }

  private async checkDirtyDocuments(
    root: string,
    documents: WorkspaceContext['dirtyDocuments']
  ): Promise<void> {
    for (const document of documents) {
      if (document.scheme === 'untitled') {
        throw new WorkspaceError(
          'unsaved_documents',
          'Un document sans fichier est non sauvegardé. Enregistrez-le ou fermez-le avant de lancer Codex.'
        );
      }
      if (document.scheme !== 'file') {
        continue;
      }
      const path = resolve(document.path);
      let canonical = path;
      try {
        canonical = await realpath(path);
      } catch {
        // A deleted/new file may still live beneath a symlinked workspace directory.
        try {
          canonical = join(await realpath(dirname(path)), basename(path));
        } catch {
          /* Keep the lexical path. */
        }
      }
      if (
        [path, canonical].some((candidate) => {
          const local = relative(root, candidate);
          return (
            local === '' || (local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local))
          );
        })
      ) {
        throw new WorkspaceError(
          'unsaved_documents',
          `Fichier non sauvegardé : ${document.path}. Enregistrez les modifications dans VS Code avant de lancer Codex.`
        );
      }
    }
  }

  private async inspectGit(
    root: string,
    protectedBranches: readonly string[]
  ): Promise<WorkspaceIdentity['git']> {
    try {
      let inside: string;
      try {
        inside = await this.git(root, ['rev-parse', '--is-inside-work-tree']);
      } catch (error) {
        const failure = error as { code?: number | string; stderr?: string };
        if (
          failure.code === 128 &&
          failure.stderr?.includes('not a git repository') &&
          !(await hasGitMarker(root))
        ) {
          return undefined;
        }
        throw error;
      }
      if (line(inside) !== 'true') {
        throw new WorkspaceError(
          'invalid_root',
          'Ce dossier n’est pas un arbre de travail Git. Ouvrez la racine du projet, pas son dossier .git ni un dépôt bare.'
        );
      }
      const [top, directory] = await Promise.all([
        this.git(root, ['rev-parse', '--show-toplevel']),
        this.git(root, ['rev-parse', '--absolute-git-dir']),
      ]);
      const gitRoot = await realpath(line(top));
      if (relative(root, gitRoot) !== '') {
        throw new WorkspaceError(
          'invalid_root',
          `Ouvrez la racine du dépôt Git dans VS Code : ${gitRoot}. Le dossier actuellement ouvert est un sous-dossier.`
        );
      }
      const gitDirectory = await realpath(line(directory));
      const operations = [
        ['MERGE_HEAD', 'merge'],
        ['rebase-merge', 'rebase'],
        ['rebase-apply', 'rebase ou git am'],
        ['CHERRY_PICK_HEAD', 'cherry-pick'],
        ['REVERT_HEAD', 'revert'],
        ['sequencer', 'séquence Git'],
        ['BISECT_LOG', 'bisect'],
        ['index.lock', 'écriture de l’index Git'],
      ];
      for (const [marker, operation] of operations) {
        if (await exists(join(gitDirectory, marker))) {
          throw new WorkspaceError(
            'git_operation',
            `Une opération ${operation} est en cours. Terminez-la ou annulez-la dans Git avant de lancer Codex.`
          );
        }
      }
      if (await this.git(root, ['ls-files', '--unmerged', '-z'])) {
        throw new WorkspaceError(
          'git_conflicts',
          'Le dépôt contient des conflits Git non résolus. Résolvez-les avant de lancer Codex.'
        );
      }
      let branch: string;
      try {
        branch = line(await this.git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']));
      } catch (error) {
        if ((error as { code?: number }).code === 1) {
          throw new WorkspaceError(
            'detached_head',
            'Git est en HEAD détachée. Sélectionnez une branche de travail avant de lancer Codex.'
          );
        }
        throw error;
      }
      if (!branch) {
        throw new Error('Missing branch');
      }
      this.checkProtectedBranch(branch, protectedBranches);
      return { directory: gitDirectory, branch };
    } catch (error) {
      if (error instanceof WorkspaceError) {
        throw error;
      }
      throw new WorkspaceError(
        'git_unavailable',
        'Impossible de vérifier Git. Vérifiez « git status » et « git --version » dans le terminal de ce projet avant de réessayer.',
        { cause: error }
      );
    }
  }

  private checkProtectedBranch(branch: string, protectedBranches: readonly string[]): void {
    if (protectedBranches.includes(branch)) {
      throw new WorkspaceError(
        'protected_branch',
        `La branche « ${branch} » est protégée par Nexus. Utilisez /branches puis /switch <branche> pour sélectionner une branche de travail, ou adaptez nexus.git.protectedBranches dans les paramètres VS Code.`
      );
    }
  }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  // An inherited GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE must never redirect these checks.
  const { stdout } = await execute(
    'git',
    ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', cwd, ...args],
    {
      env: { ...workspaceEnvironment(), LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' },
      timeout: 5000,
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
      windowsHide: true,
    }
  );
  return stdout;
}

function line(value: string): string {
  // Preserve spaces (and embedded newlines) that are valid in filesystem paths.
  return value.replace(/\r?\n$/, '');
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function hasGitMarker(path: string): Promise<boolean> {
  for (let current = path; ; current = dirname(current)) {
    if (await exists(join(current, '.git'))) {
      return true;
    }
    if (dirname(current) === current) {
      return false;
    }
  }
}
