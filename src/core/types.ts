import {
  NodeCapabilities,
  NodeHeartbeatAckPayload,
  NodeHeartbeatPayload,
  NodeHelloPayload,
  NodeProjectSummary,
  NodeState,
  NodeStatusPayload,
  NodeWelcomePayload,
} from '../protocol/types';

export interface CoreConfig {
  readonly port?: number;
  readonly host?: string;
  readonly authTokens: readonly string[];
  readonly heartbeatIntervalMs?: number;
  readonly heartbeatTimeoutMs?: number;
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
}

export interface CoreEventMap {
  'node:connected': (node: ConnectedNode) => void;
  'node:heartbeat': (node: ConnectedNode) => void;
  'node:status': (node: ConnectedNode) => void;
  'node:offline': (node: ConnectedNode) => void;
  'node:disconnected': (node: ConnectedNode) => void;
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
