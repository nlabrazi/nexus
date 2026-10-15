import { ClaudeCodeClient } from './client';
import { ClaudeCodeClientOptions, ClaudeCodeModel } from './types';

export class ClaudeCodeService {
  private readonly client: ClaudeCodeClient;

  constructor(options: ClaudeCodeClientOptions = {}) {
    this.client = new ClaudeCodeClient(options);
  }

  public async sendPrompt(
    prompt: string,
    workspacePath: string,
    onFilesChanged?: (paths: readonly string[]) => void,
    onChunk?: (delta: string) => void
  ): Promise<string> {
    return this.client.sendPrompt(prompt, workspacePath, onFilesChanged, onChunk);
  }

  public async listModels(): Promise<ClaudeCodeModel[]> {
    return [
      {
        id: 'claude-3-7-sonnet',
        model: 'claude-3-7-sonnet',
        displayName: 'Claude 3.7 Sonnet',
        description: 'Modèle hybride raisonnement & vitesse optimal pour le code',
        isDefault: true,
        defaultReasoningEffort: 'medium',
        supportedReasoningEfforts: [
          { reasoningEffort: 'low', description: 'Rapide' },
          { reasoningEffort: 'medium', description: 'Équilibré' },
          { reasoningEffort: 'high', description: 'Approfondi' },
        ],
      },
      {
        id: 'claude-3-5-sonnet',
        model: 'claude-3-5-sonnet',
        displayName: 'Claude 3.5 Sonnet',
        description: 'Référence pour le développement logiciel rapide',
        isDefault: false,
      },
      {
        id: 'claude-3-opus',
        model: 'claude-3-opus',
        displayName: 'Claude 3 Opus',
        description: 'Raisonnement complexe et architectures larges',
        isDefault: false,
      },
    ];
  }

  public getStatus() {
    return this.client.getStatus();
  }

  public cancelCurrentWork(): boolean {
    return this.client.cancel();
  }

  public stop(): void {
    this.client.cancel();
  }
}
