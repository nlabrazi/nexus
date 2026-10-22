import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { createServer, IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { hostname } from 'node:os';
import type { Duplex } from 'node:stream';
import { WebSocketServerConnection } from '../core/ws-connection';

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
};
import { logger } from '../logging/logger';
import { NexusRuntime } from '../runtime/nexus-runtime';
import { createPersistentStorage } from '../runtime/storage';
import {
  AgentBackendType,
  KeyValueStorage,
  RuntimeApprovalRequest,
  TaskBackendType,
} from '../runtime/types';
import { WorkspaceGuard } from '../workspace/guard';
import { AuthGuard } from '../security/auth';
import { JailGuard, SecurityError } from '../security/jail';
import { ApprovalDecision } from '../codex/types';
import { FcmService } from '../notifications/fcm-service';

export interface PendingApprovalItem {
  readonly approvalId: string;
  readonly taskId?: string;
  readonly agentName: string;
  readonly kind: string;
  readonly toolName?: string;
  readonly summary?: string;
  readonly details: string;
  readonly expiresAt: number;
  readonly requestedAt: number;
  readonly settle: (decision: ApprovalDecision) => void;
}

export interface DaemonTaskRecord {
  readonly taskId: string;
  readonly backend: TaskBackendType;
  readonly prompt: string;
  readonly projectPath: string;
  readonly projectName: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  readonly startedAt: number;
  completedAt?: number;
  replyText?: string;
  text?: string;
  fileSummary?: string;
  filesChanged?: readonly string[];
  error?: string;
}

export interface DaemonProjectInfo {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly currentBranch?: string;
}

export interface DaemonServerOptions {
  readonly port?: number;
  readonly host?: string;
  readonly jail: JailGuard;
  readonly auth: AuthGuard;
  readonly runtime?: NexusRuntime;
  readonly storage?: KeyValueStorage;
  readonly initialProject?: string;
}

export class NexusDaemonServer extends EventEmitter {
  private readonly port: number;
  private readonly host: string;
  private readonly jail: JailGuard;
  private readonly auth: AuthGuard;
  private readonly storage: KeyValueStorage;
  private server?: HttpServer;
  private readonly wsClients = new Set<WebSocketServerConnection>();
  private readonly startedAt = Date.now();

  private activeProject: DaemonProjectInfo;
  private activeBackend: AgentBackendType = 'codex';
  private runtime: NexusRuntime;
  private currentTaskId?: string;
  private currentTaskAbortController?: AbortController;

  private readonly tasks = new Map<string, DaemonTaskRecord>();
  private readonly runningTaskPromises = new Map<string, Promise<DaemonTaskRecord>>();
  private readonly pendingApprovals = new Map<string, PendingApprovalItem>();
  private readonly fcmService: FcmService;

  constructor(options: DaemonServerOptions) {
    super();
    this.port = options.port ?? 4040;
    this.host = options.host ?? '127.0.0.1';
    this.jail = options.jail;
    this.auth = options.auth;
    this.storage = options.storage ?? createPersistentStorage();
    this.fcmService = new FcmService({ storage: this.storage });
    this.loadSavedTasks();

    // Resolve initial project safely
    const initialRoot = options.initialProject
      ? this.jail.resolveSafePath(options.initialProject)
      : this.jail.getAllowedRoots()[0];

    this.activeProject = {
      id: initialRoot,
      name: basename(initialRoot),
      path: initialRoot,
    };

    if (options.runtime) {
      this.runtime = options.runtime;
    } else {
      const workspaceGuard = new WorkspaceGuard(() => ({
        trusted: true,
        folders: [{ scheme: 'file', path: this.activeProject.path }],
        dirtyDocuments: [],
        protectedBranches: ['main', 'master'],
      }));

      this.runtime = new NexusRuntime({
        workspaceGuard,
        targetPath: () => this.activeProject.path,
        defaultBackend: 'codex',
        storage: this.storage,
        requestApproval: (req, sig) => this.handleApprovalRequest(req, sig),
        requestTurnTimeoutContinuation: async (_req, signal) =>
          !signal.aborted &&
          this.currentTaskId !== undefined &&
          !this.currentTaskAbortController?.signal.aborted,
      });
    }
  }

  private loadSavedTasks(): void {
    try {
      const saved = this.storage.get('nexus.daemon.tasks');
      if (Array.isArray(saved)) {
        for (const item of saved) {
          if (item && typeof item === 'object' && item.taskId) {
            this.tasks.set(item.taskId, item as DaemonTaskRecord);
          }
        }
      }
    } catch (err) {
      logger.warn('Daemon', 'load_saved_tasks_failed', { status: 'failed' }, err);
    }
  }

  private persistTasks(): void {
    try {
      const recent = [...this.tasks.values()].slice(-100);
      void this.storage.update('nexus.daemon.tasks', recent);
    } catch (err) {
      logger.warn('Daemon', 'persist_tasks_failed', { status: 'failed' }, err);
    }
  }

  getActiveProject(): DaemonProjectInfo {
    return this.activeProject;
  }

  getActiveBackend(): AgentBackendType {
    return this.activeBackend;
  }

  getRuntime(): NexusRuntime {
    return this.runtime;
  }

  async start(): Promise<void> {
    try {
      await this.storage.hydrateFromRemote?.();
      this.loadSavedTasks();
      this.runtime.getProjectMemory().readGlobalPersona();
    } catch (err) {
      logger.warn('Daemon', 'upstash_hydrate_failed', { status: 'failed' }, err);
    }

    const server = createServer(async (req, res) => {
      await this.handleHttpRequest(req, res);
    });

    server.on('upgrade', (req, socket, head) => {
      this.handleWsUpgrade(req, socket, head);
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(this.port, this.host, () => {
        this.server = server;
        logger.info('Daemon', 'start', { status: 'success' });
        resolve();
      });
      server.once('error', reject);
    });
  }

  async stop(): Promise<void> {
    for (const client of this.wsClients) {
      client.close();
    }
    this.wsClients.clear();

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => resolve());
      });
      this.server = undefined;
    }
    this.runtime.stop();
  }

  private handleApprovalRequest(
    request: RuntimeApprovalRequest,
    signal: AbortSignal
  ): Promise<ApprovalDecision> {
    if (signal.aborted) {
      return Promise.resolve('decline');
    }

    const approvalId = randomUUID();
    const expiresAt = request.expiresAt > Date.now() ? request.expiresAt : Date.now() + 180_000; // 3 minutes default

    return new Promise<ApprovalDecision>((resolve) => {
      const settle = (decision: ApprovalDecision) => {
        clearTimeout(timer);
        this.pendingApprovals.delete(approvalId);
        this.broadcastWs('approval:decided', { approvalId, decision });
        resolve(decision);
      };

      const timer = setTimeout(
        () => {
          settle('decline');
        },
        Math.max(0, expiresAt - Date.now())
      );

      signal.addEventListener('abort', () => settle('decline'), { once: true });

      const { toolName, summary: promptDesc } = this.summarizeApprovalRequest(
        request.kind,
        request.details
      );

      const item: PendingApprovalItem = {
        approvalId,
        taskId: this.currentTaskId,
        agentName: request.agentName ?? 'Agent',
        kind: request.kind,
        toolName,
        summary: promptDesc,
        details: request.details,
        expiresAt,
        requestedAt: Date.now(),
        settle,
      };

      this.pendingApprovals.set(approvalId, item);
      this.broadcastWs('approval:requested', {
        approvalId,
        taskId: this.currentTaskId,
        agentName: request.agentName ?? 'Agent',
        kind: request.kind,
        toolName,
        summary: promptDesc,
        details: request.details,
        expiresAt,
      });

      void this.fcmService.sendPush({
        title: `Nexus · Approbation (${toolName})`,
        body: promptDesc,
        data: {
          approvalId,
          type: 'approval_request',
        },
      });
    });
  }

  private summarizeApprovalRequest(
    kind: string,
    rawDetails: string
  ): { toolName: string; summary: string } {
    const unwrapShellCommand = (rawCmd: unknown): string => {
      if (Array.isArray(rawCmd)) {
        const parts = rawCmd.map((p) => String(p ?? '').trim()).filter(Boolean);
        if (
          parts.length >= 3 &&
          /(?:^|\/)(?:ba|z|da|k)?sh$/i.test(parts[0]) &&
          /^-[a-z]*c[a-z]*$/i.test(parts[1])
        ) {
          return unwrapShellCommand(parts.slice(2).join(' '));
        }
        return parts.join(' ');
      }
      if (typeof rawCmd !== 'string') return '';
      let cmd = rawCmd.trim();
      const match = cmd.match(
        /^(?:\/usr\/bin\/env\s+)?(?:\/bin\/|\/usr\/bin\/)?(?:ba|z|da|k)?sh\s+-[a-z]*c[a-z]*\s+([\s\S]+)$/i
      );
      if (match) {
        cmd = match[1].trim();
        if (
          (cmd.startsWith("'") && cmd.endsWith("'")) ||
          (cmd.startsWith('"') && cmd.endsWith('"'))
        ) {
          cmd = cmd.slice(1, -1).trim();
        }
      }
      return cmd;
    };

    try {
      const parsed = JSON.parse(rawDetails) as Record<string, unknown>;
      const action =
        parsed?.action && typeof parsed.action === 'object' && !Array.isArray(parsed.action)
          ? (parsed.action as Record<string, unknown>)
          : undefined;
      const network =
        parsed?.networkApprovalContext &&
        typeof parsed.networkApprovalContext === 'object' &&
        !Array.isArray(parsed.networkApprovalContext)
          ? (parsed.networkApprovalContext as Record<string, unknown>)
          : undefined;

      const reason = [
        parsed?.reason,
        parsed?.justification,
        parsed?.Description,
        parsed?.description,
        parsed?.Instruction,
        parsed?.toolSummary,
        parsed?.toolAction,
        action?.reason,
        action?.description,
      ]
        .map((v) => (typeof v === 'string' ? v.trim() : ''))
        .find((v) => v.length > 0);

      const cmd = unwrapShellCommand(
        parsed?.CommandLine ?? parsed?.command ?? action?.command ?? parsed?.cmd ?? action?.cmd
      );
      const shortCmd = cmd.length > 72 ? `${cmd.slice(0, 71).trimEnd()}…` : cmd;

      const changes = Array.isArray(parsed?.changes)
        ? parsed.changes
        : Array.isArray(action?.changes)
          ? action.changes
          : [];
      const firstChangePath =
        changes.length > 0 &&
        changes[0] &&
        typeof changes[0] === 'object' &&
        typeof (changes[0] as Record<string, unknown>).path === 'string'
          ? String((changes[0] as Record<string, unknown>).path)
          : '';
      const targetFile =
        (typeof parsed?.TargetFile === 'string' && parsed.TargetFile.trim()) ||
        (typeof parsed?.file_path === 'string' && parsed.file_path.trim()) ||
        (typeof parsed?.path === 'string' && parsed.path.trim()) ||
        firstChangePath;

      if (typeof parsed?.question === 'string' && parsed.question.trim()) {
        return { toolName: 'Question', summary: parsed.question.trim() };
      }
      if (cmd) {
        const firstToken = cmd.split(/\s+/)[0]?.toLowerCase() ?? '';
        const summary = reason
          ? `${reason.replace(/[.!?]+$/, '')} (${shortCmd}) — pouvez-vous valider ?`
          : ['ping', 'curl', 'wget', 'nc', 'dig', 'nslookup'].includes(firstToken)
            ? `Je souhaite lancer un test réseau « ${shortCmd} » — pouvez-vous valider ?`
            : `Je souhaite exécuter « ${shortCmd} » — pouvez-vous valider ?`;
        return { toolName: 'Commande', summary };
      }
      if (network && typeof network.host === 'string' && network.host.trim()) {
        const host = network.host.trim();
        return {
          toolName: 'Réseau',
          summary: reason
            ? `${reason} (${host}) — pouvez-vous valider ?`
            : `Je souhaite accéder à l'hôte réseau ${host} — pouvez-vous valider ?`,
        };
      }
      if (targetFile) {
        const fileLabel = basename(targetFile);
        return {
          toolName: changes.length > 1 ? 'Fichiers' : 'Fichier',
          summary: reason
            ? `${reason} (${fileLabel}) — pouvez-vous valider ?`
            : `Je souhaite modifier ${changes.length > 1 ? `${changes.length} fichiers (dont ${fileLabel})` : `le fichier « ${fileLabel} »`} — pouvez-vous valider ?`,
        };
      }
      if (reason) {
        return {
          toolName: kind === 'fileChange' ? 'Fichier' : 'Action',
          summary: `${reason.replace(/[.!?]+$/, '')} — pouvez-vous valider ?`,
        };
      }
    } catch {
      const cleanRaw = rawDetails.replace(/\s+/g, ' ').trim().slice(0, 120);
      if (cleanRaw && !cleanRaw.startsWith('{')) {
        return {
          toolName: kind === 'fileChange' ? 'Fichier' : 'Commande',
          summary: `${cleanRaw} — pouvez-vous valider ?`,
        };
      }
    }

    return {
      toolName: kind === 'fileChange' ? 'Fichier' : 'Commande',
      summary: 'Une action de l’agent requiert votre accord — pouvez-vous valider ?',
    };
  }

  private getNodeInfo() {
    return {
      nodeId: 'local-daemon',
      nodeName: hostname(),
      version: '1.0.0',
      connectedAt: this.startedAt,
      lastHeartbeatAt: Date.now(),
      state: this.currentTaskId ? 'busy' : 'idle',
      online: true,
      capabilities: {
        filesystem: true,
        backends: ['codex', 'antigravity', 'claude', 'brain'],
        workspaceGuard: true,
      },
      projects: this.scanProjects(),
      activeProject: this.activeProject,
      activeTaskId: this.currentTaskId,
    };
  }

  private broadcastWs(event: string, payload: unknown): void {
    const message = JSON.stringify({ event, payload, timestamp: Date.now() });
    for (const client of this.wsClients) {
      client.send(message);
    }
  }

  private handleWsUpgrade(req: IncomingMessage, socket: Duplex, _head: Buffer): void {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const clientIp = req.socket.remoteAddress || '127.0.0.1';

    // Auth check on upgrade
    const token = req.headers.authorization || url.searchParams.get('token') || undefined;

    const authRes = this.auth.verifyToken(token, clientIp);
    if (!authRes.ok) {
      console.warn(
        `[DAEMON-WS] ⚠️ Connexion WebSocket refusée pour ${clientIp} (Jeton manquant ou invalide)`
      );
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    if (url.pathname === '/ws') {
      console.log(`[DAEMON-WS] 🔌 Connexion WebSocket établie depuis ${clientIp}`);
      const conn = new WebSocketServerConnection(socket, req);
      this.wsClients.add(conn);

      conn.on('close', () => {
        this.wsClients.delete(conn);
      });

      conn.on('error', () => {
        this.wsClients.delete(conn);
      });

      // Send initial status event
      conn.send(
        JSON.stringify({
          event: 'connected',
          payload: {
            nodeName: hostname(),
            activeProject: this.activeProject,
            activeBackend: this.activeBackend,
          },
        })
      );
    } else {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
    }
  }

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const clientIp = req.socket.remoteAddress || '127.0.0.1';
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;

    // CORS headers for local app development
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const isBackgroundPoll =
      method === 'GET' &&
      (pathname === '/health' ||
        pathname === '/status' ||
        pathname === '/api/tasks' ||
        pathname === '/api/approvals' ||
        pathname === '/api/sessions');

    if (!isBackgroundPoll) {
      console.log(`[DAEMON] <-- ${method} ${pathname} (IP: ${clientIp})`);
    }

    // Public health check route
    if (pathname === '/health' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          daemon: 'nexus-daemon',
          version: '1.0.0',
          uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
        })
      );
      return;
    }

    // Static Web PWA Serving (Nuxt web client)
    const publicRoot = resolve(process.cwd(), 'web/.output/public');
    if (
      method === 'GET' &&
      !pathname.startsWith('/api') &&
      pathname !== '/status' &&
      pathname !== '/health' &&
      pathname !== '/ws' &&
      existsSync(publicRoot)
    ) {
      const targetPath = resolve(publicRoot, `.${pathname}`);
      if (targetPath.startsWith(publicRoot) && existsSync(targetPath)) {
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

      // SPA fallback to index.html for browser navigation
      const accept = req.headers.accept ?? '';
      const indexPath = join(publicRoot, 'index.html');
      if ((accept.includes('text/html') || pathname === '/') && existsSync(indexPath)) {
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

    // Auth verification for all other endpoints
    const authHeader = req.headers.authorization;
    const authResult = this.auth.verifyToken(authHeader, clientIp);

    if (!authResult.ok) {
      console.warn(
        `[DAEMON] ⚠️ Auth refusée pour ${clientIp} sur ${pathname} (${authResult.blocked ? 'IP BLOQUÉE' : 'Jeton invalide ou absent'})`
      );
      const status = authResult.blocked ? 429 : 401;
      const message = authResult.blocked
        ? 'Trop de tentatives échouées. Adresse IP temporairement bloquée.'
        : 'Authentification requise (jeton Bearer invalide ou manquant).';
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: message, code: authResult.blocked ? 'BLOCKED' : 'UNAUTHORIZED' })
      );
      return;
    }

    try {
      // 1. Status & Nodes
      if (pathname === '/status' && method === 'GET') {
        const snapshot = await this.runtime.getStatus();
        const nodeInfo = this.getNodeInfo();
        const projects = this.scanProjects();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ...snapshot,
            uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
            totalNodes: 1,
            onlineNodes: 1,
            nodes: [nodeInfo],
            projects,
            activeProject: this.activeProject,
            activeBackend: this.activeBackend,
            activeTasks: this.currentTaskId ? 1 : 0,
            pendingApprovals: this.pendingApprovals.size,
          })
        );
        return;
      }

      if (pathname === '/api/nodes' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([this.getNodeInfo()]));
        return;
      }

      // 2. Projects
      if (pathname === '/api/projects' && method === 'GET') {
        const projects = this.scanProjects();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(projects));
        return;
      }

      if (pathname === '/api/projects/active' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.activeProject));
        return;
      }

      if (
        (pathname === '/api/projects/switch' || pathname === '/api/filesystem/open') &&
        method === 'POST'
      ) {
        const body = JSON.parse(await this.readRequestBody(req));
        const target = body.id || body.path;
        if (!target) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Projet ou chemin requis' }));
          return;
        }

        const safePath = this.jail.resolveSafePath(target);
        this.activeProject = {
          id: safePath,
          name: basename(safePath),
          path: safePath,
        };

        this.broadcastWs('project:switched', this.activeProject);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.activeProject));
        return;
      }

      // 3. Filesystem Exploration (Jailed)
      if (pathname === '/api/filesystem' && method === 'GET') {
        const queryPath = url.searchParams.get('path') || this.activeProject.path;
        const safePath = this.jail.resolveSafePath(queryPath);

        if (!existsSync(safePath) || !statSync(safePath).isDirectory()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Le dossier spécifié n’existe pas' }));
          return;
        }

        const dirEntries = readdirSync(safePath, { withFileTypes: true });
        const directories = dirEntries
          .filter((e) => e.isDirectory() && e.name !== 'node_modules')
          .map((e) => ({
            name: e.name,
            path: resolve(safePath, e.name),
            hidden: e.name.startsWith('.'),
          }));

        const entries = dirEntries
          .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
          .map((e) => ({
            name: e.name,
            path: resolve(safePath, e.name),
            isDirectory: e.isDirectory(),
          }));

        const parentPath = dirname(safePath);
        const parent = this.jail.isPathAllowed(parentPath) ? parentPath : null;
        const roots = this.jail.getAllowedRoots().map((r) => ({
          name: basename(r) || r,
          path: r,
        }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            path: safePath,
            parent,
            home: this.jail.getAllowedRoots()[0] ?? safePath,
            roots,
            directories,
            currentPath: safePath,
            entries,
          })
        );
        return;
      }

      // 3b. Dashboard & Quotas
      if (pathname === '/api/dashboard' && method === 'GET') {
        const dashboard = await this.runtime.getDashboard();
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(dashboard));
        return;
      }

      // 3c. Global Persona & Project Memory (Upstash-backed)
      if (pathname === '/api/persona' && method === 'GET') {
        const mem = this.runtime.getProjectMemory();
        const projectPath = url.searchParams.get('path')
          ? this.jail.resolveSafePath(url.searchParams.get('path')!)
          : this.activeProject.path;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            persona: mem.readGlobalPersona(),
            projectPreferences: mem.readProjectPreferencesOnly(projectPath),
            projectMemory: mem.readMemory(projectPath),
            decisions: mem.listDecisions(projectPath),
            activeProject: this.activeProject,
          })
        );
        return;
      }

      if (pathname === '/api/persona' && method === 'POST') {
        const body = JSON.parse(await this.readRequestBody(req));
        const mem = this.runtime.getProjectMemory();
        const projectPath = body.projectPath
          ? this.jail.resolveSafePath(String(body.projectPath))
          : this.activeProject.path;

        if (typeof body.persona === 'string') {
          mem.setGlobalPersona(body.persona);
        }
        if (typeof body.projectPreferences === 'string') {
          mem.setPreferences(projectPath, body.projectPreferences);
        }
        if (typeof body.projectMemory === 'string') {
          mem.setRawMemory(projectPath, body.projectMemory);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'ok',
            persona: mem.readGlobalPersona(),
            projectPreferences: mem.readProjectPreferencesOnly(projectPath),
            projectMemory: mem.readMemory(projectPath),
            decisions: mem.listDecisions(projectPath),
          })
        );
        return;
      }

      if (pathname === '/api/projects/memory' && method === 'GET') {
        const projectPath = url.searchParams.get('path')
          ? this.jail.resolveSafePath(url.searchParams.get('path')!)
          : this.activeProject.path;
        const mem = this.runtime.getProjectMemory();
        const snapshot = this.runtime.getProjectMemorySnapshot(projectPath);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ...snapshot,
            projectPreferences: mem.readProjectPreferencesOnly(projectPath),
            memory: snapshot.rawContent,
          })
        );
        return;
      }

      if (pathname === '/api/projects/memory' && method === 'POST') {
        const body = JSON.parse(await this.readRequestBody(req));
        const projectPath = body.projectPath
          ? this.jail.resolveSafePath(String(body.projectPath))
          : this.activeProject.path;
        const mem = this.runtime.getProjectMemory();
        const rawPref =
          typeof body.projectPreferences === 'string'
            ? body.projectPreferences
            : typeof body.preferences === 'string'
              ? body.preferences
              : undefined;
        const rawMem =
          typeof body.rawContent === 'string'
            ? body.rawContent
            : typeof body.projectMemory === 'string'
              ? body.projectMemory
              : typeof body.memory === 'string'
                ? body.memory
                : undefined;

        if (rawPref !== undefined || rawMem !== undefined) {
          if (rawPref !== undefined) {
            mem.setPreferences(projectPath, rawPref);
          }
          if (rawMem !== undefined) {
            mem.setRawMemory(projectPath, rawMem);
          }
          const snapshot = this.runtime.getProjectMemorySnapshot(projectPath);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              ...snapshot,
              projectPreferences: mem.readProjectPreferencesOnly(projectPath),
              memory: snapshot.rawContent,
            })
          );
          return;
        }
        const decision = this.runtime.recordProjectDecision(
          {
            title: String(body.title ?? ''),
            decision: String(body.decision ?? ''),
            context: typeof body.context === 'string' ? body.context : undefined,
            status: body.status,
          },
          projectPath
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(decision));
        return;
      }

      if (pathname === '/api/projects/memory' && method === 'DELETE') {
        const projectPath = url.searchParams.get('path')
          ? this.jail.resolveSafePath(url.searchParams.get('path')!)
          : this.activeProject.path;
        this.runtime.clearProjectMemory(projectPath);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', cleared: true }));
        return;
      }

      // 3d. Voice Status & Server-Side STT Fallback (Groq Whisper)
      if (pathname === '/api/voice/status' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            available: true,
            provider: process.env.GROQ_API_KEY ? 'groq-whisper' : 'native-android',
            language: 'fr',
          })
        );
        return;
      }

      if (pathname === '/api/voice/transcribe' && method === 'POST') {
        const body = JSON.parse(await this.readRequestBody(req));
        const audioBase64 = typeof body.audioBase64 === 'string' ? body.audioBase64 : '';
        const mimeType = typeof body.mimeType === 'string' ? body.mimeType : 'audio/webm';
        if (!audioBase64) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Audio manquant' }));
          return;
        }
        const groqKey = process.env.GROQ_API_KEY;
        if (!groqKey) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: 'GROQ_API_KEY non configurée sur le serveur pour la transcription cloud.',
            })
          );
          return;
        }
        const rawBytes = Buffer.from(audioBase64, 'base64');
        const ext = mimeType.includes('mp4')
          ? 'm4a'
          : mimeType.includes('ogg')
            ? 'ogg'
            : mimeType.includes('wav')
              ? 'wav'
              : 'webm';
        const form = new FormData();
        form.append('file', new Blob([rawBytes], { type: mimeType }), `speech.${ext}`);
        form.append('model', 'whisper-large-v3-turbo');
        form.append('language', typeof body.language === 'string' ? body.language : 'fr');
        const whisperRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${groqKey}` },
          body: form,
        });
        if (!whisperRes.ok) {
          const errText = await whisperRes.text().catch(() => '');
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Erreur transcription Whisper : ${errText}` }));
          return;
        }
        const data = (await whisperRes.json()) as { text?: string };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text: (data.text ?? '').trim() }));
        return;
      }

      // 4. Models
      if (pathname === '/api/models' && method === 'GET') {
        const backendParam =
          (url.searchParams.get('backend') as TaskBackendType) || this.activeBackend;
        const menu = await this.runtime.listModels(backendParam, this.activeProject.path);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(menu));
        return;
      }

      if (pathname === '/api/models/select' && method === 'POST') {
        const body = JSON.parse(await this.readRequestBody(req));
        const backend = (body.backend as TaskBackendType) || this.activeBackend;
        const model = body.selection?.model || body.model;
        const effort = body.selection?.effort ?? body.effort ?? '';
        const context = typeof body.context === 'string' ? body.context : undefined;
        if (!model || typeof model !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Nom du modèle requis' }));
          return;
        }
        await this.runtime.selectModel(
          backend,
          { model, effort },
          context,
          this.activeProject.path
        );
        const updatedMenu = await this.runtime.listModels(backend, this.activeProject.path);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(updatedMenu));
        return;
      }

      // 4b. Persistent Sessions & History
      if (pathname === '/api/sessions/reset' && method === 'POST') {
        const rawBody = await this.readRequestBody(req);
        const body = rawBody ? JSON.parse(rawBody) : {};
        const backend = (body.backend as TaskBackendType) || this.activeBackend;
        const sessionId = await this.runtime.handleSessionAction(
          backend,
          { type: 'new' },
          this.activeProject.path
        );
        if (body.clearHistory) {
          this.tasks.clear();
          this.persistTasks();
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', backend, sessionId }));
        return;
      }

      if (pathname === '/api/sessions' && method === 'GET') {
        const queryProject = url.searchParams.get('project') || url.searchParams.get('projectId');
        let list = [...this.tasks.values()].reverse();
        if (queryProject) {
          list = list.filter(
            (t) =>
              t.projectPath === queryProject ||
              t.projectName === queryProject ||
              t.projectPath.endsWith(queryProject)
          );
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(list));
        return;
      }

      if (pathname.startsWith('/api/sessions/') && method === 'GET') {
        const sessionId = pathname.slice('/api/sessions/'.length);
        const task = this.tasks.get(sessionId);
        if (!task) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Session non trouvée : ${sessionId}` }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(task));
        return;
      }

      // 4bis. Push Notifications Registration & Test
      if (pathname === '/api/push/register' && method === 'POST') {
        const body = JSON.parse(await this.readRequestBody(req));
        if (body.token && typeof body.token === 'string') {
          await this.fcmService.registerToken(body.token);
          console.log(
            `[DAEMON] 📱 Appareil enregistré pour push FCM : ${body.token.slice(0, 15)}...`
          );
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', registered: true }));
          return;
        }
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Token manquant' }));
        return;
      }

      if (pathname === '/api/push/test' && method === 'POST') {
        const result = await this.fcmService.sendPush({
          title: 'Nexus : Test Push Firebase ✅',
          body: 'Ceci est une vraie notification push Google FCM sur votre smartphone !',
          data: { test: 'true' },
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', result }));
        return;
      }

      // 5. Tasks Execution & Retrieval & Cancellation
      if (pathname === '/api/tasks' && method === 'GET') {
        const list = [...this.tasks.values()].reverse();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(list));
        return;
      }

      if (pathname.startsWith('/api/tasks/') && method === 'GET' && !pathname.endsWith('/cancel')) {
        const taskId = pathname.slice('/api/tasks/'.length);
        const task = this.tasks.get(taskId);
        if (!task) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Tâche non trouvée : ${taskId}` }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(task));
        return;
      }

      if (pathname === '/api/tasks' && method === 'POST') {
        const body = JSON.parse(await this.readRequestBody(req));
        if (!body.prompt) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Champ obligatoire manquant : prompt' }));
          return;
        }

        const taskId = body.taskId || `task-${Date.now()}`;

        // Idempotency: if the same taskId was retried (e.g. mobile app resumed from background),
        // join the existing in-flight execution or return the already-recorded result instead
        // of launching a duplicate turn that collides with Codex/Antigravity.
        const existingTask = this.tasks.get(taskId);
        if (existingTask) {
          const existingPromise = this.runningTaskPromises.get(taskId);
          if (existingPromise) {
            if (body.wait === false) {
              res.writeHead(202, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(existingTask));
              return;
            }
            const completed = await existingPromise;
            const statusCode = completed.status === 'failed' ? 500 : 200;
            res.writeHead(statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(completed));
            return;
          }
          const statusCode = existingTask.status === 'failed' ? 500 : 200;
          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(existingTask));
          return;
        }

        // Prevent launching a colliding turn if another task is already actively running
        if (this.currentTaskId && this.runningTaskPromises.has(this.currentTaskId)) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: 'Une tâche est déjà en cours d’exécution.',
              activeTaskId: this.currentTaskId,
            })
          );
          return;
        }

        const backend = (body.backend as TaskBackendType) || this.activeBackend;
        if (backend === 'codex' || backend === 'antigravity' || backend === 'claude') {
          this.activeBackend = backend;
          this.runtime.setActiveBackend(backend);
        }
        let targetPath = this.activeProject.path;
        if (body.projectId) {
          const rawId = String(body.projectId).trim();
          if (
            rawId === this.activeProject.id ||
            rawId === this.activeProject.name ||
            rawId === this.activeProject.path
          ) {
            targetPath = this.activeProject.path;
          } else {
            const matchingProject = this.scanProjects().find(
              (p) => p.id === rawId || p.name === rawId || p.path === rawId
            );
            if (matchingProject) {
              targetPath = matchingProject.path;
            } else {
              try {
                targetPath = this.jail.resolveSafePath(rawId);
              } catch {
                targetPath = this.activeProject.path;
              }
            }
          }
        }

        if (targetPath !== this.activeProject.path) {
          this.activeProject = {
            id: targetPath,
            name: basename(targetPath),
            path: targetPath,
          };
          this.broadcastWs('project:switched', this.activeProject);
        }

        console.log(
          `[DAEMON] 🚀 Tâche lancée sur [${basename(targetPath)}] (${backend}) : "${String(body.prompt).slice(0, 60)}..."`
        );

        this.currentTaskId = taskId;
        const abortController = new AbortController();
        this.currentTaskAbortController = abortController;

        const taskRecord: DaemonTaskRecord = {
          taskId,
          backend,
          prompt: body.prompt,
          projectPath: targetPath,
          projectName: basename(targetPath),
          status: 'running',
          startedAt: Date.now(),
        };
        this.tasks.set(taskId, taskRecord);
        this.persistTasks();

        this.broadcastWs('task:started', { ...taskRecord });

        const runTask = async (): Promise<DaemonTaskRecord> => {
          try {
            const slashReply = await this.tryExecuteSlashCommand(
              String(body.prompt),
              backend,
              targetPath
            );
            const result = slashReply
              ? { text: slashReply }
              : await this.runtime.executeTask(backend, body.prompt, {
                  targetPath,
                  signal: abortController.signal,
                  onChunk: (delta) => {
                    taskRecord.text = (taskRecord.text || '') + delta;
                    taskRecord.replyText = taskRecord.text;
                    this.broadcastWs('task:chunk', {
                      taskId,
                      delta,
                      text: taskRecord.text,
                    });
                  },
                  onFilesChanged: (files) => {
                    taskRecord.filesChanged = files;
                    this.broadcastWs('task:progress', { taskId, filesChanged: files });
                  },
                });

            taskRecord.status = 'completed';
            taskRecord.completedAt = Date.now();
            taskRecord.replyText = result.text;
            taskRecord.text = result.text;
            taskRecord.fileSummary = result.fileSummary;
            taskRecord.filesChanged = result.filesChanged;
            this.persistTasks();

            this.broadcastWs('task:completed', { ...taskRecord });
            if (!slashReply) {
              void this.fcmService.sendPush({
                title: 'Nexus : Tâche terminée ✅',
                body: taskRecord.fileSummary || 'La tâche demandée a été exécutée avec succès.',
                data: { taskId, type: 'task_completed' },
              });
            }
            return taskRecord;
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            taskRecord.status = abortController.signal.aborted ? 'cancelled' : 'failed';
            taskRecord.completedAt = Date.now();
            taskRecord.error = message;
            this.persistTasks();
            this.broadcastWs('task:failed', { taskId, error: message });
            void this.fcmService.sendPush({
              title: 'Nexus : Tâche échouée ❌',
              body: message || 'Une erreur est survenue lors de l’exécution.',
              data: { taskId, type: 'task_failed' },
            });
            return taskRecord;
          } finally {
            this.runningTaskPromises.delete(taskId);
            if (this.currentTaskId === taskId) {
              this.currentTaskId = undefined;
              this.currentTaskAbortController = undefined;
            }
          }
        };

        const taskPromise = runTask();
        this.runningTaskPromises.set(taskId, taskPromise);

        if (body.wait === false) {
          void taskPromise;
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(taskRecord));
          return;
        }

        const completedRecord = await taskPromise;
        const statusCode = completedRecord.status === 'failed' ? 500 : 200;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(completedRecord));
        return;
      }

      if (pathname.startsWith('/api/tasks/') && pathname.endsWith('/cancel') && method === 'POST') {
        const parts = pathname.slice('/api/tasks/'.length).split('/');
        const taskId = parts[0];
        const task = this.tasks.get(taskId);
        if (task && task.status === 'running') {
          task.status = 'cancelled';
          task.completedAt = Date.now();
        }
        this.currentTaskAbortController?.abort();
        this.runtime.cancelCurrentWork();
        this.broadcastWs('task:cancelled', { taskId });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ cancelled: true, taskId }));
        return;
      }

      // 6. Approvals
      if (pathname === '/api/approvals' && method === 'GET') {
        const items = [...this.pendingApprovals.values()].map((item) => ({
          approvalId: item.approvalId,
          taskId: item.taskId,
          agentName: item.agentName,
          kind: item.kind,
          toolName: item.toolName,
          summary: item.summary,
          details: item.details,
          expiresAt: item.expiresAt,
          requestedAt: item.requestedAt,
          status: 'pending',
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(items));
        return;
      }

      if (
        pathname.startsWith('/api/approvals/') &&
        pathname.endsWith('/decide') &&
        method === 'POST'
      ) {
        const parts = pathname.slice('/api/approvals/'.length).split('/');
        const approvalId = parts[0];
        const item = this.pendingApprovals.get(approvalId);

        if (!item) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Approbation introuvable ou expirée' }));
          return;
        }

        const body = JSON.parse(await this.readRequestBody(req));
        const decision: ApprovalDecision = body.decision === 'accept' ? 'accept' : 'decline';
        item.settle(decision);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ approvalId, decision }));
        return;
      }

      // 404 for unhandled paths
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Route non trouvée: ${pathname}` }));
    } catch (err: unknown) {
      const isSecurity = err instanceof SecurityError;
      const status = isSecurity ? 403 : 500;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
          code: isSecurity ? 'SECURITY_VIOLATION' : 'INTERNAL_ERROR',
        })
      );
    }
  }

  private scanProjects(): readonly DaemonProjectInfo[] {
    const projects: DaemonProjectInfo[] = [];
    const roots = this.jail.getAllowedRoots();

    for (const root of roots) {
      if (!existsSync(root) || !statSync(root).isDirectory()) {
        continue;
      }
      try {
        const entries = readdirSync(root, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') {
            continue;
          }
          const candidatePath = resolve(root, entry.name);
          const isProject =
            existsSync(resolve(candidatePath, '.git')) ||
            existsSync(resolve(candidatePath, 'package.json'));

          if (isProject) {
            projects.push({
              id: candidatePath,
              name: entry.name,
              path: candidatePath,
            });
          } else {
            // Check 1 level deeper for categorized projects (e.g. ~/code/bricolage/nexus)
            try {
              const subEntries = readdirSync(candidatePath, { withFileTypes: true });
              for (const sub of subEntries) {
                if (!sub.isDirectory() || sub.name.startsWith('.') || sub.name === 'node_modules') {
                  continue;
                }
                const subPath = resolve(candidatePath, sub.name);
                const isSubProject =
                  existsSync(resolve(subPath, '.git')) ||
                  existsSync(resolve(subPath, 'package.json'));
                if (isSubProject) {
                  projects.push({
                    id: subPath,
                    name: `${entry.name}/${sub.name}`,
                    path: subPath,
                  });
                }
              }
            } catch {}
          }
        }
      } catch {}
    }

    if (!projects.some((p) => p.path === this.activeProject.path)) {
      projects.unshift(this.activeProject);
    }

    return projects;
  }

  private async tryExecuteSlashCommand(
    rawPrompt: string,
    backend: TaskBackendType,
    targetPath: string
  ): Promise<string | undefined> {
    const trimmed = rawPrompt.trim();
    if (!trimmed.startsWith('/')) {
      return undefined;
    }

    const [cmdRaw, ...rest] = trimmed.split(/\s+/);
    const cmd = cmdRaw.toLowerCase();
    const argText = rest.join(' ').trim();

    if (cmd === '/new' || cmd === '/reset' || cmd === '/clear') {
      const sessionId = await this.runtime.handleSessionAction(
        backend,
        { type: 'new' },
        targetPath
      );
      return `✨ **Nouvelle session initialisée** sur \`${basename(targetPath)}\` (${backend.toUpperCase()} · session \`${sessionId}\`).`;
    }

    if (cmd === '/resume' && argText) {
      const sessionId = await this.runtime.handleSessionAction(
        backend,
        { type: 'resume', sessionId: argText },
        targetPath
      );
      return `🔄 **Session reprise** : \`${sessionId}\` (${backend.toUpperCase()}).`;
    }

    if (cmd === '/branches') {
      return await this.runtime.handleBranchAction({ type: 'list' }, targetPath);
    }

    if (cmd === '/switch' && argText) {
      return await this.runtime.handleBranchAction({ type: 'switch', name: argText }, targetPath);
    }

    if (cmd === '/status') {
      const status = await this.runtime.getStatus(targetPath);
      const branches = await this.runtime.listBranches(targetPath).catch(() => []);
      const currentBranch = branches.find((b) => b.current)?.name ?? 'aucune';
      const codexModel =
        status.codex?.reroutedModel ??
        status.codex?.model ??
        status.codex?.modelSelection?.model ??
        'gpt-5.4';
      const agyModel =
        status.antigravity?.model ??
        status.antigravity?.modelSelection?.model ??
        'gemini-3.8-flash-high';
      const claudeStatus = this.runtime.getClaudeService().getStatus();

      return [
        `### 📊 Statut Nexus Daemon`,
        `- **Dossier actif** : \`${targetPath}\` (branche \`${currentBranch}\`)`,
        `- **Agent sélectionné** : \`${backend.toUpperCase()}\``,
        `- **Codex** : ${status.codex?.sessionActive ? '🟢 Session active' : '⚪ Prêt'} · Modèle \`${codexModel}\``,
        `- **Antigravity** : ${status.antigravity?.sessionActive ? '🟢 Session active' : '⚪ Prêt'} · Modèle \`${agyModel}\``,
        `- **Claude Code** : ${claudeStatus.available ? '🟢 CLI installé' : '🔴 Absent'} · Modèle \`${claudeStatus.model ?? 'claude-sonnet-4-6'}\``,
        `- **Brain** : Fournisseur \`${status.brain?.provider ?? 'auto'}\` (${status.brain?.model ?? 'routé'})`,
      ].join('\n');
    }

    if (cmd === '/usage' || cmd === '/quota' || cmd === '/quotas') {
      const dash = await this.runtime.getDashboard();
      const lines: string[] = ['### 📈 Consommation & Quotas Nexus'];

      for (const agent of dash.agents) {
        const label =
          agent.id === 'codex'
            ? 'Codex (OpenAI)'
            : agent.id === 'antigravity'
              ? 'Antigravity (Gemini / Claude)'
              : 'Claude Code (Anthropic)';
        const tokStr =
          agent.totalTokens !== undefined
            ? `${agent.totalTokens.toLocaleString('fr-FR')} tokens`
            : '0 token mesuré sur cette session';
        const costStr = agent.costUsd !== undefined ? ` · Coût : $${agent.costUsd.toFixed(4)}` : '';
        lines.push(`\n**${label}** — Modèle : \`${agent.model ?? 'défaut'}\``);
        lines.push(`- Consommation : **${tokStr}**${costStr}`);
        if (agent.limits.length > 0) {
          for (const lim of agent.limits) {
            const rem = lim.remaining !== undefined ? `${Math.round(lim.remaining)}% restant` : '';
            const reset = lim.resetsAt
              ? ` (reset à ${new Date(lim.resetsAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})`
              : '';
            lines.push(`- ${lim.label} : **${rem}**${reset}`);
          }
        }
      }

      if (dash.brain.providers.length > 0) {
        lines.push(`\n**Nexus Brain** (sélection : \`${dash.brain.selection}\`)`);
        for (const p of dash.brain.providers.filter((pr) => pr.configured)) {
          lines.push(
            `- **${p.provider}** (\`${p.actualModel || p.model}\`) : ${p.requests} req · ${p.totalTokens.toLocaleString('fr-FR')} tokens`
          );
        }
      }
      return lines.join('\n');
    }

    if (cmd === '/persona') {
      const mem = this.runtime.getProjectMemory();
      if (argText) {
        mem.setGlobalPersona(argText);
        return `✅ **Persona global mis à jour dans Upstash** :\n\n${argText}`;
      }
      const current = mem.readGlobalPersona();
      const projPref = mem.readProjectPreferencesOnly(targetPath);
      const projSection = projPref
        ? `\n\n### 📁 Directives du projet (\`${basename(targetPath)}\`)\n\n${projPref}`
        : '';
      return `### 🧠 Persona Global (Upstash)\n\n${current || '*(Aucun persona défini)*'}${projSection}\n\n*Astuce : modifiez-le dans Paramètres → Persona & Mémoire ou via \`/persona <directives>\`.*`;
    }

    if (cmd === '/memory') {
      const mem = this.runtime.getProjectMemory();
      if (argText) {
        const recorded = this.runtime.recordProjectDecision(
          {
            title: 'Décision architecturale',
            decision: argText,
          },
          targetPath
        );
        return `✅ **Décision enregistrée dans la mémoire de \`${basename(targetPath)}\`** :\n- **${recorded.title}** : ${recorded.decision}`;
      }
      const formatted = mem.formatActiveDecisions(targetPath);
      return formatted
        ? `### 🗂️ Mémoire & Décisions (\`${basename(targetPath)}\`)\n\n${formatted}`
        : `Aucune décision architecturale enregistrée pour \`${basename(targetPath)}\`.`;
    }

    if (cmd === '/help') {
      return [
        '### 🛠️ Commandes Nexus disponibles',
        '- `/new` ou `/reset` : Démarrer une nouvelle session propre (Code ou Brain)',
        '- `/status` : Afficher l’état du projet, de la branche Git et des agents',
        '- `/usage` ou `/quotas` : Afficher les quotas temps réel et tokens consommés',
        '- `/branches` : Lister les branches Git du projet',
        '- `/switch <branche>` : Changer de branche Git',
        '- `/persona` : Afficher ou modifier le Persona global stocké dans Upstash',
        '- `/memory` : Afficher la mémoire de décisions du projet actif',
      ].join('\n');
    }

    return undefined;
  }

  private readRequestBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 2 * 1024 * 1024) {
          reject(new Error('Corps de requête trop volumineux (max 2MB)'));
        }
      });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }
}
