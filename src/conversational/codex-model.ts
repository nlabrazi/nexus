import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexClient } from '../codex/client';
import { BRAIN_INSTRUCTIONS, VALID_BRAIN_ACTIONS } from './brain-decision';
import { BrainDecision, BrainMessage, BrainModel } from './model';
import { ConversationProjectContext } from './types';

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'text'],
  properties: {
    action: {
      type: 'string',
      enum: Array.from(VALID_BRAIN_ACTIONS),
    },
    text: { type: 'string' },
  },
};

/** Uses the existing ChatGPT-authenticated client, outside the project and without shell or external tools. */
export class CodexBrainModel implements BrainModel {
  async decide(
    messages: readonly BrainMessage[],
    project: ConversationProjectContext | undefined,
    toolsAllowed: boolean,
    signal: AbortSignal
  ): Promise<BrainDecision> {
    signal.throwIfAborted();
    const directory = await mkdtemp(join(tmpdir(), 'nexus-brain-'));
    const client = new CodexClient(undefined, { restrictedProfile: 'conversation' });
    const cancel = () => client.stop();
    signal.addEventListener('abort', cancel, { once: true });
    try {
      signal.throwIfAborted();
      await client.start();
      signal.throwIfAborted();
      const session = await client.startSession(directory, undefined, BRAIN_INSTRUCTIONS);
      signal.throwIfAborted();
      const response = await client.runTurn(
        session.thread.id,
        JSON.stringify({ project: project ?? null, toolsAllowed, messages }),
        undefined,
        undefined,
        OUTPUT_SCHEMA
      );
      signal.throwIfAborted();
      const value: unknown = JSON.parse(response);
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Réponse structurée Nexus invalide.');
      }
      const decision = value as Record<string, unknown>;
      if (
        Object.keys(decision).length !== 2 ||
        !VALID_BRAIN_ACTIONS.has(decision.action as BrainDecision['action']) ||
        typeof decision.text !== 'string' ||
        !decision.text.trim() ||
        decision.text.length > 16000
      ) {
        throw new Error('Réponse structurée Nexus invalide.');
      }
      return { action: decision.action as BrainDecision['action'], text: decision.text };
    } finally {
      signal.removeEventListener('abort', cancel);
      client.stop();
      await rm(directory, { recursive: true, force: true });
    }
  }
}
