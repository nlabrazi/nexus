import * as assert from 'node:assert/strict';
import { after, before, suite, test } from 'node:test';
import { NexusCore } from '../../core/nexus-core';
import { SpeechToTextService } from '../../speech/service';
import { SpeechAudio, SpeechToTextProvider, TranscriptionOptions } from '../../speech/types';

suite('Nexus Core Voice Endpoints & Push-to-Talk Transcription', () => {
  const validToken = 'test-token-voice-123';

  suite('When speechService is not configured', () => {
    let core: NexusCore;
    let baseUrl: string;

    before(async () => {
      core = new NexusCore({
        port: 0,
        host: '127.0.0.1',
        authTokens: [validToken],
      });
      await core.start();
      const addr = core.getServer()?.address();
      assert.ok(addr && typeof addr === 'object');
      baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    after(async () => {
      await core.stop();
    });

    test('GET /api/voice/status returns available: false', async () => {
      const res = await fetch(`${baseUrl}/api/voice/status`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('access-control-allow-origin'), '*');
      const data = (await res.json()) as { available: boolean };
      assert.equal(data.available, false);
    });

    test('POST /api/voice/transcribe returns 501 SPEECH_NOT_CONFIGURED', async () => {
      const res = await fetch(`${baseUrl}/api/voice/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64: Buffer.from('fake-audio').toString('base64') }),
      });
      assert.equal(res.status, 501);
      assert.equal(res.headers.get('access-control-allow-origin'), '*');
      const data = (await res.json()) as { code: string; error: string };
      assert.equal(data.code, 'SPEECH_NOT_CONFIGURED');
    });
  });

  suite('When speechService is configured with mock provider', () => {
    let core: NexusCore;
    let baseUrl: string;
    let receivedAudios: SpeechAudio[] = [];

    const mockProvider: SpeechToTextProvider = {
      transcribe: async (audio: SpeechAudio, options: TranscriptionOptions) => {
        receivedAudios.push(audio);
        if (options.signal.aborted) {
          throw new Error('cancelled');
        }
        return 'Bonjour Nexus quel est le statut du projet';
      },
    };

    before(async () => {
      receivedAudios = [];
      const speechService = new SpeechToTextService(mockProvider, 5000);
      core = new NexusCore({
        port: 0,
        host: '127.0.0.1',
        authTokens: [validToken],
        speechService,
        speechLanguage: 'fr',
      });
      await core.start();
      const addr = core.getServer()?.address();
      assert.ok(addr && typeof addr === 'object');
      baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    after(async () => {
      await core.stop();
    });

    test('GET /api/voice/status returns available: true and configured language', async () => {
      const res = await fetch(`${baseUrl}/api/voice/status`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('access-control-allow-origin'), '*');
      const data = (await res.json()) as { available: boolean; engine?: string; language?: string };
      assert.equal(data.available, true);
      assert.equal(data.engine, 'faster-whisper');
      assert.equal(data.language, 'fr');
    });

    test('POST /api/voice/transcribe transcribes JSON audioBase64 payload', async () => {
      const audioBytes = Buffer.from('RIFF-MOCK-WAV-DATA-CONTENT');
      const res = await fetch(`${baseUrl}/api/voice/transcribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${validToken}`,
        },
        body: JSON.stringify({
          audioBase64: audioBytes.toString('base64'),
          fileName: 'test.wav',
          mimeType: 'audio/wav',
        }),
      });

      assert.equal(res.status, 200);
      assert.equal(res.headers.get('access-control-allow-origin'), '*');
      const data = (await res.json()) as { text: string };
      assert.equal(data.text, 'Bonjour Nexus quel est le statut du projet');
      assert.equal(receivedAudios.length, 1);
      assert.equal(receivedAudios[0].fileName, 'test.wav');
      assert.equal(receivedAudios[0].mimeType, 'audio/wav');
    });

    test('POST /api/voice/transcribe transcribes binary audio stream', async () => {
      const binaryAudio = Buffer.from('WEBM-BINARY-AUDIO-STREAM');
      const res = await fetch(`${baseUrl}/api/voice/transcribe?language=fr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'audio/webm',
          Authorization: `Bearer ${validToken}`,
        },
        body: binaryAudio,
      });

      assert.equal(res.status, 200);
      assert.equal(res.headers.get('access-control-allow-origin'), '*');
      const data = (await res.json()) as { text: string };
      assert.equal(data.text, 'Bonjour Nexus quel est le statut du projet');
      assert.equal(receivedAudios.length, 2);
      assert.equal(receivedAudios[1].fileName, 'recording.webm');
      assert.equal(receivedAudios[1].mimeType, 'audio/webm');
    });

    test('POST /api/voice/transcribe rejects empty audio', async () => {
      const res = await fetch(`${baseUrl}/api/voice/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'audio/webm' },
        body: Buffer.alloc(0),
      });

      assert.equal(res.status, 400);
      const data = (await res.json()) as { code: string };
      assert.equal(data.code, 'EMPTY_AUDIO');
    });

    test('POST /api/voice/transcribe rejects missing audioBase64 in JSON', async () => {
      const res = await fetch(`${baseUrl}/api/voice/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: 'empty.wav' }),
      });

      assert.equal(res.status, 400);
      const data = (await res.json()) as { code: string };
      assert.equal(data.code, 'INVALID_AUDIO');
    });
  });
});
