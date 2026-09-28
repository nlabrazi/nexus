import { chooseSpeechVoice } from './speech-voice.mjs';
import { splitSpeechText } from './speech-text.mjs';

/** Browser speech lifecycle, independent of Vue and easy to exercise without an audio device. */
export function createSpeechPlayback(engine, createUtterance, callbacks, timers = globalThis) {
  let generation = 0;
  let timer;
  let activeUtterance;

  function clearTimer() {
    if (timer !== undefined) timers.clearTimeout(timer);
    timer = undefined;
  }

  function stop() {
    generation++;
    clearTimer();
    activeUtterance = undefined;
    try { engine.cancel(); } catch { /* Text remains available. */ }
    callbacks.onState(false, null);
  }

  function speak(text, id, options = {}) {
    stop();
    const current = generation;
    // Short utterances prevent the browser from stalling on long answers.
    const chunks = splitSpeechText(text);
    if (!text.trim()) return;
    let index = 0;
    function fail() {
      if (current !== generation) return;
      stop();
      callbacks.onError('Lecture vocale indisponible. La réponse reste disponible en texte.');
    }
    function next() {
      if (current !== generation) return;
      if (index >= chunks.length) {
        clearTimer();
        activeUtterance = undefined;
        callbacks.onState(false, null);
        return;
      }
      try {
        const utterance = createUtterance(chunks[index++]);
        activeUtterance = utterance; // Retain a strong reference until completion.
        utterance.lang = 'fr-FR';
        utterance.rate = Number.isFinite(options.rate) && options.rate >= 0.8 && options.rate <= 1.3 ? options.rate : 1;
        const voices = engine.getVoices();
        const voice = voices[chooseSpeechVoice(voices, options.voiceURI)];
        if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
        const isCurrent = () => current === generation && activeUtterance === utterance;
        utterance.onstart = () => {
          if (!isCurrent()) return;
          clearTimer();
          callbacks.onState(true, id ?? null);
          timer = timers.setTimeout(fail, 60_000);
        };
        utterance.onend = () => {
          if (!isCurrent()) return;
          clearTimer();
          activeUtterance = undefined;
          next();
        };
        utterance.onerror = () => { if (isCurrent()) fail(); };
        callbacks.onState(true, id ?? null);
        timer = timers.setTimeout(fail, 5_000);
        engine.speak(utterance);
      } catch { fail(); }
    }
    next();
  }
  return { speak, stop };
}
