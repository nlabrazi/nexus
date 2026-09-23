import * as assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { suite, test, TestContext } from 'node:test';
import childProcess = require('node:child_process');
import { synthesizeAcknowledgement } from '../../speech/acknowledgement';
import { flush } from './helpers';

const configuration = {
  pythonPath: '/runtime with spaces/piper/bin/python',
  modelPath: '/voices/fr_FR-upmc-medium.onnx',
  scriptPath: '/extension/runtime/speech/synthesize.py',
  speakerId: 0,
};

function processes(t: TestContext) {
  const started: {
    binary: string;
    args: string[];
    options: childProcess.ExecFileOptions;
    input: Buffer[];
    killed: string[];
    finish: (error: Error | null, audio: Buffer) => void;
  }[] = [];
  t.mock.method(
    childProcess,
    'execFile',
    (
      binary: string,
      args: string[],
      options: childProcess.ExecFileOptions,
      finish: (error: Error | null, audio: Buffer) => void
    ) => {
      const stdin = new PassThrough();
      const input: Buffer[] = [];
      const killed: string[] = [];
      stdin.on('data', (data: Buffer) => input.push(Buffer.from(data)));
      started.push({ binary, args, options, input, killed, finish });
      return {
        stdin,
        kill: (signal: string) => {
          killed.push(signal);
          return true;
        },
      };
    }
  );
  return started;
}

suite('Piper acknowledgement transport', () => {
  test('uses the configured Python, model and Jessica speaker, then converts WAV to Opus', async (t) => {
    const started = processes(t);
    const result = synthesizeAcknowledgement(new AbortController().signal, configuration);
    assert.equal(started[0].binary, configuration.pythonPath);
    assert.deepEqual(started[0].args, [
      '-I',
      configuration.scriptPath,
      '--model',
      configuration.modelPath,
      '--speaker',
      '0',
    ]);
    assert.equal(started[0].options.shell, false);
    assert.equal(
      Buffer.concat(started[0].input).toString('utf8'),
      'Bien compris. Je prends en charge votre demande.'
    );
    const wave = Buffer.from('RIFF synthesized audio');
    started[0].finish(null, wave);
    await flush();
    assert.equal(started[1].binary, 'ffmpeg');
    assert.ok(started[1].args.includes('libopus'));
    assert.deepEqual(Buffer.concat(started[1].input), wave);
    started[1].finish(null, Buffer.from('OggS encoded voice'));
    assert.equal((await result).toString(), 'OggS encoded voice');
    assert.ok(wave.every((byte) => byte === 0));
  });

  test('rejects invalid local paths and speaker before starting any process', async (t) => {
    const started = processes(t);
    for (const override of [
      { pythonPath: '' },
      { modelPath: 'relative.onnx' },
      { scriptPath: '/bad\0path' },
      { speakerId: -1 },
      { speakerId: 0.5 },
    ]) {
      await assert.rejects(
        synthesizeAcknowledgement(new AbortController().signal, { ...configuration, ...override }),
        /Configure nexus.speech.tts/
      );
    }
    assert.equal(started.length, 0);
  });

  test('stop kills the Piper worker and suppresses conversion after a late result', async (t) => {
    const started = processes(t);
    const controller = new AbortController();
    const result = synthesizeAcknowledgement(controller.signal, configuration);
    controller.abort();
    await assert.rejects(result, /cancelled/);
    assert.deepEqual(started[0].killed, ['SIGKILL']);
    started[0].finish(null, Buffer.from('RIFF late audio'));
    await flush();
    assert.equal(started.length, 1);
  });

  test('an unavailable Piper produces a safe error for the text fallback', async (t) => {
    const started = processes(t);
    const result = synthesizeAcknowledgement(new AbortController().signal, configuration);
    started[0].finish(new Error('private process details'), Buffer.alloc(0));
    await assert.rejects(result, { message: 'Speech synthesis unavailable' });
    assert.equal(started.length, 1);
  });
});
