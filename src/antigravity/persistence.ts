import {
  SavedSession,
  SessionPersistence,
  WorkspaceSessionPersistence,
  WorkspaceStorage,
} from '../codex/persistence';

export { SavedSession };
export type AntigravitySessionPersistence = SessionPersistence;

const KEY = 'nexus.antigravity.session';

/** VS Code workspaceState provides workspace-isolated storage for Antigravity sessions. */
export class WorkspaceAntigravitySessionPersistence extends WorkspaceSessionPersistence {
  constructor(storage: WorkspaceStorage) {
    super(storage, KEY);
  }
}
