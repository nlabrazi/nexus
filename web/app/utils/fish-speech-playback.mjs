import { splitNativeSpeechText } from './speech-text.mjs';

/**
 * Extract a clean Fish Audio reference_id from either a raw ID or a fish.audio URL.
 */
export function normalizeFishReferenceId(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  const hexMatch = raw.match(/\b([a-f0-9]{24,64})\b/i);
  if (hexMatch && (raw.includes('/') || raw.includes('fish.audio'))) {
    return hexMatch[1];
  }
  try {
    if (/^https?:\/\//i.test(raw)) {
      const url = new URL(raw);
      const parts = url.pathname.split('/').filter(Boolean);
      return parts.at(-1) || '';
    }
  } catch {
    // Keep raw token if not a valid URL
  }
  return raw;
}

/**
 * Cloud TTS player powered by Fish Audio with automatic fallback to local/native TTS.
 */
export function createFishSpeechPlayback({
  synthesize,
  createAudio,
  fallbackPlayer,
  callbacks,
  timers = globalThis,
}) {
  let generation = 0;
  let cancelCurrent = () => {};

  function stop() {
    generation++;
    cancelCurrent();
    cancelCurrent = () => {};
    const fallbackStopped = fallbackPlayer?.stop?.();
    callbacks.onState(false, null);
    return Promise.resolve(fallbackStopped);
  }

  async function playAudioElement(audio, timeoutMs = 90_000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = timers.setTimeout(() => {
        finish(() => reject(new Error('timeout')));
      }, timeoutMs);

      function finish(fn) {
        if (settled) return;
        settled = true;
        timers.clearTimeout(timer);
        audio.onended = null;
        audio.onerror = null;
        fn();
      }

      cancelCurrent = () => {
        try {
          audio.pause?.();
          audio.src = '';
        } catch {}
        finish(() => resolve(false));
      };

      audio.onended = () => finish(() => resolve(true));
      audio.onerror = () => finish(() => reject(new Error('audio playback error')));

      try {
        const playResult = audio.play?.();
        if (playResult && typeof playResult.catch === 'function') {
          playResult.catch((err) => finish(() => reject(err)));
        }
      } catch (err) {
        finish(() => reject(err));
      }
    });
  }

  async function speak(text, id, options = {}) {
    await stop();
    const current = generation;
    if (!text || !text.trim()) return;

    const useFish = options.provider !== 'system' && options.fishEnabled !== false;
    if (!useFish) {
      if (fallbackPlayer) {
        return fallbackPlayer.speak(text, id, options);
      }
      callbacks.onError('Lecture vocale indisponible. La réponse reste disponible en texte.');
      return;
    }

    const chunks = splitNativeSpeechText(text, 600);
    if (chunks.length === 0) return;

    callbacks.onState(true, id ?? null);

    const requestChunk = (chunkText) =>
      Promise.resolve().then(() =>
        synthesize(chunkText, {
          referenceId: normalizeFishReferenceId(options.fishReferenceId),
          rate: options.rate,
          model: options.fishModel,
        })
      );

    let nextSynthesisPromise = requestChunk(chunks[0]);

    for (let i = 0; i < chunks.length; i++) {
      if (current !== generation) return;
      try {
        const currentAudioPromise = nextSynthesisPromise;
        if (i + 1 < chunks.length) {
          nextSynthesisPromise = requestChunk(chunks[i + 1]);
          // Prevent unhandled rejection if chunk i fails before i + 1 is awaited
          nextSynthesisPromise.catch(() => {});
        }

        const audioSrc = await currentAudioPromise;
        if (current !== generation) return;
        if (!audioSrc) throw new Error('empty fish audio response');

        const audio = createAudio(audioSrc);
        const completed = await playAudioElement(
          audio,
          Math.max(60_000, chunks[i].length * 150)
        );
        if (!completed || current !== generation) return;
      } catch (err) {
        if (current !== generation) return;
        const remainingText = chunks.slice(i).join(' ');
        callbacks.onFallback?.(err);
        if (fallbackPlayer && remainingText.trim()) {
          return fallbackPlayer.speak(remainingText, id, options);
        }
        void stop();
        callbacks.onError(
          'Synthèse Fish Audio indisponible et aucun moteur vocal de secours n’est actif.'
        );
        return;
      }
    }

    if (current === generation) {
      cancelCurrent = () => {};
      callbacks.onState(false, null);
    }
  }

  return { speak, stop };
}

