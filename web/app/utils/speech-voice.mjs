/** Keep explicit choices; automatic mode prefers France, then other French locales. */
export function chooseSpeechVoice(voices, voiceURI) {
  const selected = voices.findIndex((voice) => voice.voiceURI === voiceURI);
  if (selected >= 0) return selected;
  const language = (voice) => voice.lang.toLowerCase().replaceAll('_', '-');
  for (const matches of [
    (v) => language(v) === 'fr-fr' && !v.localService,
    (v) => language(v) === 'fr-fr',
    (v) => language(v) === 'fr',
    (v) => language(v).startsWith('fr-'),
  ]) {
    const index = voices.findIndex(matches);
    if (index >= 0) return index;
  }
  return -1;
}
