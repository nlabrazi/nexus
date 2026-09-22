import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { SpeechError, SpeechErrorCode } from '../../speech/errors';
import { SPEECH_MAX_AUDIO_BYTES, SpeechToTextService } from '../../speech/service';
import { SpeechAudio, SpeechToTextProvider } from '../../speech/types';
import { deferred, flush } from './helpers';

const audio = (): SpeechAudio => ({
  data: Buffer.from('audio'),
  fileName: 'voice.oga',
  mimeType: 'audio/ogg',
});
const hasCode = (code: SpeechErrorCode) => (error: unknown) =>
  error instanceof SpeechError && error.code === code;

suite('Speech-to-text service', () => {
  test('forwards the original audio and requested language and preserves transcript contents', async (t) => {
    const transcribe = t.mock.fn<SpeechToTextProvider['transcribe']>(
      async () => '  Modifie src/app.ts.\nConserve /new comme texte.  '
    );
    const input = audio();
    const service = new SpeechToTextService({ transcribe });
    assert.equal(
      await service.transcribe(input, { language: 'fr' }),
      'Modifie src/app.ts.\nConserve /new comme texte.'
    );
    assert.equal(transcribe.mock.calls[0].arguments[0], input);
    assert.equal(transcribe.mock.calls[0].arguments[1].language, 'fr');
    assert.equal(transcribe.mock.calls[0].arguments[1].signal.aborted, false);
    assert.equal(Buffer.from(input.data).toString(), 'audio');
  });

  test('rejects empty and oversized audio before calling the provider', async (t) => {
    const transcribe = t.mock.fn(async () => 'Unexpected');
    const service = new SpeechToTextService({ transcribe });
    await assert.rejects(
      service.transcribe({ ...audio(), data: new Uint8Array() }),
      hasCode('invalid_audio')
    );
    await assert.rejects(
      service.transcribe({ ...audio(), fileName: ' ' }),
      hasCode('invalid_audio')
    );
    await assert.rejects(
      service.transcribe({ ...audio(), data: new Uint8Array(SPEECH_MAX_AUDIO_BYTES + 1) }),
      hasCode('audio_too_large')
    );
    assert.equal(transcribe.mock.callCount(), 0);
  });

  test('rejects invalid configuration before invoking a provider', async (t) => {
    const transcribe = t.mock.fn(async () => 'Unexpected');
    for (const timeout of [0, -1, NaN, Infinity, 2 ** 31]) {
      assert.throws(
        () => new SpeechToTextService({ transcribe }, timeout),
        hasCode('invalid_configuration')
      );
    }
    await assert.rejects(
      new SpeechToTextService({ transcribe }).transcribe(audio(), { language: 'French' }),
      hasCode('invalid_configuration')
    );
    assert.equal(transcribe.mock.callCount(), 0);
  });

  test('rejects empty and malformed provider responses', async () => {
    await assert.rejects(
      new SpeechToTextService({ transcribe: async () => ' \n ' }).transcribe(audio()),
      hasCode('empty_transcript')
    );
    const malformed = {
      transcribe: async () => ({ text: 'wrong contract' }),
    } as unknown as SpeechToTextProvider;
    await assert.rejects(
      new SpeechToTextService(malformed).transcribe(audio()),
      hasCode('invalid_response')
    );
  });

  test('a pre-cancelled request never calls the provider', async (t) => {
    const transcribe = t.mock.fn(async () => 'Unexpected');
    await assert.rejects(
      new SpeechToTextService({ transcribe }).transcribe(audio(), { signal: AbortSignal.abort() }),
      hasCode('cancelled')
    );
    assert.equal(transcribe.mock.callCount(), 0);
  });

  test('cancellation is forwarded and returns promptly even if the provider ignores it', async (t) => {
    const pending = deferred<string>();
    const transcribe = t.mock.fn<SpeechToTextProvider['transcribe']>(() => pending.promise);
    const caller = new AbortController();
    const result = new SpeechToTextService({ transcribe }).transcribe(audio(), {
      signal: caller.signal,
    });
    const rejected = assert.rejects(result, hasCode('cancelled'));
    await flush();
    caller.abort();
    await rejected;
    assert.equal(transcribe.mock.calls[0].arguments[1].signal.aborted, true);
    pending.reject(new Error('Late failure'));
    await flush();
  });

  test('a deadline aborts the provider and rejects without waiting for its response', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = deferred<string>();
    const transcribe = t.mock.fn<SpeechToTextProvider['transcribe']>(() => pending.promise);
    const result = new SpeechToTextService({ transcribe }, 5000).transcribe(audio());
    const rejected = assert.rejects(result, hasCode('timeout'));
    await flush();
    t.mock.timers.tick(5000);
    await rejected;
    assert.equal(transcribe.mock.calls[0].arguments[1].signal.aborted, true);
    pending.resolve('Late transcript');
    await flush();
  });

  test('provider errors remain safe and a failed request does not prevent a retry', async (t) => {
    const transcribe = t.mock.fn<SpeechToTextProvider['transcribe']>(async () => {
      throw new Error('SECRET credential and private transcript');
    });
    const service = new SpeechToTextService({ transcribe });
    await assert.rejects(service.transcribe(audio()), (error) => {
      assert.ok(error instanceof SpeechError);
      assert.equal(error.code, 'transcription_failed');
      assert.equal(error.message.includes('SECRET'), false);
      assert.equal(error.cause, undefined);
      return true;
    });
    transcribe.mock.mockImplementation(async () => 'Réessai réussi');
    assert.equal(await service.transcribe(audio()), 'Réessai réussi');
  });

  test('keeps a classified provider failure and handles synchronous cancellation safely', async () => {
    await assert.rejects(
      new SpeechToTextService({
        transcribe: async () => {
          throw new SpeechError('unavailable');
        },
      }).transcribe(audio()),
      hasCode('unavailable')
    );
    const caller = new AbortController();
    const service = new SpeechToTextService({
      transcribe: () => {
        caller.abort();
        throw new Error('SECRET');
      },
    });
    await assert.rejects(
      service.transcribe(audio(), { signal: caller.signal }),
      hasCode('cancelled')
    );
    await flush();
  });
});
