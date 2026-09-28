import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { nodeOfflineError, unauthenticatedError } from '../protocol/errors';
import {
  ConnectedNode,
  NodeHeartbeatAckPayload,
  NodeHeartbeatPayload,
  NodeHelloPayload,
  NodeProjectSummary,
  NodeStatusPayload,
  NodeWelcomePayload,
} from './types';

export interface PresenceManagerOptions {
  readonly authTokens: readonly string[];
  readonly heartbeatIntervalMs?: number;
  readonly heartbeatTimeoutMs?: number;
}

export class NodePresenceManager extends EventEmitter {
  private readonly nodes = new Map<string, ConnectedNode>();
  private readonly sessions = new Map<string, string>(); // sessionId -> nodeId
  private readonly authTokens: Set<string>;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;
  private livenessTimer?: NodeJS.Timeout;

  constructor(options: PresenceManagerOptions) {
    super();
    this.authTokens = new Set(options.authTokens);
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15_000;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 45_000;
  }

  registerNode(hello: NodeHelloPayload): NodeWelcomePayload {
    if (!this.authTokens.has(hello.authToken)) {
      throw unauthenticatedError('Jeton d’authentification invalide ou manquant.');
    }

    const sessionId = randomUUID();
    const existing = this.nodes.get(hello.nodeId);

    const now = Date.now();
    const connectedNode: ConnectedNode = {
      nodeId: hello.nodeId,
      nodeName: hello.nodeName,
      version: hello.version,
      sessionId,
      connectedAt: existing?.connectedAt ?? now,
      lastHeartbeatAt: now,
      state: 'idle',
      online: true,
      capabilities: hello.capabilities,
      projects: hello.projects,
      activeProject: hello.projects[0],
    };

    // If previous session existed, clean it up
    if (existing?.sessionId) {
      this.sessions.delete(existing.sessionId);
    }

    this.nodes.set(hello.nodeId, connectedNode);
    this.sessions.set(sessionId, hello.nodeId);

    this.emit('node:connected', connectedNode);

    return {
      nodeId: hello.nodeId,
      sessionId,
      heartbeatIntervalMs: this.heartbeatIntervalMs,
    };
  }

  recordHeartbeat(heartbeat: NodeHeartbeatPayload): NodeHeartbeatAckPayload {
    const node = this.nodes.get(heartbeat.nodeId);
    if (!node?.online) {
      throw nodeOfflineError(heartbeat.nodeId);
    }

    node.lastHeartbeatAt = Date.now();
    node.state = heartbeat.state;
    node.activeTaskId = heartbeat.activeTaskId;

    this.emit('node:heartbeat', node);

    return {
      timestamp: Date.now(),
    };
  }

  updateStatus(status: NodeStatusPayload): void {
    const node = this.nodes.get(status.nodeId);
    if (!node?.online) {
      throw nodeOfflineError(status.nodeId);
    }

    node.state = status.state;
    node.activeTaskId = status.activeTaskId;
    if (status.activeProject) {
      node.activeProject = status.activeProject;
    }

    this.emit('node:status', node);
  }

  markOffline(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (node?.online) {
      node.online = false;
      this.emit('node:offline', node);
    }
  }

  disconnectNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.online = false;
      this.sessions.delete(node.sessionId);
      this.emit('node:disconnected', node);
    }
  }

  checkLiveness(now = Date.now()): readonly string[] {
    const timedOutNodeIds: string[] = [];

    for (const node of this.nodes.values()) {
      if (node.online && now - node.lastHeartbeatAt > this.heartbeatTimeoutMs) {
        node.online = false;
        timedOutNodeIds.push(node.nodeId);
        this.emit('node:offline', node);
      }
    }

    return timedOutNodeIds;
  }

  startLivenessMonitoring(checkIntervalMs = 5000): void {
    if (this.livenessTimer) {
      return;
    }
    this.livenessTimer = setInterval(() => {
      this.checkLiveness();
    }, checkIntervalMs);
    this.livenessTimer.unref();
  }

  stopLivenessMonitoring(): void {
    if (this.livenessTimer) {
      clearInterval(this.livenessTimer);
      this.livenessTimer = undefined;
    }
  }

  getNode(nodeId: string): ConnectedNode | undefined {
    return this.nodes.get(nodeId);
  }

  getNodeBySession(sessionId: string): ConnectedNode | undefined {
    const nodeId = this.sessions.get(sessionId);
    return nodeId ? this.nodes.get(nodeId) : undefined;
  }

  listNodes(): readonly ConnectedNode[] {
    return Array.from(this.nodes.values());
  }

  getOnlineNodes(): readonly ConnectedNode[] {
    return Array.from(this.nodes.values()).filter((n) => n.online);
  }

  getPrimaryOnlineNode(): ConnectedNode | undefined {
    return this.getOnlineNodes()[0];
  }

  isNodeOnline(nodeId: string): boolean {
    return this.nodes.get(nodeId)?.online === true;
  }

  listProjects(): readonly NodeProjectSummary[] {
    const projects: NodeProjectSummary[] = [];
    const seen = new Set<string>();

    for (const node of this.getOnlineNodes()) {
      for (const proj of node.projects) {
        const key = `${node.nodeId}:${proj.id || proj.path}`;
        if (!seen.has(key)) {
          seen.add(key);
          const isActive =
            node.activeProject?.id === proj.id ||
            node.activeProject?.path === proj.path ||
            node.activeProject?.name === proj.name;
          projects.push({
            ...proj,
            isActive: Boolean(isActive),
            nodeId: node.nodeId,
            nodeName: node.nodeName,
          });
        }
      }
    }

    return projects;
  }

  clear(): void {
    this.stopLivenessMonitoring();
    this.nodes.clear();
    this.sessions.clear();
  }
}
