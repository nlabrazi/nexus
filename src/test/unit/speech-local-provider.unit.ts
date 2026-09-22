import * as assert from 'node:assert/strict';
import { suite, test, TestContext } from 'node:test';
import { PassThrough } from 'node:stream';
import childProcess = require('node:child_process');
import { LocalSpeechToTextProvider } from '../../speech/local-provider';

const configuration = {
  pythonPath: '/runtime with spaces/venv/bin/python',
  modelPath: '/models/small multilingual',
  scriptPath: '/extension/runtime/speech/transcribe.py',
};
const audio = { data: Buffer.from([0, 255, 10, 128]), fileName: 'voice; ignored.oga' };

function worker(t: TestContext) {
  const stdin = new PassThrough();
  const received: Buffer[] = [];
  const kill = t.mock.fn((_signal: string) => true);
  stdin.on('data', (chunk) => received.push(Buffer.from(chunk)));
  let callback!: (
    error: childProcess.ExecFileException | null,
    stdout: string,
    stderr: string
  ) => void;
  const mock = t.mock.method(
    childProcess,
    'execFile',
    (
      _binary: string,
      _args: string[],
      _options: childProcess.ExecFileOptions,
      cb: typeof callback
    ) => {
      callback = cb;
      return { stdin, kill };
    }
  );
  return {
    mock,
    stdin,
    received,
    kill,
    finish: (stdout: string, error: childProcess.ExecFileException | null = null) =>
      callback(error, stdout, 'private diagnostic'),
  };
}

suite('Local speech worker transport', () => {
  test('sends binary audio over stdin with isolated Python, offline settings and no shell', async (t) => {
    const fake = worker(t);
    const controller = new AbortController();
    const signal = controller.signal;
    const result = new LocalSpeechToTextProvider(configuration).transcribe(audio, {
      signal,
      language: 'fr',
    });
    const [binary, args, options] = fake.mock.mock.calls[0].arguments;
    assert.ok(options);
    assert.equal(binary, configuration.pythonPath);
    assert.deepEqual(args, [
      '-I',
      configuration.scriptPath,
      '--model',
      configuration.modelPath,
      '--language',
      'fr',
    ]);
    assert.equal(options.shell, false);
    assert.equal(options.cwd, '/extension/runtime/speech');
    assert.equal(options.killSignal, 'SIGKILL');
    assert.equal(options.maxBuffer, 1_000_000);
    assert.equal(options.env?.HF_HUB_OFFLINE, '1');
    assert.equal(options.env?.HF_HUB_DISABLE_TELEMETRY, '1');
    assert.deepEqual(Buffer.concat(fake.received), audio.data);
    assert.equal(fake.stdin.writableEnded, true);
    fake.finish(JSON.stringify({ text: 'Crée un fichier été.txt.' }));
    assert.equal(await result, 'Crée un fichier été.txt.');
    controller.abort();
    assert.equal(fake.kill.mock.callCount(), 0);
  });

  test('requires configured absolute paths before attempting execution', (t) => {
    const fake = worker(t);
    for (const key of ['pythonPath', 'modelPath'] as const) {
      assert.throws(() => new LocalSpeechToTextProvider({ ...configuration, [key]: '' }), {
        code: 'not_configured',
      });
    }
    for (const key of ['pythonPath', 'modelPath', 'scriptPath'] as const) {
      for (const value of ['relative/path', '/bad\0path']) {
        assert.throws(() => new LocalSpeechToTextProvider({ ...configuration, [key]: value }), {
          code: 'invalid_configuration',
        });
      }
    }
    assert.equal(fake.mock.mock.callCount(), 0);
  });

  test('rejects malformed output without exposing process output', async (t) => {
    const fake = worker(t);
    const provider = new LocalSpeechToTextProvider(configuration);
    for (const output of [
      'private diagnostic',
      'null',
      '[]',
      '{}',
      '{"text":123}',
      '{"error":"private diagnostic"}',
    ]) {
      const result = provider.transcribe(audio, { signal: new AbortController().signal });
      fake.finish(output);
      await assert.rejects(result, {
        code: 'invalid_response',
        message: 'Le service de transcription a renvoyé une réponse invalide.',
      });
    }
  });

  test('maps worker errors and unavailable executables to safe domain errors', async (t) => {
    const fake = worker(t);
    const provider = new LocalSpeechToTextProvider(configuration);
    for (const code of [
      'not_configured',
      'invalid_audio',
      'audio_too_large',
      'invalid_configuration',
      'unavailable',
      'transcription_failed',
    ]) {
      const result = provider.transcribe(audio, { signal: new AbortController().signal });
      fake.finish(JSON.stringify({ error: code, diagnostic: 'private diagnostic' }));
      await assert.rejects(result, { code });
    }
    for (const [exitCode, expected] of [
      ['ENOENT', 'unavailable'],
      ['EACCES', 'unavailable'],
      ['ERR_CHILD_PROCESS_STDIO_MAXBUFFER', 'invalid_response'],
      [1, 'transcription_failed'],
    ] as const) {
      const result = provider.transcribe(audio, { signal: new AbortController().signal });
      fake.finish(
        '{"text":"must not succeed"}',
        Object.assign(new Error('private diagnostic'), { code: exitCode })
      );
      await assert.rejects(result, (error: Error & { code?: string }) => {
        assert.equal(error.code, expected);
        assert.equal(error.message.includes('private diagnostic'), false);
        return true;
      });
    }
  });

  test('cancellation prevents startup and ignores late success', async (t) => {
    const fake = worker(t);
    const provider = new LocalSpeechToTextProvider(configuration);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(provider.transcribe(audio, { signal: controller.signal }), {
      code: 'cancelled',
    });
    assert.equal(fake.mock.mock.callCount(), 0);
    const active = new AbortController();
    const result = provider.transcribe(audio, { signal: active.signal });
    active.abort();
    assert.deepEqual(
      fake.kill.mock.calls.map((call) => call.arguments),
      [['SIGKILL']]
    );
    fake.finish('{"text":"late response"}');
    await assert.rejects(result, { code: 'cancelled' });
  });

  test('an early closed input pipe does not hide the worker error', async (t) => {
    const fake = worker(t);
    const result = new LocalSpeechToTextProvider(configuration).transcribe(audio, {
      signal: new AbortController().signal,
    });
    fake.stdin.emit('error', new Error('EPIPE'));
    fake.finish('{"error":"unavailable"}');
    await assert.rejects(result, { code: 'unavailable' });
  });
});
