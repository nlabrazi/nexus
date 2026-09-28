import { logger } from '../logging/logger';
import { brainSystemPrompt, parseBrainDecision } from './brain-decision';
export { BRAIN_INSTRUCTIONS } from './brain-decision';
import { BrainDecision, BrainMessage, BrainModel } from './model';
import { ConversationProjectContext } from './types';

export interface OllamaBrainModelOptions {
  readonly host?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
}

const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen3.6:27b-mtp-q4_K_M';
const DEFAULT_TIMEOUT_MS = 60_000;

export async function listOllamaModels(host = DEFAULT_OLLAMA_HOST): Promise<string[]> {
  const url = `${host.replace(/\/+$/, '')}/api/tags`;
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) {
    throw new Error(`Ollama tags HTTP ${res.status}`);
  }
  const data = (await res.json()) as { models?: Array<{ name: string; model: string }> };
  if (!data?.models || !Array.isArray(data.models)) {
    return [];
  }
  return data.models.map((m) => m.name || m.model);
}

export async function checkOllamaAvailable(host = DEFAULT_OLLAMA_HOST): Promise<boolean> {
  try {
    const models = await listOllamaModels(host);
    return models.length > 0;
  } catch {
    return false;
  }
}

export class OllamaBrainModel implements BrainModel {
  private host: string;
  private modelName: string;
  private readonly timeoutMs: number;

  constructor(options?: OllamaBrainModelOptions) {
    this.host =
      options?.host ||
      process.env.OLLAMA_HOST ||
      process.env.OLLAMA_BASE_URL ||
      DEFAULT_OLLAMA_HOST;
    this.modelName = options?.model || process.env.NEXUS_BRAIN_MODEL || DEFAULT_MODEL;
    this.timeoutMs = options?.timeoutMs || DEFAULT_TIMEOUT_MS;
  }

  getModel(): string {
    return this.modelName;
  }

  setModel(model: string): void {
    this.modelName = model;
  }

  getHost(): string {
    return this.host;
  }

  setHost(host: string): void {
    this.host = host;
  }

  async decide(
    messages: readonly BrainMessage[],
    project: ConversationProjectContext | undefined,
    toolsAllowed: boolean,
    signal: AbortSignal
  ): Promise<BrainDecision> {
    signal.throwIfAborted();

    const startedAt = Date.now();
    try {
      const result = await this.callOllama(messages, project, toolsAllowed, signal);
      logger.info('Brain', 'decide', {
        provider: 'ollama',
        model: this.modelName,
        status: 'success',
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (ollamaErr: unknown) {
      if (signal.aborted) {
        throw ollamaErr;
      }

      logger.warn(
        'Brain',
        'decide',
        {
          provider: 'ollama',
          model: this.modelName,
          status: 'failed',
          durationMs: Date.now() - startedAt,
        },
        ollamaErr
      );
      const errMessage = ollamaErr instanceof Error ? ollamaErr.message : String(ollamaErr);
      throw new Error(
        `Impossible de contacter le moteur Nexus Brain local (Ollama sur ${this.host}) : ${errMessage}. Vérifiez qu'Ollama est lancé via "ollama serve".`
      );
    }
  }

  private async callOllama(
    messages: readonly BrainMessage[],
    project: ConversationProjectContext | undefined,
    toolsAllowed: boolean,
    signal: AbortSignal
  ): Promise<BrainDecision> {
    const url = `${this.host.replace(/\/+$/, '')}/api/chat`;

    const systemPrompt = brainSystemPrompt(project, toolsAllowed);

    const chatMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    for (const msg of messages) {
      chatMessages.push({
        role: msg.role === 'tool' ? 'user' : msg.role,
        content: msg.text,
      });
    }

    const payload = {
      model: this.modelName,
      messages: chatMessages,
      format: 'json',
      stream: false,
      options: {
        temperature: 0.3,
      },
    };

    const combinedSignal = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: combinedSignal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Ollama HTTP ${response.status} (${response.statusText}): ${errorText}`);
    }

    const result = (await response.json()) as {
      message?: { content?: string };
    };

    const rawContent = result.message?.content?.trim() || '';
    return parseBrainDecision(rawContent, toolsAllowed, false);
  }
}
