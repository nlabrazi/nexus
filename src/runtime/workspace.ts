import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
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

/** Resolves the default base directory for projects and code exploration (/code or ~/code). */
export function getDefaultCodeDirectory(): string {
  if (process.env.NEXUS_CODE_ROOT && existsSync(process.env.NEXUS_CODE_ROOT)) {
    return resolve(process.env.NEXUS_CODE_ROOT);
  }
  if (existsSync('/code') && statSync('/code').isDirectory()) {
    return '/code';
  }
  const homeCode = resolve(homedir(), 'code');
  if (existsSync(homeCode) && statSync(homeCode).isDirectory()) {
    return homeCode;
  }
  return process.cwd();
}
