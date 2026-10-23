import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  serializeChatForUpstash,
  getProjectStorageKey,
} from '../app/utils/chat-history.mjs';

test('getProjectStorageKey extracts clean project name across Linux and Windows paths', () => {
  assert.equal(getProjectStorageKey('/home/kaox/code/bricolage/nexus'), 'nexus');
  assert.equal(getProjectStorageKey('/home/ubuntu/nexus/'), 'nexus');
  assert.equal(getProjectStorageKey('C:\\Projects\\nexus'), 'nexus');
  assert.equal(getProjectStorageKey('my-project'), 'my-project');
  assert.equal(getProjectStorageKey(''), 'default');
  assert.equal(getProjectStorageKey(null), 'default');
});

test('serializeChatForUpstash bounds messages to maxCount and truncates overly large text blocks', () => {
  const hugeText = 'x'.repeat(50000);
  const input = Array.from({ length: 65 }, (_, i) => ({
    id: `msg-${i}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    backend: 'brain',
    text: i === 64 ? hugeText : `Message ${i}`,
    timestamp: 1000 + i,
    unknownField: 'dropped',
  }));

  const bounded = serializeChatForUpstash(input, 50, 30000);
  assert.equal(bounded.length, 50);
  assert.equal(bounded[0].id, 'msg-15'); // First 15 dropped
  assert.equal(bounded[49].id, 'msg-64');
  assert.equal(bounded[49].text.length, 30000);
  assert.equal(bounded[49].unknownField, undefined);
});

test('serializeChatForUpstash handles empty and malformed input gracefully', () => {
  assert.deepEqual(serializeChatForUpstash(null), []);
  assert.deepEqual(serializeChatForUpstash(undefined), []);
  assert.deepEqual(serializeChatForUpstash([]), []);
  const single = serializeChatForUpstash([{ role: 'user', text: 'Hello' }]);
  assert.equal(single.length, 1);
  assert.equal(single[0].role, 'user');
  assert.equal(single[0].text, 'Hello');
  assert.ok(single[0].id);
  assert.ok(single[0].timestamp);
});
