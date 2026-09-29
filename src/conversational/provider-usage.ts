import { ProviderUsage, QuotaMetric } from '../runtime/dashboard-types';

export const PROVIDER_ACCOUNTS: Record<string, string> = {
  cerebras: 'https://cloud.cerebras.ai/',
  groq: 'https://console.groq.com/settings/limits',
  gemini: 'https://aistudio.google.com/usage',
  openrouter: 'https://openrouter.ai/settings/keys',
};
export function emptyProviderUsage(
  provider: string,
  model: string,
  configured: boolean
): ProviderUsage {
  return {
    provider,
    model,
    configured,
    requests: 0,
    measuredRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    limits: [],
    accountUrl: PROVIDER_ACCOUNTS[provider],
  };
}
export function finiteCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}
function headerCount(headers: Headers, key: string): number | undefined {
  const raw = headers.get(key);
  return raw?.trim() ? finiteCount(Number(raw)) : undefined;
}
export function durationMs(raw: string | null): number | undefined {
  if (!raw) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw) * 1000;
  const parts = [...raw.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d)/g)];
  if (parts.map((part) => part[0]).join('') !== raw) return undefined;
  const factors: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  const value = parts.reduce((sum, part) => sum + Number(part[1]) * factors[part[2]], 0);
  return finiteCount(value);
}
export function readQuotaHeaders(
  provider: string,
  headers: Headers,
  now = Date.now()
): QuotaMetric[] {
  const metrics: QuotaMetric[] = [];
  const read = (suffix: string, label: string, unit: QuotaMetric['unit']) => {
    const limit = headerCount(headers, `x-ratelimit-limit-${suffix}`);
    const remaining = headerCount(headers, `x-ratelimit-remaining-${suffix}`);
    if (limit === undefined && remaining === undefined) return;
    const delay = durationMs(headers.get(`x-ratelimit-reset-${suffix}`));
    metrics.push({
      id: suffix,
      label,
      unit,
      limit,
      remaining,
      resetsAt: delay === undefined ? undefined : now + delay,
      observedAt: now,
    });
  };
  if (provider === 'groq') {
    read('requests', 'Requêtes / jour', 'requests');
    read('tokens', 'Tokens / minute', 'tokens');
  } else if (provider === 'cerebras') {
    for (const [window, label] of [
      ['minute', 'minute'],
      ['hour', 'heure'],
      ['day', 'jour'],
    ]) {
      read(`tokens-${window}`, `Tokens / ${label}`, 'tokens');
      read(`requests-${window}`, `Requêtes / ${label}`, 'requests');
    }
  } else if (provider === 'openrouter') {
    const limit = headerCount(headers, 'x-ratelimit-limit');
    const remaining = headerCount(headers, 'x-ratelimit-remaining');
    if (limit !== undefined || remaining !== undefined)
      metrics.push({
        id: 'rate',
        label: 'Fenêtre signalée par OpenRouter',
        unit: 'requests',
        limit,
        remaining,
        // Reset header units vary; the daily key endpoint provides an unambiguous UTC window.
        observedAt: now,
      });
  }
  return metrics;
}
export function mergeQuotaMetrics(previous: QuotaMetric[], next: QuotaMetric[]): QuotaMetric[] {
  return [
    ...previous.filter((metric) => !next.some((updated) => updated.id === metric.id)),
    ...next,
  ];
}
export function recordTokenUsage(usage: ProviderUsage, data: Record<string, unknown>): void {
  const raw = (usage.provider === 'gemini' ? data.usageMetadata : data.usage) as
    | Record<string, unknown>
    | undefined;
  if (!raw || typeof raw !== 'object') return;
  const input = finiteCount(raw.prompt_tokens ?? raw.promptTokenCount);
  const output = finiteCount(raw.completion_tokens ?? raw.candidatesTokenCount);
  const total =
    finiteCount(raw.total_tokens ?? raw.totalTokenCount) ??
    (input !== undefined && output !== undefined ? input + output : undefined);
  if (total === undefined) return;
  usage.measuredRequests++;
  usage.inputTokens += input ?? 0;
  usage.outputTokens += output ?? 0;
  usage.totalTokens += total;
}
export function readOpenRouterQuota(
  data: Record<string, unknown>,
  now = Date.now()
): QuotaMetric[] {
  const result: QuotaMetric[] = [];
  const limit = finiteCount(data.limit),
    remaining = finiteCount(data.limit_remaining);
  if (limit !== undefined || remaining !== undefined)
    result.push({
      id: 'credits',
      label: 'Plafond de la clé',
      unit: 'USD',
      limit,
      remaining,
      observedAt: now,
    });
  const free = data.free_model_daily_requests as Record<string, unknown> | undefined;
  if (free && typeof free === 'object') {
    const limit = finiteCount(free.limit),
      remaining = finiteCount(free.remaining),
      used = finiteCount(free.used);
    if (limit !== undefined || remaining !== undefined) {
      const tomorrow = new Date(now);
      tomorrow.setUTCHours(24, 0, 0, 0);
      result.push({
        id: 'free-daily',
        label: 'Requêtes gratuites / jour UTC',
        unit: 'requests',
        limit,
        remaining,
        used,
        resetsAt: tomorrow.getTime(),
        observedAt: now,
      });
    }
  }
  return result;
}
