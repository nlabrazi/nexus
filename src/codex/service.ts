import { CodexClient } from './client';

export class CodexService {
  private readonly client = new CodexClient();
  private sessionId?: string;

  async startSession(cwd: string): Promise<string> {
    await this.client.start();

    const response = await this.client.startSession(cwd);

    this.sessionId = response.thread.id;

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
  }
}
