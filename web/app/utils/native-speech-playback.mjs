import { chooseSpeechVoice } from './speech-voice.mjs';
import { splitNativeSpeechText } from './speech-text.mjs';

/** Capacitor speak resolves at the end of an utterance; stop can leave it pending. */
export function createNativeSpeechPlayback(engine, callbacks, timers = globalThis) {
  let generation = 0;
  let cancelPending = () => {};
  let stopping = Promise.resolve();
  let cachedVoices = null;

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
    async function bounded(promise, timeoutMs = 5_000) {
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = timers.setTimeout(() => reject(new Error('timeout')), timeoutMs);
      });
      try { return await Promise.race([promise, cancelled, timeout]); }
      finally { timers.clearTimeout(timer); }
    }
    try {
      await bounded(stopped);
      if (current !== generation) return;
      let voices = cachedVoices;
      if (!voices) {
        const result = await bounded(engine.getSupportedVoices()).catch(() => ({ voices: [] }));
        if (current !== generation) return;
        voices = Array.isArray(result?.voices) ? result.voices : [];
        if (voices.length > 0) cachedVoices = voices;
      } else {
        Promise.resolve(engine.getSupportedVoices())
          .then((res) => {
            if (Array.isArray(res?.voices) && res.voices.length > 0) cachedVoices = res.voices;
          })
          .catch(() => {});
      }
      let voice = chooseSpeechVoice(voices, options.voiceURI);
      if (voices.length > 0 && voice < 0) throw new Error('missing voice');
      const explicitVoice = voices.some((v) => v.voiceURI === options.voiceURI);
      const localFrance = voices.findIndex((v) => {
        const l = String(v.lang || '').toLowerCase().replaceAll('_', '-');
        return (l === 'fr-fr' || l === 'fra-fra') && v.localService;
      });
      const rate = Number.isFinite(options.rate) && options.rate >= 0.8 && options.rate <= 1.3 ? options.rate : 1;
      for (const chunk of splitNativeSpeechText(text)) {
        const speakPayload = voice >= 0
          ? {
              text: chunk,
              lang: String(voices[voice].lang || 'fr-FR').toLowerCase().startsWith('fra')
                ? 'fr-FR'
                : voices[voice].lang,
              voice,
              rate,
              pitch: 1,
              volume: 1,
              queueStrategy: 0,
              category: 'playback',
            }
          : {
              text: chunk,
              lang: 'fr-FR',
              rate,
              pitch: 1,
              volume: 1,
              queueStrategy: 0,
              category: 'playback',
            };
        const play = () => bounded(engine.speak(speakPayload), Math.max(60_000, chunk.length * 125));
        try { await play(); }
        catch (error) {
          if (current !== generation) return;
          if (voice < 0 || explicitVoice || voices[voice].localService || localFrance < 0) throw error;
          // Automatic online voices can be unavailable offline; retain the France accent.
          voice = localFrance;
          speakPayload.voice = voice;
          speakPayload.lang = String(voices[voice].lang || 'fr-FR').toLowerCase().startsWith('fra')
            ? 'fr-FR'
            : voices[voice].lang;
          await play();
        }
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
