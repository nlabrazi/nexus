import { splitSpeechText } from './speech-text.mjs';

/** Capacitor speak resolves at the end of an utterance; stop can leave it pending. */
export function createNativeSpeechPlayback(engine, callbacks, timers = globalThis) {
  let generation = 0;
  let cancelPending = () => {};
  let stopping = Promise.resolve();

  function stop() {
    generation++;
    cancelPending();
    // Serialize stops, but never wait for a cancelled speak promise.
    stopping = stopping.then(() => engine.stop()).catch(() => {});
    callbacks.onState(false, null);
    return stopping;
  }

  async function speak(text, id, options = {}) {
    const stopped = stop();
    const current = generation;
    if (!text.trim()) return;
    callbacks.onState(true, id ?? null);
    const cancelled = new Promise((resolve) => { cancelPending = resolve; });
    async function bounded(promise) {
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = timers.setTimeout(() => reject(new Error('timeout')), 60_000);
      });
      try { return await Promise.race([promise, cancelled, timeout]); }
      finally { timers.clearTimeout(timer); }
    }
    try {
      await bounded(stopped);
      if (current !== generation) return;
      const result = await bounded(engine.getSupportedVoices());
      if (current !== generation) return;
      const voices = result.voices;
      let voice = voices.findIndex((v) => v.voiceURI === options.voiceURI);
      if (voice < 0) voice = voices.findIndex((v) => v.lang.toLowerCase().startsWith('fr') && v.localService);
      if (voice < 0) voice = voices.findIndex((v) => v.lang.toLowerCase().startsWith('fr'));
      if (voice < 0) throw new Error('missing voice');
      for (const chunk of splitSpeechText(text)) {
        await bounded(engine.speak({
          text: chunk, lang: voices[voice].lang, voice,
          rate: Number.isFinite(options.rate) && options.rate >= 0.8 && options.rate <= 1.3 ? options.rate : 1,
          pitch: 1, volume: 1, queueStrategy: 0, category: 'playback',
        }));
        if (current !== generation) return;
      }
      callbacks.onState(false, null);
    } catch {
      if (current !== generation) return;
      void stop();
      callbacks.onError('Lecture vocale indisponible. Vérifiez le moteur vocal et la voix française dans les paramètres Android. La réponse reste disponible en texte.');
    } finally {
      if (current === generation) cancelPending = () => {};
    }
  }
  return { speak, stop };
}
