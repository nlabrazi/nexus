import { CodexClient } from './client';

export class CodexService {
  private readonly client = new CodexClient();

  private sessionId?: string;
  private workspacePath?: string;

  async startSession(cwd: string): Promise<string> {
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

  getCurrentSessionId(): string | undefined {
    return this.sessionId;
  }

  isSessionActive(): boolean {
    return this.sessionId !== undefined;
  }

  stop(): void {
    this.client.stop();
    this.sessionId = undefined;
    this.workspacePath = undefined;
  }
}
