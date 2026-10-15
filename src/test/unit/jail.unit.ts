import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JailGuard, SecurityError } from '../../security/jail';

suite('JailGuard filesystem confinement', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'nexus-jail-test-'));
  const allowedProject = join(sandbox, 'allowed-project');
  const outsideSecret = join(sandbox, 'outside-secret');

  test('setup test directories', () => {
    writeFileSync(outsideSecret, 'secret data');
    const { mkdirSync } = require('node:fs');
    mkdirSync(allowedProject, { recursive: true });
    writeFileSync(join(allowedProject, 'file.txt'), 'hello world');
  });

  const guard = new JailGuard({ allowedRoots: [allowedProject] });

  test('allows access to files directly inside the allowed root', () => {
    const valid = guard.resolveSafePath(join(allowedProject, 'file.txt'));
    assert.ok(valid.endsWith('file.txt'));
    assert.equal(guard.isPathAllowed(join(allowedProject, 'file.txt')), true);
  });

  test('allows access to the root itself', () => {
    const valid = guard.resolveSafePath(allowedProject);
    assert.ok(valid.endsWith('allowed-project'));
    assert.equal(guard.isPathAllowed(allowedProject), true);
  });

  test('rejects path traversal attempts (../)', () => {
    assert.throws(
      () => guard.resolveSafePath(join(allowedProject, '..', 'outside-secret')),
      (err: unknown) => err instanceof SecurityError && /Violation de confinement/.test(err.message)
    );
    assert.equal(guard.isPathAllowed(join(allowedProject, '..', 'outside-secret')), false);
  });

  test('rejects null byte injection', () => {
    assert.throws(
      () => guard.resolveSafePath(join(allowedProject, 'file.txt\0.js')),
      (err: unknown) => err instanceof SecurityError && /caractère nul/.test(err.message)
    );
  });

  test('rejects access to system paths like /etc or /var', () => {
    assert.throws(
      () => guard.resolveSafePath('/etc/passwd'),
      (err: unknown) => err instanceof SecurityError
    );
    assert.equal(guard.isPathAllowed('/etc/passwd'), false);
  });

  test('rejects access to protected sensitive file names like .ssh or id_rsa', () => {
    const fakeSsh = join(allowedProject, '.ssh');
    assert.throws(
      () => guard.resolveSafePath(fakeSsh),
      (err: unknown) => err instanceof SecurityError && /composant protégé/.test(err.message)
    );
  });

  test('defeats symlink escape pointing outside the jail', () => {
    const symlinkPath = join(allowedProject, 'evil-symlink');
    try {
      symlinkSync(outsideSecret, symlinkPath);
    } catch { }

    assert.throws(
      () => guard.resolveSafePath(symlinkPath),
      (err: unknown) => err instanceof SecurityError && /Violation de confinement/.test(err.message)
    );
    assert.equal(guard.isPathAllowed(symlinkPath), false);
  });

  test('cleanup test directory', () => {
    rmSync(sandbox, { recursive: true, force: true });
  });
});
