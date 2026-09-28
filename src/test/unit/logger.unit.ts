import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { DiagnosticError, Logger, LogRecord, registerLogSecret } from '../../logging/logger';

test('logger filters debug and retains structured task outcomes without extra payloads', () => {
  const records: LogRecord[] = [];
  const log = new Logger((record) => records.push(record));
  log.debug('Brain', 'decide');
  const fields = { provider: 'ollama', status: 'success', durationMs: 123, prompt: 'private' };
  log.info('Brain', 'decide', fields);
  assert.equal(records.length, 1);
  assert.equal(records[0].durationMs, 123);
  assert.equal(records[0].provider, 'ollama');
  assert.ok(!JSON.stringify(records).includes('private'));
  assert.ok(!Number.isNaN(Date.parse(records[0].timestamp)));
});

test('a broken logging destination cannot interrupt Nexus', () => {
  const log = new Logger(() => {
    throw new Error('disk unavailable');
  });
  assert.doesNotThrow(() => log.error('TTS', 'synthesize', { status: 'failed' }));
});

test('logs redact registered and environment secrets, tokens and request credentials', () => {
  process.env.NEXUS_TEST_API_KEY = 'environment-private-key';
  try {
    registerLogSecret('dynamic-private-key');
    const records: LogRecord[] = [];
    const log = new Logger((record) => records.push(record));
    log.error(
      'HTTP',
      'request',
      { model: 'dynamic-private-key environment-private-key' },
      new DiagnosticError(
        'Bearer private-auth https://host?key=private-query 123456:abcdefghijklmnopqrst'
      )
    );
    const serialized = JSON.stringify(records);
    for (const secret of [
      'dynamic-private-key',
      'environment-private-key',
      'private-auth',
      'private-query',
      'abcdefghijklmnopqrst',
    ]) {
      assert.ok(!serialized.includes(secret));
    }
    assert.ok(serialized.includes('[REDACTED]'));
  } finally {
    delete process.env.NEXUS_TEST_API_KEY;
  }
});

test('provider payloads stay private, but error type and stack frames remain diagnosable', () => {
  const records: LogRecord[] = [];
  const log = new Logger((record) => records.push(record));
  log.warn(
    'Brain',
    'decide',
    { provider: 'ollama', status: 'failed' },
    new TypeError('prompt: confidential project')
  );
  assert.equal(records[0].error?.type, 'TypeError');
  assert.ok(records[0].error?.stack?.includes(' at '));
  assert.ok(!JSON.stringify(records).includes('confidential'));
  assert.equal(log.getLastError()?.operation, 'decide');
});
