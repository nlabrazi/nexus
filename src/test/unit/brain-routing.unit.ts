import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { BrainProviderError } from '../../conversational/cloud-model';
import { OllamaBrainModel } from '../../conversational/ollama-model';
import { RoutedBrainModel } from '../../conversational/routed-model';
import { LogRecord, logger } from '../../logging/logger';

const messages = [
  { role: 'user' as const, text: 'Question privée' },
  { role: 'tool' as const, text: 'Observation privée' },
];
const decision = { action: 'reply', text: 'Réponse utile' };
const signal = () => new AbortController().signal;
const completion = (content = JSON.stringify(decision)) =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }));
const local = () => new OllamaBrainModel({ host: 'http://ollama.test:11434', model: 'local-test' });
const allKeys = {
  CEREBRAS_API_KEY: 'cerebras-test',
  GROQ_API_KEY: 'groq-test',
  GEMINI_API_KEY: 'gemini-test',
  OPENROUTER_API_KEY: 'router-test',
};

suite('Brain provider routing', () => {
  test('without keys auto uses only Ollama; no secret or fictitious cloud model appears in the menu', async (t) => {
    const urls: string[] = [];
    t.mock.method(globalThis, 'fetch', async (url: string) => {
      urls.push(url);
      return url.endsWith('/api/tags')
        ? new Response(JSON.stringify({ models: [{ name: 'other-local' }] }))
        : new Response(JSON.stringify({ message: { content: JSON.stringify(decision) } }));
    });
    const brain = new RoutedBrainModel({ env: {}, ollama: local() });
    const menu = await brain.listModels();
    assert.deepEqual(
      menu.models.map((m) => m.model),
      ['auto', 'ollama:local-test', 'ollama:other-local']
    );
    assert.deepEqual(await brain.decide(messages, undefined, true, signal()), decision);
    assert.ok(urls.every((url) => url.startsWith('http://ollama.test:11434/')));
    brain.setModel('ollama:other-local');
    assert.deepEqual(brain.getStatus(), { provider: 'ollama', model: 'other-local' });
    assert.throws(() => brain.setModel('gemini:unconfigured'), BrainProviderError);
  });

  test('auto fails over in order Cerebras → Groq → Gemini → OpenRouter → Ollama and logs metadata only', async (t) => {
    const hosts: string[] = [],
      records: LogRecord[] = [];
    const detach = logger.addSink((record) => records.push(record));
    t.after(detach);
    t.mock.method(globalThis, 'fetch', async (url: string) => {
      hosts.push(new URL(url).hostname);
      if (hosts.length < 5)
        return new Response('PRIVATE PROMPT', { status: hosts.length === 1 ? 429 : 503 });
      return new Response(JSON.stringify({ message: { content: JSON.stringify(decision) } }));
    });
    const brain = new RoutedBrainModel({ env: allKeys, ollama: local() });
    assert.deepEqual(await brain.decide(messages, undefined, true, signal()), decision);
    assert.deepEqual(hosts, [
      'api.cerebras.ai',
      'api.groq.com',
      'generativelanguage.googleapis.com',
      'openrouter.ai',
      'ollama.test',
    ]);
    assert.deepEqual(
      records.filter((r) => r.operation === 'fallback').map((r) => r.provider),
      ['groq', 'gemini', 'openrouter', 'ollama']
    );
    assert.ok(records.some((r) => r.status === 'rate_limited'));
    const serialized = JSON.stringify(records);
    for (const privateText of [
      'Question privée',
      'Observation privée',
      'PRIVATE PROMPT',
      ...Object.values(allKeys),
    ])
      assert.ok(!serialized.includes(privateText));
  });

  test('skips unconfigured providers and stops after the first successful response', async (t) => {
    const hosts: string[] = [];
    t.mock.method(globalThis, 'fetch', async (url: string) => {
      hosts.push(new URL(url).hostname);
      return completion();
    });
    const brain = new RoutedBrainModel({ env: { GROQ_API_KEY: 'test' }, ollama: local() });
    await brain.decide(messages, undefined, true, signal());
    assert.deepEqual(hosts, ['api.groq.com']);
  });

  test('explicit local selection never sends content to configured cloud providers', async (t) => {
    t.mock.method(globalThis, 'fetch', async (url: string) => {
      assert.equal(new URL(url).hostname, 'ollama.test');
      return new Response(JSON.stringify({ message: { content: JSON.stringify(decision) } }));
    });
    const brain = new RoutedBrainModel({
      env: { ...allKeys, NEXUS_BRAIN_BACKEND: 'ollama' },
      ollama: local(),
    });
    await brain.decide(messages, undefined, true, signal());
  });

  test('explicit cloud selection stays pinned even when rate limited', async (t) => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async (url: string) => {
      calls++;
      assert.equal(new URL(url).hostname, 'api.groq.com');
      return new Response('', { status: 429 });
    });
    const brain = new RoutedBrainModel({
      env: { ...allKeys, NEXUS_BRAIN_BACKEND: 'groq' },
      ollama: local(),
    });
    await assert.rejects(brain.decide(messages, undefined, true, signal()), BrainProviderError);
    assert.equal(calls, 1);
  });

  test('auth errors stop automatic failover with an actionable error', async (t) => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      return new Response('', { status: 401 });
    });
    await assert.rejects(
      new RoutedBrainModel({ env: allKeys, ollama: local() }).decide(
        messages,
        undefined,
        true,
        signal()
      ),
      /clé API/
    );
    assert.equal(calls, 1);
  });

  test('cancelling an active provider never starts the next provider', async (t) => {
    let calls = 0;
    const controller = new AbortController();
    t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      controller.abort(new Error('cancelled'));
      throw controller.signal.reason;
    });
    await assert.rejects(
      new RoutedBrainModel({ env: allKeys, ollama: local() }).decide(
        messages,
        undefined,
        true,
        controller.signal
      ),
      /cancelled/
    );
    assert.equal(calls, 1);
  });

  test('menu includes configured models and allows selecting them without misrouting to Ollama', async (t) => {
    const urls: string[] = [];
    t.mock.method(globalThis, 'fetch', async (url: string) => {
      urls.push(url);
      if (url.endsWith('/api/tags')) throw new TypeError('offline');
      return completion();
    });
    const brain = new RoutedBrainModel({
      env: { CEREBRAS_API_KEY: 'secret-not-in-menu', CEREBRAS_MODEL: 'configured-cerebras' },
      ollama: local(),
    });
    const menu = await brain.listModels();
    assert.deepEqual(
      menu.models.map((m) => m.model),
      ['auto', 'cerebras:configured-cerebras', 'ollama:local-test']
    );
    assert.ok(!JSON.stringify(menu).includes('secret-not-in-menu'));
    brain.setModel('cerebras:configured-cerebras');
    assert.equal(brain.getModel(), 'cerebras:configured-cerebras');
    await brain.decide(messages, undefined, true, signal());
    assert.equal(urls.at(-1), 'https://api.cerebras.ai/v1/chat/completions');
    brain.setModel('auto');
    assert.equal(brain.getModel(), 'auto');
  });

  test('explicit provider without a key is rejected instead of silently switching', () => {
    assert.throws(
      () => new RoutedBrainModel({ env: { NEXUS_BRAIN_BACKEND: 'groq' }, ollama: local() }),
      BrainProviderError
    );
  });
});

suite('Brain routing deadlines and in-flight selection', () => {
  test('a provider timeout falls through, while the total deadline prevents another request', async (t) => {
    let calls = 0;
    const stub = t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
      calls++;
      if (calls === 2) return completion();
      return new Promise<Response>((_resolve, reject) =>
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      );
    });
    const keepAlive = setInterval(() => {}, 1000);
    try {
      await new RoutedBrainModel({ env: allKeys, ollama: local(), cloudTimeoutMs: 5 }).decide(
        messages,
        undefined,
        true,
        signal()
      );
      assert.equal(calls, 2);
      calls = 0;
      await assert.rejects(
        new RoutedBrainModel({
          env: allKeys,
          ollama: local(),
          cloudTimeoutMs: 1000,
          totalTimeoutMs: 5,
        }).decide(messages, undefined, true, signal()),
        (error: unknown) =>
          error instanceof BrainProviderError &&
          error.provider === 'brain' &&
          error.code === 'timeout'
      );
      assert.equal(calls, 1);
    } finally {
      clearInterval(keepAlive);
      stub.mock.restore();
    }
  });

  test('changing the local model during cloud failure does not redirect an in-flight fallback', async (t) => {
    let release!: (response: Response) => void;
    const calledModels: string[] = [];
    t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/tags'))
        return new Response(JSON.stringify({ models: [{ name: 'other-local' }] }));
      if (url.includes('cerebras'))
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      calledModels.push(JSON.parse(String(init?.body)).model);
      return new Response(JSON.stringify({ message: { content: JSON.stringify(decision) } }));
    });
    const brain = new RoutedBrainModel({ env: { CEREBRAS_API_KEY: 'test' }, ollama: local() });
    await brain.listModels();
    const pending = brain.decide(messages, undefined, true, signal());
    brain.setModel('ollama:other-local');
    release(new Response('', { status: 503 }));
    await pending;
    assert.deepEqual(calledModels, ['local-test']);
    await brain.decide(messages, undefined, true, signal());
    assert.deepEqual(calledModels, ['local-test', 'other-local']);
  });
});
