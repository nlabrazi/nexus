import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { Logger, LogRecord } from '../../logging/logger';

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
