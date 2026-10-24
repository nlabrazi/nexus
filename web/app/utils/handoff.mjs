/**
 * Helper utilities for 1-click Brain -> Coding Agent handoff
 */
export function formatHandoffPrompt(text) {
  const clean = (text || '').trim();
  if (!clean) return '';
  if (clean.startsWith('Mets en œuvre')) {
    return clean;
  }
  return `Mets en œuvre la proposition suivante conçue avec Brain :\n\n${clean}`;
}

export function resolveHandoffBackend(currentBackend, lastCodingBackend, defaultBackend = 'codex') {
  if (currentBackend && currentBackend !== 'brain') {
    return currentBackend;
  }
  return lastCodingBackend || defaultBackend;
}
