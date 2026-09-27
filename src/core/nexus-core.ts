import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { invalidMessageError, NexusProtocolError } from '../protocol/errors';
import { createNexusMessage, parseNexusMessage, serializeNexusMessage } from '../protocol/messages';
import {
  AnyNexusMessage,
  NodeHeartbeatPayload,
  NodeHelloPayload,
  NodeStatusPayload,
} from '../protocol/types';
import { NodePresenceManager } from './presence';
import { CoreConfig, CoreStatusSnapshot } from './types';

export class NexusCore {
  private readonly presence: NodePresenceManager;
  private server?: Server;
  private readonly startTime: number;

  constructor(private readonly config: CoreConfig) {
    this.startTime = Date.now();
    this.presence = new NodePresenceManager({
      authTokens: config.authTokens,
      heartbeatIntervalMs: config.heartbeatIntervalMs,
      heartbeatTimeoutMs: config.heartbeatTimeoutMs,
    });
  }

  getPresenceManager(): NodePresenceManager {
    return this.presence;
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
    };
  }

  async processMessage(message: AnyNexusMessage): Promise<AnyNexusMessage | undefined> {
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

    if (this.server) {
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
