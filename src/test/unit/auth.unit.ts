import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { AuthGuard, AuthRateLimiter, getOrCreateDaemonToken } from '../../security/auth';

suite('AuthGuard token verification and rate limiting', () => {
  const limiter = new AuthRateLimiter({ maxAttempts: 3, windowMs: 1000, blockDurationMs: 5000 });
  const guard = new AuthGuard(['secret-token-123', 'admin-token-456'], limiter);

  test('validates correct Bearer token', () => {
    const res = guard.verifyToken('Bearer secret-token-123', '127.0.0.1');
    assert.equal(res.ok, true);
    assert.equal(res.blocked, undefined);
  });

  test('validates correct raw token without Bearer prefix', () => {
    const res = guard.verifyToken('admin-token-456', '127.0.0.1');
    assert.equal(res.ok, true);
  });

  test('rejects invalid token', () => {
    const res = guard.verifyToken('Bearer wrong-token', '192.168.1.100');
    assert.equal(res.ok, false);
    assert.equal(res.blocked, false);
  });

  test('rejects missing or empty token', () => {
    const res = guard.verifyToken(undefined, '192.168.1.100');
    assert.equal(res.ok, false);
  });

  test('blocks IP after reaching max failed attempts', () => {
    const attackerIp = '10.0.0.99';
    // attempt 1
    assert.equal(guard.verifyToken('bad-1', attackerIp).ok, false);
    // attempt 2
    assert.equal(guard.verifyToken('bad-2', attackerIp).ok, false);
    // attempt 3 -> blocked!
    const third = guard.verifyToken('bad-3', attackerIp);
    assert.equal(third.ok, false);
    assert.equal(third.blocked, true);

    // attempt 4 -> immediately rejected as blocked
    const fourth = guard.verifyToken('secret-token-123', attackerIp);
    assert.equal(fourth.ok, false);
    assert.equal(fourth.blocked, true);
  });

  test('getOrCreateDaemonToken generates a persistent token', () => {
    const explicit = getOrCreateDaemonToken('my-explicit-token');
    assert.equal(explicit, 'my-explicit-token');

    const generated = getOrCreateDaemonToken();
    assert.ok(typeof generated === 'string');
    assert.ok(generated.length >= 32);
  });
});
