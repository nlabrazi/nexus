import { DiagnosticError, registerLogSecret } from '../logging/logger';
import { brainSystemPrompt, parseBrainDecision } from './brain-decision';
import { BrainDecision, BrainMessage, BrainModel } from './model';
import { ConversationProjectContext } from './types';

export type CloudProvider = 'cerebras' | 'groq' | 'gemini' | 'openrouter';
export type ProviderFailure =
  | 'rate_limited'
  | 'quota_exhausted'
  | 'unavailable'
  | 'timeout'
  | 'network'
  | 'invalid_response'
  | 'authentication'
  | 'configuration'
  | 'refused';
export class BrainProviderError extends DiagnosticError {
  constructor(
    readonly provider: string,
    readonly code: ProviderFailure
  ) {
    super(
      `Nexus Brain (${provider}) : ${code}. ${code === 'authentication' ? 'Vérifiez la clé API sur le poste Nexus.' : code === 'configuration' ? 'Vérifiez le modèle et la configuration du fournisseur.' : 'La demande n’a pas pu aboutir.'}`
    );
    this.name = 'BrainProviderError';
  }
  get retryable(): boolean {
    return !['authentication', 'configuration', 'refused'].includes(this.code);
  }
}

const ENDPOINTS: Record<Exclude<CloudProvider, 'gemini'>, string> = {
  cerebras: 'https://api.cerebras.ai/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
};
export interface CloudBrainOptions {
  readonly provider: CloudProvider;
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs?: number;
}

/** One bounded request, without SDK retries or logging of provider response bodies. */
export class CloudBrainModel implements BrainModel {
  readonly provider: CloudProvider;
  readonly model: string;
  constructor(private readonly options: CloudBrainOptions) {
    this.provider = options.provider;
    this.model = options.model;
    registerLogSecret(options.apiKey);
    if (
      !options.apiKey.trim() ||
      !options.model.trim() ||
      (this.provider === 'openrouter' &&
        this.model !== 'openrouter/free' &&
        !this.model.endsWith(':free'))
    ) {
      throw new BrainProviderError(this.provider, 'configuration');
    }
  }

  async decide(
    messages: readonly BrainMessage[],
    project: ConversationProjectContext | undefined,
    toolsAllowed: boolean,
    signal: AbortSignal
  ): Promise<BrainDecision> {
    signal.throwIfAborted();
    const deadline = AbortSignal.timeout(this.options.timeoutMs ?? 15_000);
    const combined = AbortSignal.any([signal, deadline]);
    const system = brainSystemPrompt(project, toolsAllowed);
    const gemini = this.provider === 'gemini';
    const url = gemini
      ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`
      : ENDPOINTS[this.provider as Exclude<CloudProvider, 'gemini'>];
    const body = gemini
      ? {
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.text }],
          })),
          generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 4096 },
        }
      : {
          model: this.model,
          stream: false,
          max_tokens: 4096,
          messages: [
            { role: 'system', content: system },
            ...messages.map((m) => ({
              role: m.role === 'tool' ? 'user' : m.role,
              content: m.text,
            })),
          ],
          response_format: { type: 'json_object' },
          ...(this.provider === 'openrouter' ? { provider: { require_parameters: true } } : {}),
        };
    try {
      const response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        signal: combined,
        headers: {
          'Content-Type': 'application/json',
          ...(gemini
            ? { 'x-goog-api-key': this.options.apiKey }
            : { Authorization: `Bearer ${this.options.apiKey}` }),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        // Never include the raw response: it can echo credentials or conversation text.
        const code: ProviderFailure =
          response.status === 429
            ? 'rate_limited'
            : response.status === 402
              ? 'quota_exhausted'
              : response.status === 401 || response.status === 403
                ? 'authentication'
                : response.status === 408
                  ? 'timeout'
                  : response.status >= 500
                    ? 'unavailable'
                    : 'configuration';
        void response.body?.cancel().catch(() => {});
        throw new BrainProviderError(this.provider, code);
      }
      const data = (await response.json()) as {
        choices?: Array<{
          message?: { content?: unknown; refusal?: string };
          finish_reason?: string;
        }>;
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string; thought?: boolean }> };
          finishReason?: string;
        }>;
        promptFeedback?: { blockReason?: string };
      };
      let raw: unknown;
      if (gemini) {
        const candidate = data.candidates?.[0];
        if (
          data.promptFeedback?.blockReason ||
          (candidate?.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason))
        )
          throw new BrainProviderError(this.provider, 'refused');
        if (candidate?.finishReason === 'MAX_TOKENS')
          throw new BrainProviderError(this.provider, 'invalid_response');
        raw = candidate?.content?.parts
          ?.filter((p) => !p.thought)
          .map((p) => p.text ?? '')
          .join('');
      } else {
        const choice = data.choices?.[0];
        if (choice?.message?.refusal || choice?.finish_reason === 'content_filter')
          throw new BrainProviderError(this.provider, 'refused');
        if (choice?.finish_reason && choice.finish_reason !== 'stop')
          throw new BrainProviderError(this.provider, 'invalid_response');
        raw = choice?.message?.content;
      }
      if (typeof raw !== 'string' || !raw.trim())
        throw new BrainProviderError(this.provider, 'invalid_response');
      try {
        return parseBrainDecision(raw, toolsAllowed);
      } catch {
        throw new BrainProviderError(this.provider, 'invalid_response');
      }
    } catch (error) {
      signal.throwIfAborted();
      if (deadline.aborted) throw new BrainProviderError(this.provider, 'timeout');
      if (error instanceof BrainProviderError) throw error;
      throw new BrainProviderError(
        this.provider,
        error instanceof SyntaxError ? 'invalid_response' : 'network'
      );
    }
  }
}
