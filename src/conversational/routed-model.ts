import { ModelMenu } from '../codex/types';
import { logger } from '../logging/logger';
import { BrainProviderError, CloudBrainModel, CloudProvider } from './cloud-model';
import { BrainDecision, BrainMessage, BrainModel } from './model';
import { listOllamaModels, OllamaBrainModel } from './ollama-model';
import { ConversationProjectContext } from './types';

export const CLOUD_DEFAULTS: ReadonlyArray<{ provider: CloudProvider; model: string }> = [
  { provider: 'cerebras', model: 'gpt-oss-120b' },
  { provider: 'groq', model: 'openai/gpt-oss-120b' },
  { provider: 'gemini', model: 'gemini-3.8-flash' },
  { provider: 'openrouter', model: 'openrouter/free' },
];
interface Route {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  readonly adapter: BrainModel;
}
interface RoutedBrainOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly ollama?: OllamaBrainModel;
  readonly cloudTimeoutMs?: number;
  readonly totalTimeoutMs?: number;
}

/** Automatic failover is opt-in through the auto selection; explicit choices stay pinned. */
export class RoutedBrainModel implements BrainModel {
  private readonly cloud: Route[];
  private readonly local: OllamaBrainModel;
  private selected: string;
  private readonly localModels = new Set<string>();
  private readonly totalTimeoutMs: number;

  constructor(options: RoutedBrainOptions = {}) {
    const env = options.env ?? process.env;
    this.totalTimeoutMs = options.totalTimeoutMs ?? 90_000;
    this.local =
      options.ollama ??
      new OllamaBrainModel({
        model: env.NEXUS_BRAIN_MODEL,
        host: env.OLLAMA_HOST || env.OLLAMA_BASE_URL,
      });
    this.localModels.add(this.local.getModel());
    this.cloud = CLOUD_DEFAULTS.flatMap(({ provider, model: defaultModel }) => {
      const prefix = provider.toUpperCase();
      const apiKey = (
        env[`${prefix}_API_KEY`] ||
        (provider === 'gemini' ? env.GOOGLE_GENAI_API_KEY : '') ||
        ''
      ).trim();
      if (!apiKey) return [];
      const model = env[`${prefix}_MODEL`]?.trim() || defaultModel;
      return [
        {
          id: `${provider}:${model}`,
          provider,
          model,
          adapter: new CloudBrainModel({
            provider,
            apiKey,
            model,
            timeoutMs: options.cloudTimeoutMs,
          }),
        },
      ];
    });
    const backend = env.NEXUS_BRAIN_BACKEND?.trim() || 'auto';
    if (backend === 'auto') this.selected = 'auto';
    else if (backend === 'ollama') this.selected = `ollama:${this.local.getModel()}`;
    else {
      const route = this.cloud.find((r) => r.provider === backend);
      if (!route) throw new BrainProviderError(backend, 'configuration');
      this.selected = route.id;
    }
  }

  getModel(): string {
    return this.selected;
  }
  getStatus(): { provider: string; model: string } {
    return this.selected === 'auto'
      ? { provider: 'auto', model: 'auto' }
      : {
          provider: this.selected.slice(0, this.selected.indexOf(':')),
          model: this.selected.slice(this.selected.indexOf(':') + 1),
        };
  }

  async listModels(): Promise<ModelMenu> {
    let localNames: string[] = [];
    try {
      localNames = await listOllamaModels(this.local.getHost());
    } catch {
      /* Local server may be offline. */
    }
    // Keep the configured local fallback selectable, even while Ollama is unavailable.
    localNames = [...new Set([this.local.getModel(), ...localNames])];
    this.localModels.clear();
    for (const model of localNames) this.localModels.add(model);
    const models = [
      {
        id: 'auto',
        label: 'Automatique',
        description: [...this.cloud.map((r) => r.provider), 'ollama'].join(' → '),
      },
      ...this.cloud.map((r) => ({
        id: r.id,
        label: `${r.provider} · ${r.model}`,
        description: 'Cloud · sélection fixe',
      })),
      ...localNames.map((model) => ({
        id: `ollama:${model}`,
        label: `Ollama · ${model}`,
        description: 'Local · aucun repli cloud',
      })),
    ].map(({ id, label, description }) => ({
      id,
      model: id,
      displayName: label,
      description,
      isDefault: id === this.selected,
      defaultReasoningEffort: '',
      supportedReasoningEfforts: [{ reasoningEffort: '', description: 'Par défaut' }],
    }));
    return { models, selected: { model: this.selected, effort: '' }, context: 'brain:routed' };
  }

  setModel(selection: string): void {
    if (selection === 'auto' || this.cloud.some((r) => r.id === selection)) {
      this.selected = selection;
      return;
    }
    if (selection.startsWith('ollama:') && this.localModels.has(selection.slice(7))) {
      this.local.setModel(selection.slice(7));
      this.selected = selection;
      return;
    }
    throw new BrainProviderError('brain', 'configuration');
  }

  async decide(
    messages: readonly BrainMessage[],
    project: ConversationProjectContext | undefined,
    toolsAllowed: boolean,
    signal: AbortSignal
  ): Promise<BrainDecision> {
    signal.throwIfAborted();
    const deadline = AbortSignal.timeout(this.totalTimeoutMs);
    const combined = AbortSignal.any([signal, deadline]);
    // Snapshot the route before awaiting: changing the menu cannot redirect an in-flight turn.
    const local: Route = {
      id: `ollama:${this.local.getModel()}`,
      provider: 'ollama',
      model: this.local.getModel(),
      adapter: new OllamaBrainModel({ host: this.local.getHost(), model: this.local.getModel() }),
    };
    const routes =
      this.selected === 'auto'
        ? [...this.cloud, local]
        : [this.cloud.find((r) => r.id === this.selected) ?? local];
    for (let i = 0; i < routes.length; i++) {
      const route = routes[i]!;
      const startedAt = Date.now();
      try {
        combined.throwIfAborted();
        const result = await route.adapter.decide(messages, project, toolsAllowed, combined);
        combined.throwIfAborted();
        logger.info('Brain', 'route', {
          provider: route.provider,
          model: route.model,
          status: 'success',
          durationMs: Date.now() - startedAt,
        });
        return result;
      } catch (error) {
        signal.throwIfAborted();
        if (deadline.aborted) throw new BrainProviderError('brain', 'timeout');
        logger.warn(
          'Brain',
          'route',
          {
            provider: route.provider,
            model: route.model,
            status: error instanceof BrainProviderError ? error.code : 'failed',
            durationMs: Date.now() - startedAt,
          },
          error
        );
        if (!(error instanceof BrainProviderError) || !error.retryable || i === routes.length - 1)
          throw error;
        const next = routes[i + 1]!;
        logger.info('Brain', 'fallback', {
          provider: next.provider,
          model: next.model,
          status: 'started',
        });
      }
    }
    throw new BrainProviderError('brain', 'unavailable');
  }
}
