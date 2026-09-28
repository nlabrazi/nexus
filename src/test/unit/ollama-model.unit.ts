import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  OllamaBrainModel,
  checkOllamaAvailable,
  listOllamaModels,
} from '../../conversational/ollama-model';

suite('OllamaBrainModel adapter', () => {
  test('decide calls Ollama chat endpoint and parses structured decision', async (t) => {
    let requestedUrl = '';
    let requestBody: Record<string, unknown> | undefined;

    t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
      requestedUrl = String(url);
      if (init?.body && typeof init.body === 'string') {
        requestBody = JSON.parse(init.body);
      }
      return new Response(
        JSON.stringify({
          model: 'llama3.2:3b',
          message: {
            role: 'assistant',
            content: JSON.stringify({
              action: 'reply',
              text: 'Bonjour ! Comment puis-je vous aider aujourd’hui ?',
            }),
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const model = new OllamaBrainModel({ host: 'http://mock-ollama:11434', model: 'llama3.2:3b' });
    const decision = await model.decide(
      [{ role: 'user', text: 'Bonjour' }],
      { name: 'nexus', branch: 'staging' },
      true,
      new AbortController().signal
    );

    assert.equal(requestedUrl, 'http://mock-ollama:11434/api/chat');
    assert.ok(requestBody);
    assert.equal(requestBody.model, 'llama3.2:3b');
    assert.equal(requestBody.format, 'json');
    assert.equal(decision.action, 'reply');
    assert.equal(decision.text, 'Bonjour ! Comment puis-je vous aider aujourd’hui ?');
  });

  test('decide handles code-fenced JSON responses from smaller models', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => {
      return new Response(
        JSON.stringify({
          model: 'llama3.2:3b',
          message: {
            role: 'assistant',
            content: '```json\n{"action": "inspect_project", "text": "nexus"}\n```',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const model = new OllamaBrainModel();
    const decision = await model.decide(
      [{ role: 'user', text: 'Inspecte le code' }],
      undefined,
      true,
      new AbortController().signal
    );

    assert.equal(decision.action, 'inspect_project');
    assert.equal(decision.text, 'nexus');
  });

  test('decide falls back gracefully when Ollama returns non-JSON text', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => {
      return new Response(
        JSON.stringify({
          model: 'llama3.2:3b',
          message: {
            role: 'assistant',
            content: 'Ceci est une réponse normale sans JSON.',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const model = new OllamaBrainModel();
    const decision = await model.decide(
      [{ role: 'user', text: 'Parle-moi de ton rôle' }],
      undefined,
      false,
      new AbortController().signal
    );

    assert.equal(decision.action, 'reply');
    assert.equal(decision.text, 'Ceci est une réponse normale sans JSON.');
  });

  test('decide reports actionable error when Ollama is unreachable and no fallback', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => {
      throw new Error('fetch failed ECONNREFUSED');
    });

    const originalGeminiKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_GENAI_API_KEY;

    try {
      const model = new OllamaBrainModel({ host: 'http://127.0.0.1:11434' });
      await assert.rejects(
        model.decide(
          [{ role: 'user', text: 'Test' }],
          undefined,
          true,
          new AbortController().signal
        ),
        /Impossible de contacter le moteur Nexus Brain local \(Ollama/
      );
    } finally {
      if (originalGeminiKey) {
        process.env.GEMINI_API_KEY = originalGeminiKey;
      }
    }
  });

  test('listOllamaModels parses tags from /api/tags', async (t) => {
    t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
      assert.equal(String(url), 'http://mock-ollama:11434/api/tags');
      return new Response(
        JSON.stringify({
          models: [
            { name: 'llama3.2:3b', model: 'llama3.2:3b' },
            { name: 'qwen3.6:27b-mtp-q4_K_M', model: 'qwen3.6:27b-mtp-q4_K_M' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const models = await listOllamaModels('http://mock-ollama:11434');
    assert.deepEqual(models, ['llama3.2:3b', 'qwen3.6:27b-mtp-q4_K_M']);
  });

  test('checkOllamaAvailable returns boolean status', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => {
      return new Response(
        JSON.stringify({
          models: [{ name: 'llama3.2:3b' }],
        }),
        { status: 200 }
      );
    });

    const available = await checkOllamaAvailable('http://mock-ollama:11434');
    assert.equal(available, true);
  });
});
