import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { TELEGRAM_VOICE_MAX_BYTES, TelegramClient, TelegramVoiceDownloadError } from '../../telegram/client';
import { TelegramVoice } from '../../telegram/types';
import { flush } from './helpers';

const voice: TelegramVoice = { file_id: 'voice-id', file_unique_id: 'unique-id', duration: 5, mime_type: 'audio/ogg' };
const fileResponse = (fields: Record<string, unknown> = {}) => new Response(JSON.stringify({
  ok: true, result: { file_id: 'voice-id', file_unique_id: 'unique-id', file_path: 'voice/file_12.oga', ...fields },
}));
const hasCode = (code: TelegramVoiceDownloadError['code']) => (error: unknown) => {
  assert.ok(error instanceof TelegramVoiceDownloadError);
  assert.equal(error.code, code);
  assert.equal(error.message.includes('SECRET'), false);
  return true;
};

suite('Telegram voice download HTTP API', () => {
  test('resolves file_id, downloads the exact bytes, and retains the original MIME type', async t => {
    const calls: { url: string; init: RequestInit }[] = [];
    t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return calls.length === 1 ? fileResponse({ file_size: 4 }) : new Response(new Uint8Array([0, 255, 1, 2]), {
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '4' },
      });
    });
    const result = await new TelegramClient('SECRET').downloadVoice({ ...voice, file_size: 4 });
    assert.deepEqual([...result.data], [0, 255, 1, 2]);
    assert.equal(result.fileName, 'file_12.oga');
    assert.equal(result.mimeType, 'audio/ogg');
    assert.equal(calls[0].url, 'https://api.telegram.org/botSECRET/getFile');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { file_id: 'voice-id' });
    assert.equal(calls[1].url, 'https://api.telegram.org/file/botSECRET/voice/file_12.oga');
    assert.equal(calls[1].init.redirect, 'error');
  });

  test('accepts a streamed file at the size limit without optional metadata or Content-Length', async t => {
    t.mock.method(globalThis, 'fetch', async (url: string) => url.endsWith('/getFile') ? fileResponse() :
      new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(TELEGRAM_VOICE_MAX_BYTES / 2).fill(1));
          controller.enqueue(new Uint8Array(TELEGRAM_VOICE_MAX_BYTES / 2).fill(2));
          controller.close();
        },
      })));
    const result = await new TelegramClient('SECRET').downloadVoice({ ...voice, mime_type: undefined });
    assert.equal(result.data.length, TELEGRAM_VOICE_MAX_BYTES);
    assert.equal(result.data[0], 1);
    assert.equal(result.data.at(-1), 2);
    assert.equal(result.mimeType, undefined);
  });

  test('rejects an oversized voice before making any HTTP request', async t => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => fileResponse());
    await assert.rejects(new TelegramClient('SECRET').downloadVoice({ ...voice, file_size: TELEGRAM_VOICE_MAX_BYTES + 1 }), hasCode('too_large'));
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  test('checks getFile size before downloading the body', async t => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => fileResponse({ file_size: TELEGRAM_VOICE_MAX_BYTES + 1 }));
    await assert.rejects(new TelegramClient('SECRET').downloadVoice(voice), hasCode('too_large'));
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  test('cancels the response stream when Content-Length exceeds the limit', async t => {
    const cancelled = t.mock.fn();
    t.mock.method(globalThis, 'fetch', async (url: string) => url.endsWith('/getFile') ? fileResponse() :
      new Response(new ReadableStream<Uint8Array>({ cancel: cancelled }), {
        headers: { 'Content-Length': String(TELEGRAM_VOICE_MAX_BYTES + 1) },
      }));
    await assert.rejects(new TelegramClient('SECRET').downloadVoice(voice), hasCode('too_large'));
    assert.equal(cancelled.mock.callCount(), 1);
  });

  test('enforces the byte limit while streaming even when all declared sizes are smaller', async t => {
    const cancelled = t.mock.fn();
    t.mock.method(globalThis, 'fetch', async (url: string) => url.endsWith('/getFile') ? fileResponse({ file_size: 1 }) :
      new Response(new ReadableStream<Uint8Array>({
        pull(controller) { controller.enqueue(new Uint8Array(TELEGRAM_VOICE_MAX_BYTES / 2 + 1)); },
        cancel: cancelled,
      }), { headers: { 'Content-Length': '1' } }));
    await assert.rejects(new TelegramClient('SECRET').downloadVoice({ ...voice, file_size: 1 }), hasCode('too_large'));
    assert.equal(cancelled.mock.callCount(), 1);
  });

  for (const path of [undefined, '', '../secret', '/absolute', 'voice/../secret', 'https://example.com/SECRET', 'voice/%2e%2e/file']) {
    test(`rejects an unavailable or unsafe file path: ${String(path)}`, async t => {
      const fetchMock = t.mock.method(globalThis, 'fetch', async () => fileResponse({ file_path: path }));
      await assert.rejects(new TelegramClient('SECRET').downloadVoice(voice), hasCode('invalid_file'));
      assert.equal(fetchMock.mock.callCount(), 1);
    });
  }

  for (const failure of ['api-error', 'http-error', 'invalid-json', 'network-error', 'file-http-error', 'empty-file', 'stream-error'] as const) {
    test(`reports ${failure} without exposing the bot token`, async t => {
      t.mock.method(globalThis, 'fetch', async (url: string) => {
        if (failure === 'network-error') { throw new Error(`Failed to fetch ${url}`); }
        if (url.endsWith('/getFile')) {
          if (failure === 'api-error') { return new Response(JSON.stringify({ ok: false, description: 'SECRET' })); }
          if (failure === 'http-error') { return new Response('SECRET', { status: 503 }); }
          if (failure === 'invalid-json') { return new Response('SECRET'); }
          return fileResponse();
        }
        if (failure === 'file-http-error') { return new Response('SECRET', { status: 404 }); }
        if (failure === 'stream-error') {
          return new Response(new ReadableStream({ start(controller) { controller.error(new Error(`Failed to read ${url}`)); } }));
        }
        return new Response('');
      });
      await assert.rejects(new TelegramClient('SECRET').downloadVoice(voice), hasCode(failure === 'empty-file' ? 'invalid_file' : 'download_failed'));
    });
  }

  test('a pre-cancelled operation makes no HTTP request', async t => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => fileResponse());
    await assert.rejects(new TelegramClient('SECRET').downloadVoice(voice, AbortSignal.abort()), hasCode('cancelled'));
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  for (const phase of ['metadata', 'body'] as const) {
    for (const reason of ['cancel', 'timeout'] as const) {
      test(`${reason} interrupts ${phase} retrieval`, async t => {
        const caller = new AbortController();
        const timeout = new AbortController();
        t.mock.method(AbortSignal, 'timeout', (ms: number) => {
          assert.ok(ms === 30_000 || ms === 15_000);
          return ms === 30_000 ? timeout.signal : new AbortController().signal;
        });
        t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
          const signal = init.signal!;
          if (url.endsWith('/getFile')) {
            if (phase === 'body') { return fileResponse(); }
            return new Promise<Response>((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            });
          }
          return new Response(new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([1]));
              signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
            },
          }));
        });
        const download = new TelegramClient('SECRET').downloadVoice(voice, caller.signal);
        const rejected = assert.rejects(download, hasCode(reason === 'timeout' ? 'timeout' : 'cancelled'));
        await flush();
        if (reason === 'cancel') { caller.abort(); }
        else { timeout.abort(new DOMException('Timed out', 'TimeoutError')); }
        await rejected;
      });
    }
  }
});
