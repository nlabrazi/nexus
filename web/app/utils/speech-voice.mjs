/** Keep explicit choices; automatic mode prefers France, then other French locales (including Android ISO-3 fra-FRA). */
export function chooseSpeechVoice(voices, voiceURI) {
  if (!Array.isArray(voices) || voices.length === 0) return -1;
  const selected = voices.findIndex((voice) => voice.voiceURI === voiceURI);
  if (selected >= 0) return selected;
  const language = (voice) => String(voice.lang || '').toLowerCase().replaceAll('_', '-');
  for (const matches of [
    (v) => (language(v) === 'fr-fr' || language(v) === 'fra-fra') && !v.localService,
    (v) => language(v) === 'fr-fr' || language(v) === 'fra-fra',
    (v) => language(v) === 'fr' || language(v) === 'fra',
    (v) => language(v).startsWith('fr-') || language(v).startsWith('fra-'),
  ]) {
    const index = voices.findIndex(matches);
    if (index >= 0) return index;
  }
  return -1;
}
