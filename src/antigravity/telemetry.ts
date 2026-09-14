import {
  AntigravityModel,
  ConversationTokenUsage,
  InitEvent,
  ResultEvent,
  StepUpdateEvent,
  TokenBreakdown,
} from './types';

const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function isTokenUsage(value: unknown): value is ConversationTokenUsage {
  return (
    record(value) &&
    isTokenBreakdown(value.total) &&
    isTokenBreakdown(value.last) &&
    (value.modelContextWindow === null || count(value.modelContextWindow))
  );
}

export function isTokenBreakdown(value: unknown): value is TokenBreakdown {
  return (
    record(value) &&
    ['totalTokens', 'inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens'].every(
      key => count(value[key])
    ) &&
    (value.cacheWriteInputTokens === undefined || count(value.cacheWriteInputTokens))
  );
}

export function isModel(value: unknown): value is AntigravityModel {
  return (
    record(value) &&
    ['id', 'model', 'displayName', 'defaultReasoningEffort'].every(
      key => typeof value[key] === 'string' && (value[key] as string).trim()
    ) &&
    typeof value.description === 'string' &&
    typeof value.isDefault === 'boolean' &&
    Array.isArray(value.supportedReasoningEfforts) &&
    value.supportedReasoningEfforts.length > 0 &&
    value.supportedReasoningEfforts.every(
      option =>
        record(option) &&
        typeof option.reasoningEffort === 'string' &&
        !!option.reasoningEffort.trim() &&
        typeof option.description === 'string'
    ) &&
    value.supportedReasoningEfforts.some(
      option => option.reasoningEffort === value.defaultReasoningEffort
    )
  );
}

export function isInitEvent(value: unknown): value is InitEvent {
  return (
    record(value) &&
    value.event === 'init' &&
    typeof value.conversation_id === 'string' &&
    !!value.conversation_id.trim() &&
    record(value.init) &&
    typeof value.init.cwd === 'string'
  );
}

export function isStepUpdateEvent(value: unknown): value is StepUpdateEvent {
  return (
    record(value) &&
    value.event === 'step_update' &&
    record(value.step_update) &&
    typeof value.step_update.conversation_id === 'string' &&
    typeof value.step_update.step_index === 'number' &&
    typeof value.step_update.state === 'string' &&
    typeof value.step_update.step_type === 'string'
  );
}

export function isResultEvent(value: unknown): value is ResultEvent {
  return (
    record(value) &&
    value.event === 'result' &&
    record(value.result) &&
    typeof value.result.conversation_id === 'string' &&
    typeof value.result.status === 'string' &&
    typeof value.result.response === 'string'
  );
}

export function parseModelsOutput(raw: string): AntigravityModel[] {
  const models: AntigravityModel[] = [];
  const lines = raw.split('\n');

  for (const line of lines) {
    // Strip terminal spinner artifacts (e.g. ⠋ Fetching available models...)
    const clean = line.replace(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏\s]+Fetching available models\.\.\./, '').trim();
    if (!clean) {
      continue;
    }

    const match = /^([a-zA-Z0-9._-]+)\s+(.+)$/.exec(clean);
    if (!match) {
      continue;
    }

    const modelId = match[1].trim();
    const displayName = match[2].trim();

    // Determine default effort and supported efforts
    let defaultEffort = 'medium';
    if (modelId.endsWith('-high')) {
      defaultEffort = 'high';
    } else if (modelId.endsWith('-low')) {
      defaultEffort = 'low';
    }

    const isDefault = modelId === 'gemini-3.8-flash-high' || models.length === 0;

    models.push({
      id: modelId,
      model: modelId,
      displayName,
      description: `Modèle Gemini Antigravity : ${displayName}`,
      hidden: false,
      isDefault,
      defaultReasoningEffort: defaultEffort,
      supportedReasoningEfforts: [
        { reasoningEffort: 'high', description: 'Raisonnement élevé' },
        { reasoningEffort: 'medium', description: 'Raisonnement moyen' },
        { reasoningEffort: 'low', description: 'Raisonnement faible' },
      ],
    });
  }

  return models;
}

export function convertRawUsage(raw: {
  input_tokens?: number;
  output_tokens?: number;
  thinking_tokens?: number;
  cache_read_tokens?: number;
  total_tokens?: number;
}): TokenBreakdown {
  return {
    totalTokens: raw.total_tokens ?? 0,
    inputTokens: raw.input_tokens ?? 0,
    cachedInputTokens: raw.cache_read_tokens ?? 0,
    outputTokens: raw.output_tokens ?? 0,
    reasoningOutputTokens: raw.thinking_tokens ?? 0,
  };
}
