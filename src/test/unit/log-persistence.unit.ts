import * as assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Logger } from '../../logging/logger';
import { createRotatingLogSink } from '../../logging/persistence';

test('persistent logs rotate within a fixed bound and isolate errors', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nexus-logs-'));
  try {
    const log = new Logger(createRotatingLogSink(directory, 2048, 2));
    for (let i = 0; i < 80; i++) log.info('Brain', 'decide', { status: 'success', count: i });
    log.error('TTS', 'synthesize', { status: 'failed' });
    const files = readdirSync(directory);
    assert.ok(files.includes('nexus.log.2'));
    assert.ok(files.length <= 6);
    for (const name of files) {
      assert.ok(statSync(join(directory, name)).size <= 2048);
      for (const line of readFileSync(join(directory, name), 'utf8').trim().split('\n'))
        JSON.parse(line);
    }
    const errors = readFileSync(join(directory, 'error.log'), 'utf8');
    assert.ok(errors.includes('synthesize'));
    assert.ok(!errors.includes('decide'));
    if (process.platform !== 'win32')
      assert.equal(statSync(join(directory, 'nexus.log')).mode & 0o777, 0o600);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an oversized record cannot grow a log beyond the configured limit', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nexus-logs-'));
  try {
    const log = new Logger(createRotatingLogSink(directory, 128, 1));
    log.info('Brain', 'decide', { model: 'x'.repeat(1000) });
    assert.ok(statSync(join(directory, 'nexus.log')).size <= 128);
    assert.equal(
      JSON.parse(readFileSync(join(directory, 'nexus.log'), 'utf8')).operation,
      'oversized_record'
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a failing destination does not suppress another logging destination', () => {
  const log = new Logger(() => {
    throw new Error('broken terminal');
  });
  let count = 0;
  const remove = log.addSink(() => {
    count++;
  });
  log.info('Core', 'start');
  remove();
  log.info('Core', 'stop');
  assert.equal(count, 1);
});
