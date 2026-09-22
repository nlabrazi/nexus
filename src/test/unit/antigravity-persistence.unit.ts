import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { WorkspaceAntigravitySessionPersistence } from '../../antigravity/persistence';

suite('Antigravity session persistence', () => {
  test('loads and saves a valid session snapshot', async () => {
    const memory = new Map<string, unknown>();
    const storage = {
      get: (key: string) => memory.get(key),
      update: async (key: string, value: unknown) => {
        memory.set(key, value);
      },
    };

    const persistence = new WorkspaceAntigravitySessionPersistence(storage);
    assert.equal(persistence.load(), undefined);

    await persistence.save({
      version: 1,
      id: 'uuid-conversation-1',
      workspace: {
        root: '/home/user/project',
        git: {
          directory: '/home/user/project/.git',
          branch: 'staging',
        },
      },
    });

    const loaded = persistence.load();
    assert.deepEqual(loaded, {
      version: 1,
      id: 'uuid-conversation-1',
      workspace: {
        root: '/home/user/project',
        git: {
          directory: '/home/user/project/.git',
          branch: 'staging',
        },
      },
    });
  });

  test('ignores corrupted or invalid session data in storage', () => {
    const memory = new Map<string, unknown>();
    const storage = {
      get: (key: string) => memory.get(key),
      update: async (key: string, value: unknown) => {
        memory.set(key, value);
      },
    };

    const persistence = new WorkspaceAntigravitySessionPersistence(storage);

    memory.set('nexus.antigravity.session', { version: 2, id: 'unknown' });
    assert.equal(persistence.load(), undefined);

    memory.set('nexus.antigravity.session', {
      version: 1,
      id: 'valid',
      workspace: { root: 'relative/path' },
    });
    assert.equal(persistence.load(), undefined);
  });
});
