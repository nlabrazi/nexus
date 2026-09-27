import {
  NodeCapabilities,
  NodeHeartbeatPayload,
  NodeHelloPayload,
  NodeProjectSummary,
  NodeState,
  NodeStatusPayload,
  TaskBackend,
} from '../protocol/types';
import { TaskExecutionResult } from '../runtime/types';
import { NexusStatusSnapshot } from '../telegram/status';

export interface DesktopProjectConfig {
  readonly id?: string;
  readonly name?: string;
  readonly path: string;
  readonly protectedBranches?: readonly string[];
}

export interface DesktopNodeConfig {
  readonly nodeId?: string;
  readonly nodeName?: string;
  readonly authToken?: string;
  readonly projects: readonly DesktopProjectConfig[];
  readonly defaultBackend?: TaskBackend;
  readonly protectedBranches?: readonly string[];
}

export interface DesktopNodeStatus {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly state: NodeState;
  readonly activeTaskId?: string;
  readonly projects: readonly NodeProjectSummary[];
  readonly activeProject: NodeProjectSummary;
  readonly capabilities: NodeCapabilities;
  readonly uptimeSeconds: number;
  readonly runtimeStatus: NexusStatusSnapshot;
}

export interface DesktopTaskOptions {
  readonly projectId?: string;
  readonly onFilesChanged?: (paths: readonly string[]) => void;
  readonly signal?: AbortSignal;
}

export interface DesktopBrainOptions {
  readonly projectId?: string;
  readonly conversationId?: string;
}

export interface DesktopExecutionResult extends TaskExecutionResult {
  readonly projectId: string;
  readonly projectPath: string;
}

export {
  NodeCapabilities,
  NodeHeartbeatPayload,
  NodeHelloPayload,
  NodeProjectSummary,
  NodeState,
  NodeStatusPayload,
  TaskBackend,
};
