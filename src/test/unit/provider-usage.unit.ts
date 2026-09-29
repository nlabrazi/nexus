import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { CloudBrainModel } from '../../conversational/cloud-model';
import { RoutedBrainModel } from '../../conversational/routed-model';
import { OllamaBrainModel } from '../../conversational/ollama-model';
import {
  durationMs,
  readQuotaHeaders,
  readOpenRouterQuota,
  recordTokenUsage,
  emptyProviderUsage,
} from '../../conversational/provider-usage';

suite('Provider usage and quota snapshots', () => {
  test('Groq windows preserve zero remaining tokens and relative reset durations', () => {
    const result = readQuotaHeaders(
      'groq',
      new Headers({
        'x-ratelimit-limit-tokens': '18000',
        'x-ratelimit-remaining-tokens': '0',
        'x-ratelimit-reset-tokens': '7.66s',
        'x-ratelimit-limit-requests': '14400',
        'x-ratelimit-remaining-requests': '14370',
        'x-ratelimit-reset-requests': '2m59.56s',
      }),
      1000
    );
    assert.deepEqual(
      result.map((m) => [m.label, m.remaining, m.resetsAt]),
      [
        ['Requêtes / jour', 14370, 180560],
        ['Tokens / minute', 0, 8660],
      ]
    );
  });
  test('Cerebras metrics keep each window distinct and reject absent, invalid or negative counters', () => {
    const result = readQuotaHeaders(
      'cerebras',
      new Headers({
        'x-ratelimit-limit-tokens-minute': '60000',
        'x-ratelimit-remaining-tokens-minute': '50',
        'x-ratelimit-reset-tokens-minute': '26.5',
        'x-ratelimit-limit-tokens-day': '1000000',
        'x-ratelimit-remaining-tokens-day': 'oops',
        'x-ratelimit-limit-requests-day': '-1',
      }),
      1000
    );
    assert.equal(result.length, 2);
    assert.equal(result[0].resetsAt, 27500);
    assert.equal(result[1].remaining, undefined);
    assert.deepEqual(readQuotaHeaders('gemini', new Headers()), []);
    assert.equal(durationMs('nonsense'), undefined);
    assert.equal(durationMs('1h2m3.5s'), 3723500);
  });
  test('token counters count only measured responses; Gemini total includes thinking tokens', () => {
    const usage = emptyProviderUsage('gemini', 'test', true);
    recordTokenUsage(usage, {});
    assert.equal(usage.measuredRequests, 0);
    recordTokenUsage(usage, {
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 30 },
    });
    recordTokenUsage(usage, { usageMetadata: { totalTokenCount: -3 } });
    assert.equal(usage.totalTokens, 30);
    assert.equal(usage.measuredRequests, 1);
    assert.equal(usage.inputTokens, 10);
  });
  test('OpenRouter does not confuse unlimited key credit caps with exhausted quotas', () => {
    const now = Date.UTC(2026, 8, 29, 10);
    const result = readOpenRouterQuota(
      {
        limit: null,
        limit_remaining: null,
        label: 'secret',
        free_model_daily_requests: { used: 50, remaining: 0, limit: 50 },
      },
      now
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].remaining, 0);
    assert.equal(result[0].resetsAt, Date.UTC(2026, 8, 30));
    assert.ok(!JSON.stringify(result).includes('secret'));
  });
  test('cloud replies expose usage and effective model without exposing payloads or keys', async (t) => {
    t.mock.method(
      globalThis,
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            model: 'vendor/effective:free',
            usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
            choices: [{ message: { content: '{"action":"reply","text":"private reply"}' } }],
          }),
          { headers: { 'x-ratelimit-limit-tokens': '500', 'x-ratelimit-remaining-tokens': '380' } }
        )
    );
    const model = new CloudBrainModel({
      provider: 'groq',
      apiKey: 'private-key',
      model: 'configured',
    });
    await model.decide(
      [{ role: 'user', text: 'private prompt' }],
      undefined,
      true,
      new AbortController().signal
    );
    const usage = model.getUsage();
    assert.equal(usage.requests, 1);
    assert.equal(usage.totalTokens, 120);
    assert.equal(usage.actualModel, 'vendor/effective:free');
    assert.equal(usage.lastStatus, 'success');
    for (const secret of ['private prompt', 'private reply', 'private-key'])
      assert.ok(!JSON.stringify(usage).includes(secret));
    usage.requests = 999;
    assert.equal(model.getUsage().requests, 1);
  });
  test('OpenRouter quota refresh coalesces concurrent requests and caches for one minute', async (t) => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      calls++;
      assert.equal(url, 'https://openrouter.ai/api/v1/key');
      assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer private-key');
      return new Response(
        JSON.stringify({ data: { limit: 10, limit_remaining: 0, hash: 'private-hash' } })
      );
    });
    const model = new CloudBrainModel({
      provider: 'openrouter',
      apiKey: 'private-key',
      model: 'openrouter/free',
    });
    await Promise.all([model.refreshQuota(), model.refreshQuota()]);
    await model.refreshQuota();
    assert.equal(calls, 1);
    assert.equal(model.getUsage().limits[0].remaining, 0);
    assert.ok(!JSON.stringify(model.getUsage()).includes('private-hash'));
  });
  test('quota refresh failures preserve earlier readings with their original timestamp', async (t) => {
    let now = 1000,
      calls = 0;
    t.mock.method(Date, 'now', () => now);
    t.mock.method(globalThis, 'fetch', async () =>
      ++calls === 1
        ? new Response(JSON.stringify({ data: { limit: 10, limit_remaining: 5 } }))
        : new Response('private error', { status: 401 })
    );
    const model = new CloudBrainModel({
      provider: 'openrouter',
      apiKey: 'key',
      model: 'openrouter/free',
    });
    await model.refreshQuota();
    now += 61000;
    await model.refreshQuota();
    assert.equal(model.getUsage().quotaStatus, 'unavailable');
    assert.equal(model.getUsage().limits[0].observedAt, 1000);
  });
  test('Brain dashboard distinguishes automatic selection, active provider and last successful model after fallback', async (t) => {
    let release!: (value: Response) => void;
    t.mock.method(globalThis, 'fetch', async (url: string) =>
      url.includes('cerebras')
        ? new Response('', { status: 429 })
        : new Promise<Response>((resolve) => {
            release = resolve;
          })
    );
    const brain = new RoutedBrainModel({
      env: { CEREBRAS_API_KEY: 'test', GROQ_API_KEY: 'test' },
      ollama: new OllamaBrainModel({ model: 'local' }),
    });
    const pending = brain.decide(
      [{ role: 'user', text: 'private' }],
      undefined,
      true,
      new AbortController().signal
    );
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await brain.getDashboard()).active?.provider, 'groq');
    release(
      new Response(
        JSON.stringify({
          model: 'actual-model',
          choices: [{ message: { content: '{"action":"reply","text":"ok"}' } }],
        })
      )
    );
    await pending;
    const snapshot = await brain.getDashboard();
    assert.equal(snapshot.selection, 'auto');
    assert.equal(snapshot.active, undefined);
    assert.equal(snapshot.lastUsed?.model, 'actual-model');
    assert.equal(snapshot.providers.find((p) => p.provider === 'gemini')?.configured, false);
    assert.equal(
      snapshot.providers.find((p) => p.provider === 'cerebras')?.lastStatus,
      'rate_limited'
    );
  });
});
