import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertSameWorkspace, WorkspaceIdentity } from '../workspace/guard';
import { DecisionRecordInput, ProjectDecision, ProjectMemorySnapshot } from '../memory/types';
import { ProjectMemory } from '../memory/project-memory';
import { ConversationProjectContext } from './types';

export interface ProjectStatus {
  readonly project: ConversationProjectContext;
  readonly inspectionAvailable: boolean;
}

export interface InspectionConsent {
  readonly id: string;
  readonly question: string;
  readonly project: ConversationProjectContext;
  readonly expiresAt: number;
}

/** Implemented only by adapters that enforce read-only execution. */
export interface ProjectInspector {
  inspect(question: string, workspace: WorkspaceIdentity, signal: AbortSignal): Promise<string>;
}

export interface CodingAgentToolsOptions {
  resolveWorkspace: () => Promise<WorkspaceIdentity>;
  inspector?: ProjectInspector;
  requestConsent?: (request: InspectionConsent, signal: AbortSignal) => Promise<boolean>;
  projectMemory?: ProjectMemory;
}

const CONSENT_TIMEOUT_MS = 60_000;

/** The model supplies a question; the application owns the target and authorization. */
export class CodingAgentTools {
  private inspecting = false;
  private readonly memory: ProjectMemory;

  constructor(private readonly options: CodingAgentToolsOptions) {
    this.memory = options.projectMemory ?? new ProjectMemory();
  }

  async getProjectMemory(signal: AbortSignal): Promise<ProjectMemorySnapshot> {
    signal.throwIfAborted();
    const workspace = await this.options.resolveWorkspace();
    signal.throwIfAborted();
    return this.memory.getSnapshot(workspace.root);
  }

  async recordDecision(input: DecisionRecordInput, signal: AbortSignal): Promise<ProjectDecision> {
    signal.throwIfAborted();
    const workspace = await this.options.resolveWorkspace();
    signal.throwIfAborted();
    return this.memory.recordDecision(workspace.root, input);
  }

  async getProjectStatus(signal: AbortSignal): Promise<ProjectStatus> {
    signal.throwIfAborted();
    const workspace = await this.options.resolveWorkspace();
    signal.throwIfAborted();
    return {
      project: projectContext(workspace),
      inspectionAvailable: Boolean(this.options.inspector && this.options.requestConsent),
    };
  }

  async inspectProject(question: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    const trimmed = question.trim();
    if (!trimmed || trimmed.length > 4000) {
      throw new Error('La question d’inspection doit contenir entre 1 et 4000 caractères.');
    }
    const { inspector, requestConsent } = this.options;
    if (!inspector || !requestConsent) {
      throw new Error('L’inspection en lecture seule est indisponible.');
    }
    if (this.inspecting) {
      throw new Error('Une inspection est déjà en cours.');
    }
    this.inspecting = true;
    try {
      const workspace = structuredClone(await this.options.resolveWorkspace());
      signal.throwIfAborted();
      const expiresAt = Date.now() + CONSENT_TIMEOUT_MS;
      const consent = new AbortController();
      const consentSignal = AbortSignal.any([signal, consent.signal]);
      const timer = setTimeout(() => consent.abort(), CONSENT_TIMEOUT_MS);
      let accepted = false;
      try {
        accepted = await abortable(
          () =>
            requestConsent(
              {
                id: randomUUID(),
                question: trimmed,
                project: projectContext(workspace),
                expiresAt,
              },
              consentSignal
            ),
          consentSignal
        );
      } catch {
        // An unavailable UI, timeout or cancellation never grants permission.
      } finally {
        clearTimeout(timer);
        consent.abort();
      }
      signal.throwIfAborted();
      if (accepted !== true || Date.now() >= expiresAt) {
        throw new Error('Inspection non autorisée ou demande expirée.');
      }
      assertSameWorkspace(workspace, await this.options.resolveWorkspace());
      signal.throwIfAborted();
      if (Date.now() >= expiresAt) throw new Error('La demande d’inspection a expiré.');
      const result = await inspector.inspect(trimmed, workspace, signal);
      signal.throwIfAborted();
      assertSameWorkspace(workspace, await this.options.resolveWorkspace());
      signal.throwIfAborted();
      return result;
    } finally {
      this.inspecting = false;
    }
  }
}

function projectContext(workspace: WorkspaceIdentity): ConversationProjectContext {
  return {
    name: basename(workspace.root),
    ...(workspace.git ? { branch: workspace.git.branch } : {}),
  };
}

/** Reject promptly on abort, even if the external approval UI never settles. */
async function abortable<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        signal.throwIfAborted();
        return operation();
      }),
      cancelled,
    ]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
