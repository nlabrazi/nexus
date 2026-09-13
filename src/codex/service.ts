import { CodexClient } from './client';
import { CodexApprovalHandler, CodexServiceStatus } from './types';

export class CodexService {
  private readonly client: CodexClient;

  private sessionId?: string;
  private workspacePath?: string;
  private turnRunning = false;

  constructor(approvalHandler?: CodexApprovalHandler) {
    this.client = new CodexClient(approvalHandler);
  }

  async startSession(
    cwd: string
  ): Promise<string> {
    if (
      this.sessionId &&
      this.workspacePath === cwd
    ) {
      return this.sessionId;
    }

    if (
      this.sessionId &&
      this.workspacePath !== cwd
    ) {
      throw new Error(
        'A Codex session is already active for another workspace.'
      );
    }

    await this.client.start();

    const response =
      await this.client.startSession(cwd);

    this.sessionId = response.thread.id;
    this.workspacePath = cwd;

    return this.sessionId;
  }

  async sendPrompt(
    prompt: string
  ): Promise<string> {
    if (!this.sessionId) {
      throw new Error(
        'No active Codex session.'
      );
    }

    if (this.turnRunning) {
      throw new Error(
        'A Codex turn is already running.'
      );
    }

    this.turnRunning = true;

    try {
      return await this.client.runTurn(
        this.sessionId,
        prompt
      );
    } finally {
      this.turnRunning = false;
    }
  }

  getCurrentSessionId(): string | undefined {
    return this.sessionId;
  }

  isSessionActive(): boolean {
    return this.sessionId !== undefined;
  }

  isTurnRunning(): boolean {
    return this.turnRunning;
  }

  getStatus(): CodexServiceStatus {
    return {
      ...this.client.getStatus(),
      sessionId: this.sessionId,
      workspacePath: this.workspacePath,
    };
  }

  stop(): void {
    this.client.stop();

    this.sessionId = undefined;
    this.workspacePath = undefined;
    this.turnRunning = false;
  }
}
