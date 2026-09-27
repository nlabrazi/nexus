import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createNexusMessage, serializeNexusMessage } from '../protocol/messages';
import {
  NexusProtocolError,
  TaskCompletedPayload,
  TaskFailedPayload,
  TaskProgressPayload,
  nodeBusyError,
  nodeOfflineError,
  taskNotFoundError,
} from '../protocol';
import { NodePresenceManager } from './presence';
import { ConnectedNode, RemoteTask, RemoteTaskStatus, SubmitTaskOptions } from './types';
import { WebSocketServerConnection } from './ws-connection';

interface TaskDeferred {
  promise: Promise<TaskCompletedPayload>;
  resolve: (result: TaskCompletedPayload) => void;
  reject: (error: Error) => void;
}

export interface TaskRouterOptions {
  readonly defaultTaskTimeoutMs?: number;
}

export class TaskRouter extends EventEmitter {
  private readonly tasks = new Map<string, RemoteTask>();
  private readonly deferredMap = new Map<string, TaskDeferred>();
  private readonly defaultTaskTimeoutMs: number;

  constructor(
    private readonly presence: NodePresenceManager,
    private readonly getNodeConnection: (nodeId: string) => WebSocketServerConnection | undefined,
    options?: TaskRouterOptions
  ) {
    super();
    this.defaultTaskTimeoutMs = options?.defaultTaskTimeoutMs ?? 120_000;
  }

  async submitTask(options: SubmitTaskOptions): Promise<RemoteTask> {
    const targetNode = this.resolveTargetNode(options);
    if (!targetNode) {
      throw nodeOfflineError();
    }
    if (!targetNode.online) {
      throw nodeOfflineError(targetNode.nodeId);
    }
    if (targetNode.state === 'busy') {
      throw nodeBusyError(targetNode.nodeId);
    }
    if (targetNode.state === 'draining') {
      throw nodeOfflineError(targetNode.nodeId);
    }

    const conn = this.getNodeConnection(targetNode.nodeId);
    if (!conn?.isOpen()) {
      throw nodeOfflineError(targetNode.nodeId);
    }

    const taskId = options.taskId ?? randomUUID();
    const task: RemoteTask = {
      taskId,
      backend: options.backend,
      prompt: options.prompt,
      projectId: options.projectId,
      nodeId: targetNode.nodeId,
      status: 'pending',
      createdAt: Date.now(),
    };

    this.tasks.set(taskId, task);

    // Setup deferred promise for awaiting results
    let resolveFn!: (result: TaskCompletedPayload) => void;
    let rejectFn!: (error: Error) => void;
    const promise = new Promise<TaskCompletedPayload>((res, rej) => {
      resolveFn = res;
      rejectFn = rej;
    });
    // Suppress unhandledRejection if task fails before/without waitForTask
    promise.catch(() => {});

    this.deferredMap.set(taskId, {
      promise,
      resolve: resolveFn,
      reject: rejectFn,
    });

    // Mark node as busy with active task
    this.presence.updateStatus({
      nodeId: targetNode.nodeId,
      state: 'busy',
      activeTaskId: taskId,
    });

    // Send task:start to Desktop Node over WebSocket
    const startMsg = createNexusMessage(
      'task:start',
      {
        taskId,
        backend: options.backend,
        prompt: options.prompt,
        projectId: options.projectId,
        sessionId: options.sessionId,
      },
      { traceId: options.traceId }
    );

    conn.send(serializeNexusMessage(startMsg));
    this.emit('task:started', task);

    return task;
  }

  async executeTask(options: SubmitTaskOptions, timeoutMs?: number): Promise<TaskCompletedPayload> {
    const task = await this.submitTask(options);
    return this.waitForTask(task.taskId, timeoutMs);
  }

  async waitForTask(taskId: string, timeoutMs?: number): Promise<TaskCompletedPayload> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw taskNotFoundError(taskId);
    }

    if (task.status === 'completed' && task.result) {
      return task.result;
    }
    if (task.status === 'failed' || task.status === 'cancelled') {
      throw new NexusProtocolError(
        task.error?.code ?? 'TASK_EXECUTION_FAILED',
        task.error?.message ?? `Tâche échouée : ${taskId}`
      );
    }

    const deferred = this.deferredMap.get(taskId);
    if (!deferred) {
      throw taskNotFoundError(taskId);
    }

    const limit = timeoutMs ?? this.defaultTaskTimeoutMs;
    let timer: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        this.cancelTask(taskId, 'Timeout d’exécution dépassé').catch(() => {});
        reject(
          new NexusProtocolError(
            'TASK_TIMEOUT',
            `Délai dépassé (${limit}ms) pour la tâche ${taskId}.`
          )
        );
      }, limit);
      timer.unref?.();
    });

    try {
      return await Promise.race([deferred.promise, timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  recordProgress(payload: TaskProgressPayload): void {
    const task = this.tasks.get(payload.taskId);
    if (!task) {
      return;
    }

    task.status = 'running';
    task.stage = payload.stage;
    task.progressMessage = payload.message;
    task.activeTool = payload.activeTool;
    if (!task.startedAt) {
      task.startedAt = Date.now();
    }

    this.emit('task:progress', task);
  }

  recordCompleted(payload: TaskCompletedPayload): void {
    const task = this.tasks.get(payload.taskId);
    if (!task) {
      return;
    }

    task.status = 'completed';
    task.completedAt = Date.now();
    task.result = payload;

    const deferred = this.deferredMap.get(payload.taskId);
    if (deferred) {
      deferred.resolve(payload);
      this.deferredMap.delete(payload.taskId);
    }

    // Reset node busy state if it matches activeTaskId and node is online
    const node = this.presence.getNode(task.nodeId);
    if (node?.online && node.activeTaskId === payload.taskId) {
      this.presence.updateStatus({
        nodeId: task.nodeId,
        state: 'idle',
        activeTaskId: undefined,
      });
    }

    this.emit('task:completed', task);
  }

  recordFailed(payload: TaskFailedPayload): void {
    const task = this.tasks.get(payload.taskId);
    if (!task) {
      return;
    }

    const isCancelled = payload.error.code === 'TASK_CANCELLED';
    task.status = isCancelled ? 'cancelled' : 'failed';
    task.completedAt = Date.now();
    task.error = payload.error;

    const deferred = this.deferredMap.get(payload.taskId);
    if (deferred) {
      deferred.reject(new NexusProtocolError(payload.error.code, payload.error.message));
      this.deferredMap.delete(payload.taskId);
    }

    // Reset node busy state if it matches activeTaskId and node is online
    const node = this.presence.getNode(task.nodeId);
    if (node?.online && node.activeTaskId === payload.taskId) {
      this.presence.updateStatus({
        nodeId: task.nodeId,
        state: 'idle',
        activeTaskId: undefined,
      });
    }

    this.emit(isCancelled ? 'task:cancelled' : 'task:failed', task);
  }

  async cancelTask(taskId: string, reason?: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }

    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      return false;
    }

    const conn = this.getNodeConnection(task.nodeId);
    if (conn?.isOpen()) {
      const cancelMsg = createNexusMessage('task:cancel', {
        taskId,
        reason: reason ?? 'Annulation demandée par l’utilisateur',
      });
      conn.send(serializeNexusMessage(cancelMsg));
    } else {
      // Force failure if socket is already gone
      this.recordFailed({
        taskId,
        error: {
          code: 'TASK_CANCELLED',
          message: reason ?? 'Annulation demandée (nœud déconnecté)',
        },
      });
    }

    return true;
  }

  handleNodeDisconnected(nodeId: string): void {
    for (const task of this.tasks.values()) {
      if (task.nodeId === nodeId && (task.status === 'pending' || task.status === 'running')) {
        this.recordFailed({
          taskId: task.taskId,
          error: {
            code: 'NODE_OFFLINE',
            message: `Le nœud desktop « ${nodeId} » s'est déconnecté pendant l'exécution de la tâche.`,
          },
        });
      }
    }
  }

  getTask(taskId: string): RemoteTask | undefined {
    return this.tasks.get(taskId);
  }

  listTasks(filter?: { status?: RemoteTaskStatus; nodeId?: string }): readonly RemoteTask[] {
    const all = Array.from(this.tasks.values());
    if (!filter) {
      return all;
    }
    return all.filter((t) => {
      if (filter.status && t.status !== filter.status) {
        return false;
      }
      if (filter.nodeId && t.nodeId !== filter.nodeId) {
        return false;
      }
      return true;
    });
  }

  private resolveTargetNode(options: SubmitTaskOptions): ConnectedNode | undefined {
    if (options.nodeId) {
      return this.presence.getNode(options.nodeId);
    }

    if (options.projectId) {
      for (const node of this.presence.getOnlineNodes()) {
        const hasProject = node.projects.some(
          (p) => p.id === options.projectId || p.name === options.projectId
        );
        if (hasProject) {
          return node;
        }
      }
    }

    return this.presence.getPrimaryOnlineNode();
  }
}
