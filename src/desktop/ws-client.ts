import { EventEmitter } from 'node:events';
import { createNexusMessage, parseNexusMessage, serializeNexusMessage } from '../protocol/messages';
import { AnyNexusMessage, CoreErrorPayload, NodeWelcomePayload } from '../protocol/types';
import { DesktopNode } from './node';

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'closing';

export interface DesktopCoreClientOptions {
  readonly reconnect?: boolean;
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly backoffFactor?: number;
}

export function normalizeWsUrl(rawUrl: string): string {
  let url = rawUrl.trim();
  if (url.startsWith('http://')) {
    url = `ws://${url.slice(7)}`;
  } else if (url.startsWith('https://')) {
    url = `wss://${url.slice(8)}`;
  } else if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
    url = `ws://${url}`;
  }

  // Remove trailing slashes
  url = url.replace(/\/+$/, '');

  // If path is missing, default to /ws
  try {
    const parsed = new URL(url);
    if (!parsed.pathname || parsed.pathname === '/') {
      parsed.pathname = '/ws';
      url = parsed.toString();
    }
  } catch {
    // If URL parsing fails, append /ws if not present
    if (!url.endsWith('/ws')) {
      url = `${url}/ws`;
    }
  }

  return url;
}

export class DesktopCoreClient extends EventEmitter {
  private readonly wsUrl: string;
  private readonly authToken: string;
  private readonly node: DesktopNode;
  private readonly reconnectEnabled: boolean;
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly backoffFactor: number;

  private ws?: WebSocket;
  private status: ConnectionStatus = 'disconnected';
  private sessionId?: string;
  private lastWelcome?: NodeWelcomePayload;
  private heartbeatTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private currentDelayMs: number;

  constructor(
    coreUrl: string,
    authToken: string,
    node: DesktopNode,
    options?: DesktopCoreClientOptions
  ) {
    super();
    this.wsUrl = normalizeWsUrl(coreUrl);
    this.authToken = authToken;
    this.node = node;
    this.reconnectEnabled = options?.reconnect ?? true;
    this.initialDelayMs = options?.initialDelayMs ?? 1000;
    this.maxDelayMs = options?.maxDelayMs ?? 30_000;
    this.backoffFactor = options?.backoffFactor ?? 1.5;
    this.currentDelayMs = this.initialDelayMs;

    // Attach default error listener to prevent unhandled 'error' event crashes in Node
    this.on('error', () => {});
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }

  getWsUrl(): string {
    return this.wsUrl;
  }

  isConnected(): boolean {
    return this.status === 'connected';
  }

  async waitForConnection(timeoutMs = 5000): Promise<NodeWelcomePayload> {
    if (this.status === 'connected' && this.lastWelcome) {
      return this.lastWelcome;
    }
    return new Promise<NodeWelcomePayload>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout (${timeoutMs}ms) en attente de la connexion à Core`));
      }, timeoutMs);

      const onConnected = (data: { sessionId: string; welcome: NodeWelcomePayload }) => {
        cleanup();
        resolve(data.welcome);
      };

      const onError = (err: unknown) => {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      };

      const onDisconnected = () => {
        cleanup();
        reject(new Error('Déconnecté avant établissement de la session'));
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.off('connected', onConnected);
        this.off('error', onError);
        this.off('disconnected', onDisconnected);
      };

      this.once('connected', onConnected);
      this.once('error', onError);
      this.once('disconnected', onDisconnected);
    });
  }

  async connect(): Promise<void> {
    if (this.status === 'connected' || this.status === 'connecting') {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    this.status = this.status === 'reconnecting' ? 'reconnecting' : 'connecting';

    try {
      const WebSocketConstructor = globalThis.WebSocket;
      if (!WebSocketConstructor) {
        throw new Error('WebSocket natif non disponible dans cet environnement Node.');
      }

      this.ws = new WebSocketConstructor(this.wsUrl);

      this.ws.onopen = () => {
        this.sendHello();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        this.handleIncomingMessage(String(event.data));
      };

      this.ws.onclose = () => {
        this.handleClose();
      };

      this.ws.onerror = (err: Event) => {
        this.emit('error', err);
      };
    } catch (err) {
      this.emit('error', err);
      this.handleClose();
    }
  }

  disconnect(): void {
    this.status = 'closing';

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    this.clearHeartbeat();

    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = undefined;
    }

    this.status = 'disconnected';
    this.sessionId = undefined;
    this.lastWelcome = undefined;
    this.emit('disconnected');
  }

  send(message: AnyNexusMessage): boolean {
    if (this.ws && this.ws.readyState === globalThis.WebSocket.OPEN) {
      this.ws.send(serializeNexusMessage(message));
      return true;
    }
    return false;
  }

  private sendHello(): void {
    const helloPayload = this.node.createHelloPayload(this.authToken);
    const helloMessage = createNexusMessage('node:hello', helloPayload);
    this.send(helloMessage);
  }

  private sendHeartbeat(): void {
    if (this.status !== 'connected') {
      return;
    }
    const heartbeatPayload = this.node.createHeartbeatPayload();
    const heartbeatMessage = createNexusMessage('node:heartbeat', heartbeatPayload);
    this.send(heartbeatMessage);
  }

  private handleIncomingMessage(raw: string): void {
    try {
      const message = parseNexusMessage(raw);

      switch (message.type) {
        case 'node:welcome': {
          const welcome = message.payload as NodeWelcomePayload;
          this.lastWelcome = welcome;
          this.sessionId = welcome.sessionId;
          this.status = 'connected';
          this.currentDelayMs = this.initialDelayMs;

          this.setupHeartbeat(welcome.heartbeatIntervalMs);
          this.emit('connected', { sessionId: this.sessionId, welcome });
          break;
        }

        case 'node:heartbeat_ack': {
          this.emit('heartbeat_ack', message.payload);
          break;
        }

        case 'core:error': {
          const errorPayload = message.payload as CoreErrorPayload;
          this.emit('core:error', errorPayload);
          if (errorPayload.code === 'UNAUTHENTICATED') {
            console.error(
              `[Nexus Security] Échec d'authentification auprès de Core : ${errorPayload.message}`
            );
            // Don't auto-reconnect on invalid auth token
            this.disconnect();
          }
          break;
        }

        default:
          this.emit('message', message);
          break;
      }
    } catch (err) {
      this.emit('error', err);
    }
  }

  private setupHeartbeat(intervalMs: number): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, intervalMs);
    this.heartbeatTimer.unref?.();
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private handleClose(): void {
    this.clearHeartbeat();

    if (this.status === 'closing') {
      this.status = 'disconnected';
      this.emit('disconnected');
      return;
    }

    if (this.reconnectEnabled) {
      this.status = 'reconnecting';
      const delay = this.currentDelayMs;
      this.currentDelayMs = Math.min(
        Math.floor(this.currentDelayMs * this.backoffFactor),
        this.maxDelayMs
      );

      this.emit('reconnecting', { delayMs: delay });

      this.reconnectTimer = setTimeout(() => {
        this.connect();
      }, delay);
      this.reconnectTimer.unref?.();
    } else {
      this.status = 'disconnected';
      this.emit('disconnected');
    }
  }
}
