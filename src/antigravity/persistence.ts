import { isAbsolute } from 'path';
import { WorkspaceIdentity } from '../workspace/guard';

export interface SavedSession {
  version: 1;
  id: string;
  workspace: WorkspaceIdentity;
}

export interface AntigravitySessionPersistence {
  load(): SavedSession | undefined;
  save(session: SavedSession): Promise<void>;
}

interface WorkspaceStorage {
  get(key: string): unknown;
  update(key: string, value: unknown): PromiseLike<void>;
}

const KEY = 'nexus.antigravity.session';

/** VS Code workspaceState provides workspace-isolated storage for Antigravity sessions. */
export class WorkspaceAntigravitySessionPersistence implements AntigravitySessionPersistence {
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly storage: WorkspaceStorage) { }

  load(): SavedSession | undefined {
    const value = this.storage.get(KEY) as Partial<SavedSession> | undefined;
    if (
      !value ||
      value.version !== 1 ||
      typeof value.id !== 'string' ||
      !value.id ||
      /\s/.test(value.id)
    ) {
      return undefined;
    }

    const workspace = value.workspace;
    if (!workspace || typeof workspace.root !== 'string' || !isAbsolute(workspace.root)) {
      return undefined;
    }

    const git = workspace.git;
    if (
      git !== undefined &&
      (!git ||
        typeof git.directory !== 'string' ||
        !isAbsolute(git.directory) ||
        typeof git.branch !== 'string' ||
        !git.branch.trim())
    ) {
      return undefined;
    }

    return {
      version: 1,
      id: value.id,
      workspace: { root: workspace.root, ...(git ? { git: { ...git } } : {}) },
    };
  }

  save(session: SavedSession): Promise<void> {
    const snapshot = structuredClone(session);
    const write = this.pending.catch(() => { }).then(async () => {
      await this.storage.update(KEY, snapshot);
    });
    this.pending = write;
    return write;
  }
}
