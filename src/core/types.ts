import {
  NodeCapabilities,
  NodeHeartbeatAckPayload,
  NodeHeartbeatPayload,
  NodeHelloPayload,
  NodeProjectSummary,
  NodeState,
  NodeStatusPayload,
  NodeWelcomePayload,
  TaskBackend,
  TaskCompletedPayload,
  TaskFailedPayload,
  TaskStage,
} from '../protocol/types';

export interface CoreConfig {
  readonly port?: number;
  readonly host?: string;
  readonly authTokens: readonly string[];
  readonly heartbeatIntervalMs?: number;
  readonly heartbeatTimeoutMs?: number;
  readonly defaultTaskTimeoutMs?: number;
}

export type RemoteTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface RemoteTask {
  readonly taskId: string;
  readonly backend: TaskBackend;
  readonly prompt: string;
  readonly projectId?: string;
  readonly nodeId: string;
  status: RemoteTaskStatus;
  stage?: TaskStage;
  progressMessage?: string;
  activeTool?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: TaskCompletedPayload;
  error?: TaskFailedPayload['error'];
}

export interface SubmitTaskOptions {
  readonly backend: TaskBackend;
  readonly prompt: string;
  readonly taskId?: string;
  readonly projectId?: string;
  readonly nodeId?: string;
  readonly sessionId?: string;
  readonly traceId?: string;
}

export interface ConnectedNode {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly version: string;
  readonly sessionId: string;
  readonly connectedAt: number;
  lastHeartbeatAt: number;
  state: NodeState;
  online: boolean;
  capabilities: NodeCapabilities;
  projects: readonly NodeProjectSummary[];
  activeTaskId?: string;
  activeProject?: NodeProjectSummary;
}

export interface CoreStatusSnapshot {
  readonly uptimeSeconds: number;
  readonly totalNodes: number;
  readonly onlineNodes: number;
  readonly nodes: readonly ConnectedNode[];
  readonly projects: readonly NodeProjectSummary[];
  readonly activeTasks?: number;
}

export interface CoreEventMap {
  'node:connected': (node: ConnectedNode) => void;
  'node:heartbeat': (node: ConnectedNode) => void;
  'node:status': (node: ConnectedNode) => void;
  'node:offline': (node: ConnectedNode) => void;
  'node:disconnected': (node: ConnectedNode) => void;
  'task:started': (task: RemoteTask) => void;
  'task:progress': (task: RemoteTask) => void;
  'task:completed': (task: RemoteTask) => void;
  'task:failed': (task: RemoteTask) => void;
  'task:cancelled': (task: RemoteTask) => void;
}

export {
  NodeCapabilities,
  NodeHeartbeatAckPayload,
  NodeHeartbeatPayload,
  NodeHelloPayload,
  NodeProjectSummary,
  NodeState,
  NodeStatusPayload,
  NodeWelcomePayload,
};
