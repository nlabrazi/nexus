import { EventEmitter } from 'node:events';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { Duplex } from 'node:stream';
import { invalidMessageError, NexusProtocolError } from '../protocol/errors';
import { createNexusMessage, parseNexusMessage, serializeNexusMessage } from '../protocol/messages';
import {
  AnyNexusMessage,
  NodeHeartbeatPayload,
  NodeHelloPayload,
  NodeStatusPayload,
  TaskCompletedPayload,
  TaskFailedPayload,
  TaskProgressPayload,
} from '../protocol/types';
import { ApprovalRelay } from './approval-relay';
import { NodePresenceManager } from './presence';
import { TaskRouter } from './task-router';
import {
  ApprovalCancelReason,
  ApprovalDecision,
  ApprovalRequestPayload,
  CoreConfig,
  CoreStatusSnapshot,
  PendingApproval,
  PendingApprovalStatus,
  RemoteTask,
  RemoteTaskStatus,
  SubmitTaskOptions,
} from './types';
import { upgradeHttpToWebSocket, WebSocketServerConnection } from './ws-connection';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

export class NexusCore extends EventEmitter {
  private readonly presence: NodePresenceManager;
  private readonly taskRouter: TaskRouter;
  private readonly approvalRelay: ApprovalRelay;
  private server?: Server;
  private readonly wsConnections = new Set<WebSocketServerConnection>();
  private readonly nodeWsConnections = new Map<string, WebSocketServerConnection>();
  private readonly startTime: number;

  constructor(private readonly config: CoreConfig) {
    super();
    this.startTime = Date.now();
    this.presence = new NodePresenceManager({
      authTokens: config.authTokens,
      heartbeatIntervalMs: config.heartbeatIntervalMs,
      heartbeatTimeoutMs: config.heartbeatTimeoutMs,
    });

    this.taskRouter = new TaskRouter(
      this.presence,
      (nodeId) => this.nodeWsConnections.get(nodeId),
      { defaultTaskTimeoutMs: config.defaultTaskTimeoutMs }
    );

    this.approvalRelay = new ApprovalRelay((nodeId) => this.nodeWsConnections.get(nodeId));

    // Relay presence events
    this.presence.on('node:connected', (node) => this.emit('node:connected', node));
    this.presence.on('node:heartbeat', (node) => this.emit('node:heartbeat', node));
    this.presence.on('node:status', (node) => this.emit('node:status', node));
    this.presence.on('node:offline', (node) => {
      this.taskRouter.handleNodeDisconnected(node.nodeId);
      this.approvalRelay.handleNodeDisconnected(node.nodeId);
      this.emit('node:offline', node);
    });

    // Relay task events
    this.taskRouter.on('task:started', (task) => this.emit('task:started', task));
    this.taskRouter.on('task:progress', (task) => this.emit('task:progress', task));
    this.taskRouter.on('task:completed', (task) => {
      this.approvalRelay.cancelTaskApprovals(task.taskId);
      this.emit('task:completed', task);
    });
    this.taskRouter.on('task:failed', (task) => {
      this.approvalRelay.cancelTaskApprovals(task.taskId);
      this.emit('task:failed', task);
    });
    this.taskRouter.on('task:cancelled', (task) => {
      this.approvalRelay.cancelTaskApprovals(task.taskId);
      this.emit('task:cancelled', task);
    });

    // Relay approval events
    this.approvalRelay.on('approval:request', (approval) =>
      this.emit('approval:request', approval)
    );
    this.approvalRelay.on('approval:decided', (approval) =>
      this.emit('approval:decided', approval)
    );
    this.approvalRelay.on('approval:cancelled', (approval) =>
      this.emit('approval:cancelled', approval)
    );
    this.approvalRelay.on('approval:timeout', (approval) =>
      this.emit('approval:timeout', approval)
    );
  }

  getPresenceManager(): NodePresenceManager {
    return this.presence;
  }

  getTaskRouter(): TaskRouter {
    return this.taskRouter;
  }

  async submitTask(options: SubmitTaskOptions): Promise<RemoteTask> {
    return this.taskRouter.submitTask(options);
  }

  async executeTask(options: SubmitTaskOptions, timeoutMs?: number): Promise<TaskCompletedPayload> {
    return this.taskRouter.executeTask(options, timeoutMs);
  }

  async cancelTask(taskId: string, reason?: string): Promise<boolean> {
    return this.taskRouter.cancelTask(taskId, reason);
  }

  getTask(taskId: string): RemoteTask | undefined {
    return this.taskRouter.getTask(taskId);
  }

  listTasks(filter?: { status?: RemoteTaskStatus; nodeId?: string }): readonly RemoteTask[] {
    return this.taskRouter.listTasks(filter);
  }

  getStatus(): CoreStatusSnapshot {
    const nodes = this.presence.listNodes();
    const onlineNodes = this.presence.getOnlineNodes();
    const projects = this.presence.listProjects();
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    return {
      uptimeSeconds,
      totalNodes: nodes.length,
      onlineNodes: onlineNodes.length,
      nodes,
      projects,
      activeTasks: this.taskRouter.listTasks({ status: 'running' }).length,
      pendingApprovals: this.approvalRelay.getPendingCount(),
    };
  }

  getApprovalRelay(): ApprovalRelay {
    return this.approvalRelay;
  }

  decideApproval(
    approvalId: string,
    decision: ApprovalDecision,
    decidedBy?: string
  ): PendingApproval {
    return this.approvalRelay.decideApproval(approvalId, decision, decidedBy);
  }

  cancelApproval(approvalId: string, reason?: ApprovalCancelReason): boolean {
    return this.approvalRelay.cancelApproval(approvalId, reason);
  }

  getApproval(approvalId: string): PendingApproval | undefined {
    return this.approvalRelay.getApproval(approvalId);
  }

  listApprovals(filter?: {
    status?: PendingApprovalStatus;
    taskId?: string;
  }): readonly PendingApproval[] {
    return this.approvalRelay.listApprovals(filter);
  }

  async processMessage(
    message: AnyNexusMessage,
    senderNodeId?: string
  ): Promise<AnyNexusMessage | undefined> {
    try {
      switch (message.type) {
        case 'node:hello': {
          const welcome = this.presence.registerNode(message.payload as NodeHelloPayload);
          return createNexusMessage('node:welcome', welcome, {
            traceId: message.traceId,
          });
        }

        case 'node:heartbeat': {
          const ack = this.presence.recordHeartbeat(message.payload as NodeHeartbeatPayload);
          return createNexusMessage('node:heartbeat_ack', ack, {
            traceId: message.traceId,
          });
        }

        case 'node:status': {
          this.presence.updateStatus(message.payload as NodeStatusPayload);
          return undefined;
        }

        case 'task:progress': {
          this.taskRouter.recordProgress(message.payload as TaskProgressPayload);
          return undefined;
        }

        case 'task:completed': {
          this.taskRouter.recordCompleted(message.payload as TaskCompletedPayload);
          return undefined;
        }

        case 'task:failed': {
          this.taskRouter.recordFailed(message.payload as TaskFailedPayload);
          return undefined;
        }

        case 'approval:request': {
          const payload = message.payload as ApprovalRequestPayload;
          const task = this.taskRouter.getTask(payload.taskId);
          const nodeId = senderNodeId || task?.nodeId || 'unknown-node';
          this.approvalRelay.registerApproval(nodeId, payload);
          return undefined;
        }

        case 'approval:cancelled': {
          const payload = message.payload as { approvalId: string; reason?: ApprovalCancelReason };
          this.approvalRelay.cancelApproval(payload.approvalId, payload.reason);
          return undefined;
        }

        default:
          throw invalidMessageError(
            `Type de message non pris en charge par Nexus Core : « ${message.type} »`
          );
      }
    } catch (err) {
      if (err instanceof NexusProtocolError) {
        return createNexusMessage(
          'core:error',
          {
            code: err.code,
            message: err.message,
            details: err.details,
          },
          { traceId: message.traceId }
        );
      }

      return createNexusMessage(
        'core:error',
        {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
        { traceId: message.traceId }
      );
    }
  }

  getNodeConnection(nodeId: string): WebSocketServerConnection | undefined {
    return this.nodeWsConnections.get(nodeId);
  }

  async start(): Promise<void> {
    this.presence.startLivenessMonitoring();

    if (this.config.port !== undefined && this.config.port >= 0) {
      const host = this.config.host ?? '127.0.0.1';
      const port = this.config.port;

      this.server = createServer((req, res) => {
        this.handleHttpRequest(req, res).catch((err) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        });
      });

      this.server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        const conn = upgradeHttpToWebSocket(req, socket, head);
        if (!conn) {
          return;
        }

        this.wsConnections.add(conn);
        let boundNodeId: string | undefined;

        conn.on('message', async (raw: string) => {
          try {
            const message = parseNexusMessage(raw);
            const reply = await this.processMessage(message, boundNodeId);
            if (message.type === 'node:hello' && reply?.type === 'node:welcome') {
              boundNodeId = (message.payload as NodeHelloPayload).nodeId;
              this.nodeWsConnections.set(boundNodeId, conn);
            }
            if (reply) {
              conn.send(serializeNexusMessage(reply));
            }
          } catch (err) {
            const errorMsg = createNexusMessage('core:error', {
              code: 'INVALID_MESSAGE',
              message: err instanceof Error ? err.message : String(err),
            });
            conn.send(serializeNexusMessage(errorMsg));
          }
        });

        conn.on('close', () => {
          this.wsConnections.delete(conn);
          if (boundNodeId) {
            if (this.nodeWsConnections.get(boundNodeId) === conn) {
              this.nodeWsConnections.delete(boundNodeId);
              this.presence.markOffline(boundNodeId);
              this.taskRouter.handleNodeDisconnected(boundNodeId);
              this.approvalRelay.handleNodeDisconnected(boundNodeId);
            }
          }
        });
      });

      await new Promise<void>((resolve, reject) => {
        this.server?.listen(port, host, () => {
          resolve();
        });
        this.server?.once('error', reject);
      });
    }
  }

  async stop(): Promise<void> {
    this.presence.stopLivenessMonitoring();

    for (const [nodeId] of this.nodeWsConnections.entries()) {
      this.taskRouter.handleNodeDisconnected(nodeId);
    }

    for (const conn of this.wsConnections) {
      conn.close();
    }
    this.wsConnections.clear();
    this.nodeWsConnections.clear();

    if (this.server) {
      if (typeof this.server.closeAllConnections === 'function') {
        this.server.closeAllConnections();
      }
      await new Promise<void>((resolve) => {
        this.server?.close(() => resolve());
      });
      this.server = undefined;
    }

    this.presence.clear();
  }

  getServer(): Server | undefined {
    return this.server;
  }

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (method === 'GET' && pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: '0.4.1' }));
      return;
    }

    if (method === 'GET' && pathname === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.getStatus()));
      return;
    }

    if (method === 'GET' && pathname === '/api/nodes') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.presence.listNodes()));
      return;
    }

    if (method === 'GET' && pathname === '/api/projects') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.presence.listProjects()));
      return;
    }

    if (method === 'GET' && pathname === '/api/tasks') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.listTasks()));
      return;
    }

    if (method === 'POST' && pathname === '/api/tasks') {
      const raw = await this.readRequestBody(req);
      try {
        const body = JSON.parse(raw);
        if (!body.backend || !body.prompt) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Champs obligatoires manquants : backend, prompt' }));
          return;
        }

        if (body.wait) {
          const result = await this.executeTask(
            {
              backend: body.backend,
              prompt: body.prompt,
              projectId: body.projectId,
              nodeId: body.nodeId,
              sessionId: body.sessionId,
            },
            body.timeoutMs
          );
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } else {
          const task = await this.submitTask({
            backend: body.backend,
            prompt: body.prompt,
            projectId: body.projectId,
            nodeId: body.nodeId,
            sessionId: body.sessionId,
          });
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(task));
        }
      } catch (err) {
        const statusCode =
          err instanceof NexusProtocolError && err.code === 'NODE_OFFLINE' ? 503 : 400;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
            code: err instanceof NexusProtocolError ? err.code : 'INTERNAL_ERROR',
          })
        );
      }
      return;
    }

    if (pathname.startsWith('/api/tasks/')) {
      const parts = pathname.slice('/api/tasks/'.length).split('/');
      const taskId = decodeURIComponent(parts[0]);

      if (parts.length === 1 && method === 'GET') {
        const task = this.getTask(taskId);
        if (!task) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Tâche introuvable : ${taskId}` }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(task));
        return;
      }

      if (parts.length === 2 && parts[1] === 'cancel' && method === 'POST') {
        const raw = await this.readRequestBody(req);
        let reason: string | undefined;
        try {
          if (raw) {
            const body = JSON.parse(raw);
            reason = body.reason;
          }
        } catch {
          // ignore
        }
        const cancelled = await this.cancelTask(taskId, reason);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ taskId, cancelled }));
        return;
      }
    }

    if (method === 'GET' && pathname === '/api/approvals') {
      const statusParam = url.searchParams.get('status') as PendingApprovalStatus | null;
      const taskId = url.searchParams.get('taskId') ?? undefined;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.listApprovals({ status: statusParam ?? undefined, taskId })));
      return;
    }

    if (pathname.startsWith('/api/approvals/')) {
      const parts = pathname.slice('/api/approvals/'.length).split('/');
      const approvalId = decodeURIComponent(parts[0]);

      if (parts.length === 1 && method === 'GET') {
        const approval = this.getApproval(approvalId);
        if (!approval) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Demande d’approbation introuvable : ${approvalId}` }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(approval));
        return;
      }

      if (parts.length === 2 && parts[1] === 'decide' && method === 'POST') {
        const raw = await this.readRequestBody(req);
        try {
          const body = JSON.parse(raw);
          if (!body.decision || (body.decision !== 'accept' && body.decision !== 'decline')) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: 'Champ obligatoire requis : decision ("accept" | "decline")',
              })
            );
            return;
          }
          const approval = this.decideApproval(approvalId, body.decision, body.decidedBy);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(approval));
        } catch (err) {
          const statusCode =
            err instanceof NexusProtocolError && err.code === 'APPROVAL_TIMEOUT'
              ? 410
              : err instanceof NexusProtocolError && err.code === 'APPROVAL_NOT_FOUND'
                ? 404
                : 400;
          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
              code: err instanceof NexusProtocolError ? err.code : 'INTERNAL_ERROR',
            })
          );
        }
        return;
      }
    }

    if (method === 'POST' && pathname === '/api/message') {
      const body = await this.readRequestBody(req);
      try {
        const message = parseNexusMessage(body);
        const reply = await this.processMessage(message);
        if (reply) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(serializeNexusMessage(reply));
        } else {
          res.writeHead(204);
          res.end();
        }
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          })
        );
      }
      return;
    }

    // Static file serving for PWA Web Client
    if (method === 'GET' && this.config.publicDir && existsSync(this.config.publicDir)) {
      const publicRoot = resolve(this.config.publicDir);
      const targetPath = resolve(publicRoot, `.${pathname}`);

      // Security: protect against directory traversal
      if (!targetPath.startsWith(publicRoot)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Fichier introuvable' }));
        return;
      }

      if (existsSync(targetPath)) {
        let stat = statSync(targetPath);
        let filePath = targetPath;
        if (stat.isDirectory()) {
          filePath = join(targetPath, 'index.html');
          if (existsSync(filePath)) {
            stat = statSync(filePath);
          }
        }

        if (stat.isFile()) {
          const ext = extname(filePath).toLowerCase();
          const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
          res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': stat.size,
            'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
          });
          createReadStream(filePath).pipe(res);
          return;
        }
      }

      // SPA client-side fallback to index.html for HTML navigation requests
      const accept = req.headers.accept ?? '';
      const indexPath = join(publicRoot, 'index.html');
      if (accept.includes('text/html') && existsSync(indexPath)) {
        const stat = statSync(indexPath);
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': stat.size,
          'Cache-Control': 'no-cache',
        });
        createReadStream(indexPath).pipe(res);
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint non trouvé' }));
  }

  private readRequestBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        data += chunk;
      });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  }
}
