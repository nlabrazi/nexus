import { CodexModel, RateLimitSnapshot, ThreadTokenUsage, TokenBreakdown } from './types';

const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const absent = (value: unknown): boolean => value === null || value === undefined;

function breakdown(value: unknown): value is TokenBreakdown {
  return (
    record(value) &&
    [
      'totalTokens',
      'inputTokens',
      'cachedInputTokens',
      'outputTokens',
      'reasoningOutputTokens',
    ].every((key) => count(value[key])) &&
    (value.cacheWriteInputTokens === undefined || count(value.cacheWriteInputTokens))
  );
}

export function isTokenUsage(value: unknown): value is ThreadTokenUsage {
  return (
    record(value) &&
    breakdown(value.total) &&
    breakdown(value.last) &&
    (value.modelContextWindow === null || count(value.modelContextWindow))
  );
}

export function isModel(value: unknown): value is CodexModel {
  return (
    record(value) &&
    ['id', 'model', 'displayName', 'defaultReasoningEffort'].every(
      (key) => typeof value[key] === 'string' && (value[key] as string).trim()
    ) &&
    typeof value.description === 'string' &&
    typeof value.isDefault === 'boolean' &&
    Array.isArray(value.supportedReasoningEfforts) &&
    value.supportedReasoningEfforts.length > 0 &&
    value.supportedReasoningEfforts.every(
      (option) =>
        record(option) &&
        typeof option.reasoningEffort === 'string' &&
        !!option.reasoningEffort.trim() &&
        typeof option.description === 'string'
    ) &&
    value.supportedReasoningEfforts.some(
      (option) => option.reasoningEffort === value.defaultReasoningEffort
    )
  );
}

export function isRateLimit(value: unknown): value is RateLimitSnapshot {
  return (
    record(value) &&
    ['limitId', 'limitName', 'planType'].every(
      (key) => absent(value[key]) || typeof value[key] === 'string'
    ) &&
    ['primary', 'secondary'].every((key) => {
      const window = value[key];
      return (
        absent(window) ||
        (record(window) &&
          typeof window.usedPercent === 'number' &&
          Number.isFinite(window.usedPercent) &&
          window.usedPercent >= 0 &&
          (absent(window.windowDurationMins) || count(window.windowDurationMins)) &&
          (absent(window.resetsAt) || (count(window.resetsAt) && window.resetsAt < 8.64e12)))
      );
    })
  );
}
