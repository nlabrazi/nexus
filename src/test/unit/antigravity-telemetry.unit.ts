import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  convertRawUsage,
  isInitEvent,
  isModel,
  isResultEvent,
  isStepUpdateEvent,
  isTokenUsage,
  parseModelsOutput,
} from '../../antigravity/telemetry';

suite('Antigravity telemetry and event parsing', () => {
  test('parseModelsOutput parses agy models command output', () => {
    const raw = `⠋ Fetching available models...gemini-3.8-flash-high     Gemini 3.8 Flash (High)
gemini-3.8-flash-medium   Gemini 3.8 Flash (Medium)
gemini-3.1-pro-high       Gemini 3.1 Pro (High)
claude-sonnet-4-6         Claude Sonnet 4.6 (Thinking)`;

    const models = parseModelsOutput(raw);
    assert.equal(models.length, 4);

    assert.equal(models[0].model, 'gemini-3.8-flash-high');
    assert.equal(models[0].displayName, 'Gemini 3.8 Flash (High)');
    assert.equal(models[0].defaultReasoningEffort, 'high');
    assert.equal(models[0].isDefault, true);

    assert.equal(models[1].model, 'gemini-3.8-flash-medium');
    assert.equal(models[1].defaultReasoningEffort, 'medium');

    assert.equal(models[3].model, 'claude-sonnet-4-6');
    assert.equal(models[3].defaultReasoningEffort, 'medium');

    for (const model of models) {
      assert.equal(isModel(model), true);
    }
  });

  test('isInitEvent validates init events correctly', () => {
    assert.equal(
      isInitEvent({
        event: 'init',
        conversation_id: 'conv-123',
        init: { cwd: '/home/user/project', tools: ['view_file'] },
      }),
      true
    );
    assert.equal(isInitEvent({ event: 'init', conversation_id: '' }), false);
    assert.equal(isInitEvent({ event: 'other' }), false);
  });

  test('isStepUpdateEvent and isResultEvent validate stream-json events', () => {
    assert.equal(
      isStepUpdateEvent({
        event: 'step_update',
        step_update: {
          conversation_id: 'conv-1',
          step_index: 1,
          state: 'ACTIVE',
          step_type: 'agent_response',
          text_delta: 'Hello',
        },
      }),
      true
    );

    assert.equal(
      isResultEvent({
        event: 'result',
        result: {
          conversation_id: 'conv-1',
          status: 'SUCCESS',
          response: 'Hello world',
          duration_seconds: 1.2,
          num_turns: 1,
        },
      }),
      true
    );
  });

  test('convertRawUsage and isTokenUsage handle token statistics', () => {
    const raw = {
      input_tokens: 1500,
      output_tokens: 400,
      thinking_tokens: 250,
      cache_read_tokens: 800,
      total_tokens: 1900,
    };

    const breakdown = convertRawUsage(raw);
    assert.deepEqual(breakdown, {
      totalTokens: 1900,
      inputTokens: 1500,
      cachedInputTokens: 800,
      outputTokens: 400,
      reasoningOutputTokens: 250,
    });

    const usage = {
      total: breakdown,
      last: breakdown,
      modelContextWindow: 1_000_000,
    };

    assert.equal(isTokenUsage(usage), true);
  });
});
