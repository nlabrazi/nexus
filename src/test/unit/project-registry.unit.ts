import * as assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, beforeEach, suite, test } from 'node:test';
import {
  getDefaultRegistryPath,
  loadProjectRegistry,
  ProjectRegistry,
} from '../../desktop/registry';

suite('ProjectRegistry', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'nexus-project-registry-test-'));
  const registryFile = join(sandbox, 'projects.json');
  const projectAlphaDir = join(sandbox, 'Project Alpha');
  const projectBetaDir = join(sandbox, 'Project Beta');
  const projectAlphaCloneDir = join(sandbox, 'other', 'Project Alpha');

  beforeEach(() => {
    if (existsSync(registryFile)) {
      rmSync(registryFile, { force: true });
    }
    mkdirSync(projectAlphaDir, { recursive: true });
    mkdirSync(projectBetaDir, { recursive: true });
    mkdirSync(projectAlphaCloneDir, { recursive: true });
  });

  after(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  test('initializes empty registry when file does not exist', () => {
    const registry = new ProjectRegistry(registryFile);
    assert.equal(registry.getFilePath(), resolve(registryFile));
    assert.deepEqual(registry.list(), []);
    assert.equal(registry.getDefault(), undefined);
  });

  test('getDefaultRegistryPath respects NEXUS_PROJECTS_REGISTRY env var', () => {
    const previous = process.env.NEXUS_PROJECTS_REGISTRY;
    try {
      process.env.NEXUS_PROJECTS_REGISTRY = '/tmp/custom-nexus-projects.json';
      assert.equal(getDefaultRegistryPath(), '/tmp/custom-nexus-projects.json');
    } finally {
      if (previous === undefined) {
        delete process.env.NEXUS_PROJECTS_REGISTRY;
      } else {
        process.env.NEXUS_PROJECTS_REGISTRY = previous;
      }
    }
  });

  test('adds projects, assigns unique slug IDs, persists to disk and reloads', () => {
    const registry = new ProjectRegistry(registryFile);

    const alpha = registry.add({
      path: projectAlphaDir,
      defaultBackend: 'claude',
      protectedBranches: ['main', 'staging'],
    });

    assert.equal(alpha.id, 'project-alpha');
    assert.equal(alpha.name, 'Project Alpha');
    assert.equal(alpha.path, resolve(projectAlphaDir));
    assert.equal(alpha.defaultBackend, 'claude');
    assert.deepEqual(alpha.protectedBranches, ['main', 'staging']);
    assert.equal(registry.getDefault()?.id, 'project-alpha');

    // Second project with same directory basename gets a deduplicated slug ID
    const alphaClone = registry.add({
      path: projectAlphaCloneDir,
    });
    assert.equal(alphaClone.id, 'project-alpha-2');

    // Reload from disk via loadProjectRegistry
    const reloaded = loadProjectRegistry(registryFile);
    assert.equal(reloaded.list().length, 2);
    assert.equal(reloaded.get('project-alpha')?.defaultBackend, 'claude');
    assert.equal(reloaded.get('project-alpha-2')?.path, resolve(projectAlphaCloneDir));
    assert.equal(reloaded.getDefault()?.id, 'project-alpha');
  });

  test('updates existing project entry when adding same path again', () => {
    const registry = new ProjectRegistry(registryFile);
    const initial = registry.add({
      path: projectAlphaDir,
      name: 'Initial Name',
      defaultBackend: 'codex',
    });

    const updated = registry.add({
      path: projectAlphaDir,
      name: 'Updated Name',
      defaultBackend: 'antigravity',
    });

    assert.equal(registry.list().length, 1);
    assert.equal(updated.id, initial.id);
    assert.equal(updated.addedAt, initial.addedAt);
    assert.equal(updated.name, 'Updated Name');
    assert.equal(updated.defaultBackend, 'antigravity');
  });

  test('validates project path on add (empty, missing, or non-directory)', () => {
    const registry = new ProjectRegistry(registryFile);

    assert.throws(() => {
      registry.add({ path: '   ' });
    }, /ne peut pas être vide/);

    assert.throws(() => {
      registry.add({ path: join(sandbox, 'non-existent-folder') });
    }, /n'existe pas/);

    const regularFile = join(sandbox, 'file.txt');
    writeFileSync(regularFile, 'hello', 'utf-8');
    assert.throws(() => {
      registry.add({ path: regularFile });
    }, /doit être un répertoire/);
  });

  test('supports lookup by id, name or path and manages default project', () => {
    const registry = new ProjectRegistry(registryFile);
    const alpha = registry.add({ path: projectAlphaDir });
    const beta = registry.add({ path: projectBetaDir, isDefault: true });

    assert.equal(registry.get(alpha.id)?.id, alpha.id);
    assert.equal(registry.get('Project Alpha')?.id, alpha.id);
    assert.equal(registry.get(projectAlphaDir)?.id, alpha.id);
    assert.equal(registry.get('unknown-project'), undefined);

    // Beta was added with isDefault: true
    assert.equal(registry.getDefault()?.id, beta.id);

    // Switch default back to Alpha
    const switched = registry.setDefault(alpha.id);
    assert.equal(switched.id, alpha.id);
    assert.equal(registry.getDefault()?.id, alpha.id);

    assert.throws(() => {
      registry.setDefault('non-existent');
    }, /Projet introuvable/);
  });

  test('removes projects and falls back defaultProjectId to remaining project', () => {
    const registry = new ProjectRegistry(registryFile);
    const alpha = registry.add({ path: projectAlphaDir, isDefault: true });
    const beta = registry.add({ path: projectBetaDir });

    assert.equal(registry.remove('non-existent'), false);
    assert.equal(registry.remove(alpha.id), true);
    assert.equal(registry.list().length, 1);
    assert.equal(registry.getDefault()?.id, beta.id);
  });

  test('recordActivity updates lastActiveAt timestamp', async () => {
    const registry = new ProjectRegistry(registryFile);
    const alpha = registry.add({ path: projectAlphaDir });
    const beforeTimestamp = alpha.lastActiveAt ?? 0;

    await new Promise((r) => setTimeout(r, 10));
    registry.recordActivity(alpha.id);

    const updated = registry.get(alpha.id);
    assert.ok(updated?.lastActiveAt !== undefined && updated.lastActiveAt >= beforeTimestamp);
  });

  test('recovers safely from corrupted JSON or malformed entries', () => {
    writeFileSync(registryFile, '{ corrupted json', 'utf-8');
    const fromCorrupt = new ProjectRegistry(registryFile);
    assert.deepEqual(fromCorrupt.list(), []);

    writeFileSync(
      registryFile,
      JSON.stringify({
        version: 1,
        defaultProjectId: 'valid-1',
        projects: [
          { id: 'valid-1', name: 'Valid', path: projectAlphaDir, addedAt: 100 },
          { id: 123, name: null },
          null,
        ],
      }),
      'utf-8'
    );
    const fromPartial = new ProjectRegistry(registryFile);
    assert.equal(fromPartial.list().length, 1);
    assert.equal(fromPartial.list()[0].id, 'valid-1');
  });
});
