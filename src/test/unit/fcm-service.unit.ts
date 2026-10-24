import * as assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, suite, test } from 'node:test';
import { FcmService } from '../../notifications/fcm-service';
import { MemoryStorage } from '../../runtime/storage';

suite('FcmService Push Notifications', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'nexus-fcm-test-'));
  const validServiceAccountPath = join(sandbox, 'valid-sa.json');
  const invalidServiceAccountPath = join(sandbox, 'invalid-sa.json');

  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  writeFileSync(
    validServiceAccountPath,
    JSON.stringify({
      project_id: 'nexus-test-proj',
      client_email: 'firebase-adminsdk@nexus-test-proj.iam.gserviceaccount.com',
      private_key: privateKey,
    }),
    'utf-8'
  );
  writeFileSync(invalidServiceAccountPath, '{ not valid json', 'utf-8');

  after(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  test('reports unconfigured when service account file is missing or malformed', () => {
    const missing = new FcmService({
      serviceAccountPath: join(sandbox, 'does-not-exist.json'),
    });
    assert.equal(missing.isConfigured(), false);

    const malformed = new FcmService({
      serviceAccountPath: invalidServiceAccountPath,
    });
    assert.equal(malformed.isConfigured(), false);
  });

  test('loads valid service account and manages device tokens in memory and storage', async () => {
    const storage = new MemoryStorage();
    const fcm = new FcmService({
      serviceAccountPath: validServiceAccountPath,
      storage,
    });

    assert.equal(fcm.isConfigured(), true);
    assert.deepEqual(await fcm.getTokens(), []);

    await fcm.registerToken('');
    assert.deepEqual(await fcm.getTokens(), []);

    await fcm.registerToken('token-device-1');
    await fcm.registerToken('token-device-1'); // duplicate ignored
    await fcm.registerToken('token-device-2');

    const tokens = await fcm.getTokens();
    assert.deepEqual(tokens, ['token-device-1', 'token-device-2']);
    assert.deepEqual(storage.get('nexus:push_tokens'), ['token-device-1', 'token-device-2']);

    await fcm.removeToken('token-device-1');
    assert.deepEqual(await fcm.getTokens(), ['token-device-2']);
    assert.deepEqual(storage.get('nexus:push_tokens'), ['token-device-2']);
  });

  test('sendPush returns zero counts when unconfigured or when no tokens are registered', async () => {
    const fcm = new FcmService({
      serviceAccountPath: validServiceAccountPath,
    });
    const emptyResult = await fcm.sendPush({ title: 'Test', body: 'Hello' });
    assert.deepEqual(emptyResult, { successCount: 0, failureCount: 0 });
  });

  test('sendPush exchanges JWT for OAuth token, caches it, sends FCM messages and prunes UNREGISTERED tokens', async () => {
    const storage = new MemoryStorage();
    const fcm = new FcmService({
      serviceAccountPath: validServiceAccountPath,
      storage,
    });

    await fcm.registerToken('valid-token-1');
    await fcm.registerToken('unregistered-token-2');

    const originalFetch = globalThis.fetch;
    let oauthCalls = 0;
    const fcmRequests: Array<{ url: string; body: Record<string, unknown> }> = [];

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') {
        oauthCalls++;
        return {
          ok: true,
          json: async () => ({ access_token: 'mock-oauth-access-token', expires_in: 3600 }),
          text: async () => '',
        } as Response;
      }

      if (url.includes('fcm.googleapis.com/v1/projects/nexus-test-proj/messages:send')) {
        const parsedBody = JSON.parse(String(init?.body ?? '{}')) as {
          message: { token: string; data: Record<string, string> };
        };
        fcmRequests.push({ url, body: parsedBody });

        if (parsedBody.message.token === 'unregistered-token-2') {
          return {
            ok: false,
            text: async () => '{"error":{"status":"UNREGISTERED"}}',
          } as Response;
        }

        return {
          ok: true,
          json: async () => ({ name: 'projects/nexus-test-proj/messages/1' }),
          text: async () => '',
        } as Response;
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    }) as typeof fetch;

    try {
      const firstResult = await fcm.sendPush({
        title: 'Task finished',
        body: 'All tests passed',
        data: { taskId: 'task-42' },
      });

      assert.deepEqual(firstResult, { successCount: 1, failureCount: 1 });
      assert.equal(oauthCalls, 1);
      assert.equal(fcmRequests.length, 2);

      // Unregistered token should have been automatically removed
      assert.deepEqual(await fcm.getTokens(), ['valid-token-1']);

      // Second sendPush reuses cached OAuth access token
      const secondResult = await fcm.sendPush({
        title: 'Second notification',
        body: 'Cached token check',
      });
      assert.deepEqual(secondResult, { successCount: 1, failureCount: 0 });
      assert.equal(oauthCalls, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
