import * as assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { suite, test, TestContext } from 'node:test';
import childProcess = require('node:child_process');
import { synthesizeAcknowledgement } from '../../speech/acknowledgement';
import { SpeechSynthesisError } from '../../speech/synthesis-error';
import { isPcmWave, isOggOpus } from '../../speech/audio-validation';
import { flush } from './helpers';

function waveAudio(): Buffer {
  const audio = Buffer.alloc(48);
  audio.write('RIFF');
  audio.writeUInt32LE(40, 4);
  audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(22050, 24);
  audio.writeUInt32LE(44100, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write('data', 36);
  audio.writeUInt32LE(4, 40);
  return audio;
}
function opusAudio(): Buffer {
  const header = Buffer.alloc(47);
  header.write('OggS');
  header[5] = 2;
  header[26] = 1;
  header[27] = 19;
  header.write('OpusHead', 28);
  const page = Buffer.alloc(29);
  page.write('OggS');
  page[5] = 4;
  page.writeBigUInt64LE(480n, 6);
  page[26] = 1;
  page[27] = 1;
  return Buffer.concat([header, page]);
}

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
    const wave = waveAudio();
    started[0].finish(null, wave);
    await flush();
    assert.equal(started[1].binary, 'ffmpeg');
    assert.ok(started[1].args.includes('libopus'));
    assert.deepEqual(Buffer.concat(started[1].input), wave);
    started[1].finish(null, opusAudio());
    assert.deepEqual(await result, opusAudio());
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
    await assert.rejects(result, SpeechSynthesisError);
    assert.equal(started.length, 1);
  });
});

test('rejects empty, truncated and unsupported audio instead of delivering it', async (t) => {
  assert.equal(isPcmWave(waveAudio()), true);
  assert.equal(isOggOpus(opusAudio()), true);
  for (const audio of [Buffer.alloc(0), Buffer.from('RIFF fake'), waveAudio().subarray(0, 45)])
    assert.equal(isPcmWave(audio), false);
  for (const audio of [Buffer.from('OggS fake'), opusAudio().subarray(0, 50)])
    assert.equal(isOggOpus(audio), false);
  const started = processes(t);
  const result = synthesizeAcknowledgement(new AbortController().signal, configuration);
  started[0].finish(null, Buffer.from('not a wave'));
  await assert.rejects(result, { code: 'invalid_audio' });
  assert.equal(started.length, 1);
});

test('a hung worker is killed within the configured total timeout', async (t) => {
  const started = processes(t);
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const result = synthesizeAcknowledgement(new AbortController().signal, {
      ...configuration,
      timeoutMs: 10,
    });
    await assert.rejects(result, { code: 'timeout' });
    assert.deepEqual(started[0].killed, ['SIGKILL']);
    started[0].finish(null, waveAudio());
    await flush();
    assert.equal(started.length, 1);
  } finally {
    clearTimeout(keepAlive);
  }
});

test('cancellation during encoding kills FFmpeg and clears the intermediate WAV', async (t) => {
  const started = processes(t);
  const controller = new AbortController();
  const result = synthesizeAcknowledgement(controller.signal, configuration);
  const wave = waveAudio();
  started[0].finish(null, wave);
  await flush();
  controller.abort();
  await assert.rejects(result, { code: 'cancelled' });
  assert.deepEqual(started[1].killed, ['SIGKILL']);
  assert.ok(wave.every((byte) => byte === 0));
});

test('invalid or failed FFmpeg output never reaches Telegram', async (t) => {
  const started = processes(t);
  for (const invalid of [Buffer.alloc(0), Buffer.from('OggS unsupported audio')]) {
    const offset = started.length;
    const result = synthesizeAcknowledgement(new AbortController().signal, configuration);
    started[offset].finish(null, waveAudio());
    await flush();
    started[offset + 1].finish(null, invalid);
    await assert.rejects(result, { code: 'invalid_audio' });
  }
  const offset = started.length;
  const result = synthesizeAcknowledgement(new AbortController().signal, configuration);
  started[offset].finish(new Error('private process details'), Buffer.alloc(0));
  await assert.rejects(result, { code: 'process_failed' });
});
