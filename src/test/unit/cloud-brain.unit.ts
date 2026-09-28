import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  BrainProviderError,
  CloudBrainModel,
  CloudProvider,
} from '../../conversational/cloud-model';

const messages = [
  { role: 'user' as const, text: 'Question privée' },
  { role: 'tool' as const, text: 'Observation privée' },
];
const decision = { action: 'reply', text: 'Réponse utile' };
const signal = () => new AbortController().signal;
const completion = (content = JSON.stringify(decision)) =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }));
const cloud = (provider: CloudProvider, timeoutMs = 1000) =>
  new CloudBrainModel({
    provider,
    apiKey: 'test-secret-key',
    model: provider === 'openrouter' ? 'openrouter/free' : 'configured-model',
    timeoutMs,
  });
suite('Cloud Brain adapters', () => {
  for (const [provider, endpoint] of [
    ['cerebras', 'https://api.cerebras.ai/v1/chat/completions'],
    ['groq', 'https://api.groq.com/openai/v1/chat/completions'],
    ['openrouter', 'https://openrouter.ai/api/v1/chat/completions'],
  ] as const) {
    test(`${provider} sends authenticated structured requests with project and tool observations`, async (t) => {
      t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
        assert.equal(url, endpoint);
        assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer test-secret-key');
        assert.equal(init.redirect, 'error');
        const body = JSON.parse(String(init.body));
        assert.equal(body.stream, false);
        assert.equal(body.response_format.type, 'json_object');
        assert.match(body.messages[0].content, /nexus.*staging/);
        assert.equal(body.messages[2].role, 'user');
        assert.equal(body.messages[2].content, 'Observation privée');
        if (provider === 'openrouter') assert.equal(body.provider.require_parameters, true);
        return completion();
      });
      assert.deepEqual(
        await cloud(provider).decide(
          messages,
          { name: 'nexus', branch: 'staging' },
          true,
          signal()
        ),
        decision
      );
    });
  }

  test('Gemini uses header authentication, native JSON output and ignores thinking parts', async (t) => {
    t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      assert.equal(
        url,
        'https://generativelanguage.googleapis.com/v1beta/models/configured-model:generateContent'
      );
      assert.ok(!url.includes('test-secret-key'));
      assert.equal(new Headers(init.headers).get('x-goog-api-key'), 'test-secret-key');
      const body = JSON.parse(String(init.body));
      assert.equal(body.generationConfig.responseMimeType, 'application/json');
      assert.match(body.systemInstruction.parts[0].text, /Outils autorisés : non/);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: 'STOP',
              content: {
                parts: [{ thought: true, text: 'hidden' }, { text: JSON.stringify(decision) }],
              },
            },
          ],
        })
      );
    });
    assert.deepEqual(await cloud('gemini').decide(messages, undefined, false, signal()), decision);
  });

  test('provider HTTP errors are classified without exposing the response body', async (t) => {
    for (const [status, code, retryable] of [
      [429, 'rate_limited', true],
      [402, 'quota_exhausted', true],
      [503, 'unavailable', true],
      [408, 'timeout', true],
      [401, 'authentication', false],
      [403, 'authentication', false],
      [400, 'configuration', false],
    ] as const) {
      const stub = t.mock.method(
        globalThis,
        'fetch',
        async () => new Response('PRIVATE BODY test-secret-key', { status })
      );
      await assert.rejects(
        cloud('cerebras').decide(messages, undefined, true, signal()),
        (error: unknown) => {
          assert.ok(error instanceof BrainProviderError);
          assert.equal(error.code, code);
          assert.equal(error.retryable, retryable);
          assert.ok(!error.message.includes('PRIVATE'));
          assert.ok(!error.message.includes('test-secret-key'));
          return true;
        }
      );
      stub.mock.restore();
    }
  });

  test('invalid JSON, invalid decisions and unauthorized tool requests cannot reach the tool dispatcher', async (t) => {
    for (const raw of [
      '',
      'not JSON',
      'null',
      '{}',
      '{"action":"shell","text":"rm"}',
      '{"action":"reply","text":42}',
      '{"action":"inspect_project","text":"nexus"}',
    ]) {
      const stub = t.mock.method(globalThis, 'fetch', async () => completion(raw));
      await assert.rejects(
        cloud('groq').decide(messages, undefined, false, signal()),
        (error: unknown) => error instanceof BrainProviderError && error.code === 'invalid_response'
      );
      stub.mock.restore();
    }
  });

  test('truncation is retryable but provider refusals never trigger policy bypass', async (t) => {
    for (const [finish_reason, code] of [
      ['length', 'invalid_response'],
      ['content_filter', 'refused'],
    ] as const) {
      const stub = t.mock.method(
        globalThis,
        'fetch',
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify(decision) }, finish_reason }],
            })
          )
      );
      await assert.rejects(
        cloud('groq').decide(messages, undefined, true, signal()),
        (error: unknown) => error instanceof BrainProviderError && error.code === code
      );
      stub.mock.restore();
    }
    t.mock.method(
      globalThis,
      'fetch',
      async () => new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }))
    );
    await assert.rejects(
      cloud('gemini').decide(messages, undefined, true, signal()),
      (error: unknown) => error instanceof BrainProviderError && !error.retryable
    );
  });

  test('OpenRouter rejects paid model configuration', () => {
    assert.throws(
      () => new CloudBrainModel({ provider: 'openrouter', apiKey: 'test', model: 'vendor/paid' }),
      BrainProviderError
    );
    assert.doesNotThrow(
      () =>
        new CloudBrainModel({ provider: 'openrouter', apiKey: 'test', model: 'vendor/model:free' })
    );
  });

  test('network failures and timeouts are bounded; caller cancellation is preserved', async (t) => {
    const stub = t.mock.method(globalThis, 'fetch', async () => {
      throw new TypeError('network credentials PRIVATE');
    });
    await assert.rejects(
      cloud('groq').decide(messages, undefined, true, signal()),
      (error: unknown) => error instanceof BrainProviderError && error.code === 'network'
    );
    stub.mock.restore();
    t.mock.method(
      globalThis,
      'fetch',
      async (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        })
    );
    // AbortSignal.timeout is unref'ed; keep the test alive until its deadline fires.
    const keepAlive = setInterval(() => {}, 1000);
    try {
      await assert.rejects(
        cloud('groq', 5).decide(messages, undefined, true, signal()),
        (error: unknown) => error instanceof BrainProviderError && error.code === 'timeout'
      );
      const controller = new AbortController();
      const pending = cloud('groq').decide(messages, undefined, true, controller.signal);
      controller.abort(new Error('user cancelled'));
      await assert.rejects(pending, /user cancelled/);
    } finally {
      clearInterval(keepAlive);
    }
  });
});
