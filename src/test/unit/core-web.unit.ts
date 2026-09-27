import * as assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, suite, test } from 'node:test';
import { NexusCore } from '../../core';

suite('Nexus Core Web Client & CORS Support', () => {
  const testDir = join(tmpdir(), 'nexus-core-web-test');
  const validToken = 'test-token-web-123';
  let core: NexusCore;
  let port: number;
  let baseUrl: string;

  before(async () => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });

    // Create mock static assets in testDir
    writeFileSync(join(testDir, 'index.html'), '<html><body>Nexus PWA Test</body></html>');
    writeFileSync(
      join(testDir, 'manifest.webmanifest'),
      JSON.stringify({ name: 'Nexus Mobile', short_name: 'Nexus' })
    );
    writeFileSync(join(testDir, 'app.js'), 'console.log("nexus");');

    // Start NexusCore with publicDir set to testDir
    core = new NexusCore({
      port: 0,
      host: '127.0.0.1',
      authTokens: [validToken],
      publicDir: testDir,
    });

    await core.start();
    const server = core.getServer();
    const addr = server?.address();
    assert.ok(addr && typeof addr === 'object');
    port = addr.port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await core.stop();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('CORS headers are set on standard API responses', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.ok(res.headers.get('access-control-allow-methods')?.includes('GET'));
  });

  test('OPTIONS preflight request returns 204 with CORS headers', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'POST',
      },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.ok(res.headers.get('access-control-allow-methods')?.includes('POST'));
    assert.ok(res.headers.get('access-control-allow-headers')?.includes('Content-Type'));
  });

  test('serves index.html on root GET /', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('text/html'));
    const text = await res.text();
    assert.ok(text.includes('Nexus PWA Test'));
  });

  test('serves static files with correct MIME type', async () => {
    const resManifest = await fetch(`${baseUrl}/manifest.webmanifest`);
    assert.equal(resManifest.status, 200);
    assert.ok(resManifest.headers.get('content-type')?.includes('manifest+json'));
    const manifestJson = (await resManifest.json()) as { short_name: string };
    assert.equal(manifestJson.short_name, 'Nexus');

    const resJs = await fetch(`${baseUrl}/app.js`);
    assert.equal(resJs.status, 200);
    assert.ok(resJs.headers.get('content-type')?.includes('javascript'));
    const jsText = await resJs.text();
    assert.equal(jsText, 'console.log("nexus");');
  });

  test('falls back to index.html for SPA navigation requests', async () => {
    const res = await fetch(`${baseUrl}/settings`, {
      headers: { Accept: 'text/html,application/xhtml+xml' },
    });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('text/html'));
    const text = await res.text();
    assert.ok(text.includes('Nexus PWA Test'));
  });

  test('blocks directory traversal attacks', async () => {
    const res = await fetch(`${baseUrl}/../../../../etc/passwd`);
    assert.equal(res.status, 404);
  });

  test('GET /api/tasks accepts query filters for status, backend, and projectId', async () => {
    const res = await fetch(`${baseUrl}/api/tasks?backend=brain&status=pending&projectId=test-p`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    assert.equal(res.status, 200);
    const tasks = (await res.json()) as unknown[];
    assert.ok(Array.isArray(tasks));
  });
});
