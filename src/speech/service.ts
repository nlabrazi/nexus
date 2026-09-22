import { SpeechError } from './errors';
import { SpeechAudio, SpeechToTextProvider } from './types';

export const SPEECH_MAX_AUDIO_BYTES = 20_000_000;
const DEFAULT_TIMEOUT_MS = 120_000;

export class SpeechToTextService {
  constructor(
    private readonly provider: SpeechToTextProvider,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
      throw new SpeechError('invalid_configuration');
    }
  }

  async transcribe(
    audio: SpeechAudio,
    options: { signal?: AbortSignal; language?: string } = {}
  ): Promise<string> {
    if (options.signal?.aborted) {
      throw new SpeechError('cancelled');
    }
    if (
      !(audio.data instanceof Uint8Array) ||
      audio.data.byteLength === 0 ||
      !audio.fileName?.trim()
    ) {
      throw new SpeechError('invalid_audio');
    }
    if (audio.data.byteLength > SPEECH_MAX_AUDIO_BYTES) {
      throw new SpeechError('audio_too_large');
    }
    if (options.language !== undefined && !/^[a-z]{2,3}$/.test(options.language)) {
      throw new SpeechError('invalid_configuration');
    }

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.timeoutMs);
    const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), timeout.signal]);
    let onAbort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new SpeechError(timeout.signal.aborted ? 'timeout' : 'cancelled'));
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => {
          signal.throwIfAborted();
          return this.provider.transcribe(audio, { signal, language: options.language });
        }),
        cancelled,
      ]);
      if (signal.aborted) {
        throw new SpeechError(timeout.signal.aborted ? 'timeout' : 'cancelled');
      }
      if (typeof result !== 'string') {
        throw new SpeechError('invalid_response');
      }
      const text = result.trim();
      if (!text) {
        throw new SpeechError('empty_transcript');
      }
      return text;
    } catch (error) {
      if (signal.aborted) {
        throw new SpeechError(timeout.signal.aborted ? 'timeout' : 'cancelled');
      }
      if (error instanceof SpeechError) {
        throw error;
      }
      // Provider errors can include credentials, request URLs or audio content.
      throw new SpeechError('transcription_failed');
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }
}
