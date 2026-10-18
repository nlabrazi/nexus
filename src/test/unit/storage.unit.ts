import * as assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { suite, test } from 'node:test';
import {
  createPersistentStorage,
  FileStorage,
  HybridStorage,
  MemoryStorage,
  UpstashStorage,
} from '../../runtime/storage';

suite('Nexus Storage & Upstash Persistence', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'nexus-storage-test-'));

  test('MemoryStorage stores, retrieves, lists keys and clears', async () => {
    const storage = new MemoryStorage();
    assert.equal(storage.get('foo'), undefined);
    assert.equal(storage.has('foo'), false);

    await storage.update('foo', { a: 1 });
    assert.deepEqual(storage.get('foo'), { a: 1 });
    assert.equal(storage.has('foo'), true);
    assert.deepEqual(storage.keys(), ['foo']);

    await storage.update('foo', undefined);
    assert.equal(storage.get('foo'), undefined);
    assert.equal(storage.has('foo'), false);

    await storage.update('k1', 'v1');
    await storage.update('k2', 'v2');
    assert.equal(storage.keys().length, 2);
    storage.clear();
    assert.equal(storage.keys().length, 0);
  });

  test('FileStorage persists data to disk and reloads on startup', async () => {
    const filePath = join(sandbox, 'test-storage.json');
    const storage1 = new FileStorage(filePath);

    await storage1.update('session.id', 'session-123');
    await storage1.update('model.pref', { model: 'codex', effort: 'high' });

    assert.ok(existsSync(filePath));
    const content = JSON.parse(readFileSync(filePath, 'utf8'));
    assert.equal(content['session.id'], 'session-123');
    assert.deepEqual(content['model.pref'], { model: 'codex', effort: 'high' });

    // New instance loading existing file
    const storage2 = new FileStorage(filePath);
    assert.equal(storage2.get('session.id'), 'session-123');
    assert.deepEqual(storage2.get('model.pref'), { model: 'codex', effort: 'high' });
    assert.deepEqual(storage2.keys().sort(), ['model.pref', 'session.id'].sort());

    await storage2.update('session.id', undefined);
    const storage3 = new FileStorage(filePath);
    assert.equal(storage3.get('session.id'), undefined);
  });

  test('FileStorage handles corrupted JSON files safely', async () => {
    const filePath = join(sandbox, 'corrupt-storage.json');
    writeFileSync(filePath, '{ bad json ...', 'utf8');

    const storage = new FileStorage(filePath);
    assert.equal(storage.get('anything'), undefined);

    await storage.update('recovered', true);
    assert.equal(storage.get('recovered'), true);
  });

  test('UpstashStorage executes REST requests and handles mock fetch', async () => {
    const mockStore = new Map<string, string>();
    const calls: Array<{ url: string; method?: string; body?: string }> = [];

    const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ url: urlStr, method, body: init?.body as string });

      if (urlStr.includes('/set/')) {
        const key = urlStr.split('/set/')[1];
        mockStore.set(decodeURIComponent(key), init?.body as string);
        return { ok: true, json: async () => ({ result: 'OK' }) } as Response;
      }

      if (urlStr.includes('/get/')) {
        const key = urlStr.split('/get/')[1];
        const val = mockStore.get(decodeURIComponent(key));
        return {
          ok: true,
          json: async () => ({ result: val ?? null }),
        } as Response;
      }

      if (urlStr.includes('/del/')) {
        const key = urlStr.split('/del/')[1];
        mockStore.delete(decodeURIComponent(key));
        return { ok: true, json: async () => ({ result: 1 }) } as Response;
      }

      return { ok: false, status: 404 } as Response;
    }) as unknown as typeof fetch;

    const upstash = new UpstashStorage({
      url: 'https://mock.upstash.io',
      token: 'mock-token',
      prefix: 'nexus:test:',
      fetchFn: mockFetch,
    });

    await upstash.update('session-abc', { user: 'kaox', prompt: 'test' });
    assert.deepEqual(upstash.get('session-abc'), { user: 'kaox', prompt: 'test' });

    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes('/set/nexus%3Atest%3Asession-abc'));
    assert.equal(calls[0].method, 'POST');

    // Simulate remote fetch via syncKey
    const synced = await upstash.syncKey('session-abc');
    assert.deepEqual(synced, { user: 'kaox', prompt: 'test' });

    await upstash.update('session-abc', undefined);
    assert.equal(upstash.get('session-abc'), undefined);
    assert.ok(calls.some((c) => c.url.includes('/del/nexus%3Atest%3Asession-abc')));
  });

  test('UpstashStorage catches fetch errors without throwing', async () => {
    const brokenFetch = (async () => {
      throw new Error('Network failure');
    }) as unknown as typeof fetch;

    const upstash = new UpstashStorage({
      url: 'https://unreachable.upstash.io',
      token: 'token',
      fetchFn: brokenFetch,
    });

    // Should not throw
    await upstash.update('resilience-key', { value: 42 });
    assert.deepEqual(upstash.get('resilience-key'), { value: 42 });

    const synced = await upstash.syncKey('resilience-key');
    assert.deepEqual(synced, { value: 42 });
  });

  test('HybridStorage coordinates local and remote storage', async () => {
    const memory = new MemoryStorage();
    const mockStore = new Map<string, string>();

    const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes('/set/')) {
        const key = urlStr.split('/set/')[1];
        mockStore.set(decodeURIComponent(key), init?.body as string);
        return { ok: true, json: async () => ({ result: 'OK' }) } as Response;
      }
      return { ok: true, json: async () => ({ result: 1 }) } as Response;
    }) as unknown as typeof fetch;

    const remote = new UpstashStorage({
      url: 'https://mock.upstash.io',
      token: 'mock-token',
      fetchFn: mockFetch,
    });

    const hybrid = new HybridStorage(memory, remote);

    await hybrid.update('user.pref', { theme: 'dark' });
    assert.deepEqual(hybrid.get('user.pref'), { theme: 'dark' });
    assert.deepEqual(memory.get('user.pref'), { theme: 'dark' });
    assert.deepEqual(remote.get('user.pref'), { theme: 'dark' });
  });

  test('createPersistentStorage returns FileStorage or HybridStorage depending on options', () => {
    const filePath = join(sandbox, 'factory-test.json');

    const localOnly = createPersistentStorage({
      filePath,
      upstashUrl: '',
      upstashToken: '',
    });
    assert.ok(localOnly instanceof FileStorage);

    const hybrid = createPersistentStorage({
      filePath,
      upstashUrl: 'https://custom.upstash.io',
      upstashToken: 'custom-token',
    });
    assert.ok(hybrid instanceof HybridStorage);
  });

  test('cleanup sandbox', () => {
    rmSync(sandbox, { recursive: true, force: true });
  });
});
