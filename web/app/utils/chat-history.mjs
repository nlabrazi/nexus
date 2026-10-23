/**
 * Serializes and bounds chat messages for storage in Upstash Redis / local cache.
 * Limits history to `maxCount` recent messages (default 50) and bounds individual text payload sizes
 * to guarantee lightweight storage and zero risk of exceeding Upstash free tier quotas.
 */
export function serializeChatForUpstash(messages, maxCount = 50, maxTextLen = 30000) {
  if (!Array.isArray(messages)) return [];
  return messages.slice(-maxCount).map((m) => {
    const text = typeof m?.text === 'string' ? m.text.slice(0, maxTextLen) : '';
    return {
      id: typeof m?.id === 'string' ? m.id : String(Date.now()),
      role: m?.role === 'user' ? 'user' : 'assistant',
      backend: typeof m?.backend === 'string' ? m.backend : 'brain',
      text,
      timestamp: typeof m?.timestamp === 'number' ? m.timestamp : Date.now(),
      ...(typeof m?.fileSummary === 'string' ? { fileSummary: m.fileSummary.slice(0, 500) } : {}),
      ...(m?.error ? { error: true } : {}),
    };
  });
}

/**
 * Normalizes project key for persistent storage (e.g. from /home/kaox/code/nexus -> 'nexus')
 */
export function getProjectStorageKey(projectPathOrName) {
  if (!projectPathOrName || typeof projectPathOrName !== 'string') return 'default';
  const clean = projectPathOrName.replace(/\/+$/, '').trim();
  const segments = clean.split(/[/\\]/);
  return segments.pop() || 'default';
}
