import { DEFAULT_PROTECTED_BRANCHES, WorkspaceGuard } from '../workspace/guard';
import { StandaloneWorkspaceGuardOptions } from './types';

export function createStandaloneWorkspaceGuard(
  targetPath: string,
  options?: StandaloneWorkspaceGuardOptions
): WorkspaceGuard {
  const protectedBranches = options?.protectedBranches ?? DEFAULT_PROTECTED_BRANCHES;
  const trusted = options?.trusted ?? true;

  return new WorkspaceGuard(() => ({
    trusted,
    folders: [{ scheme: 'file', path: targetPath }],
    dirtyDocuments: [],
    protectedBranches,
  }));
}
