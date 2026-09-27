import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { ConversationalService } from '../../conversational/service';
import { CodingAgentTools } from '../../conversational/tools';
import { BrainDecision, BrainMessage } from '../../conversational/model';
import { deferred, flush } from './helpers';

const signal = () => new AbortController().signal;
const input = (message: string, id = 'dialogue', branch = 'staging') => ({
  conversationId: id,
  message,
  project: { name: 'nexus', branch },
});
const target = { root: '/project', git: { directory: '/project/.git', branch: 'staging' } };

suite('Nexus Brain conversation loop', () => {
  test('a clarification does not inspect the project and history belongs to Nexus', async () => {
    const seen: BrainMessage[][] = [];
    const tools = new CodingAgentTools({
      resolveWorkspace: async () => assert.fail('No project access'),
    });
    const service = new ConversationalService(
      {
        decide: async (messages) => {
          seen.push([...messages]);
          return { action: 'reply', text: 'Quelles décisions souhaites-tu conserver ?' };
        },
      },
      tools
    );
    await service.respond(input('Je veux une mémoire'), signal());
    await service.respond(input('Les décisions techniques'), signal());
    assert.equal(seen[1].length, 3);
    assert.equal(seen[1][0].text, 'Je veux une mémoire');
    await service.respond(input('Autre personne', 'other'), signal());
    assert.equal(seen[2].length, 1);
    await service.respond(input('Autre branche', 'dialogue', 'other'), signal());
    assert.equal(seen[3].length, 1);
  });

  test('inspection requires consent and its result is sent back to the model for synthesis', async () => {
    const steps: string[] = [];
    const tools = new CodingAgentTools({
      resolveWorkspace: async () => target,
      requestConsent: async () => {
        steps.push('consent');
        return true;
      },
      inspector: {
        inspect: async () => {
          steps.push('inspection');
          return 'Persistence is backend-specific';
        },
      },
    });
    let calls = 0;
    const service = new ConversationalService(
      {
        decide: async (messages) => {
          if (calls++ === 0)
            return { action: 'inspect_project', text: 'Comment sont persistées les sessions ?' };
          steps.push('synthesis');
          assert.match(messages.at(-1)!.text, /Persistence is backend-specific/);
          return {
            action: 'reply',
            text: 'Les sessions sont liées aux backends. Voici ma proposition.',
          };
        },
      },
      tools
    );
    assert.match(
      (await service.respond(input('Analyse les sessions'), signal())).text,
      /Voici ma proposition/
    );
    assert.deepEqual(steps, ['consent', 'inspection', 'synthesis']);
  });

  test('refused inspection is reported without execution or automatic retry', async () => {
    const tools = new CodingAgentTools({
      resolveWorkspace: async () => target,
      requestConsent: async () => false,
      inspector: { inspect: async () => assert.fail('No inspection') },
    });
    let calls = 0;
    const service = new ConversationalService(
      {
        decide: async (messages) => {
          if (calls++ === 0) return { action: 'inspect_project', text: 'Inspect' };
          assert.match(messages.at(-1)!.text, /non autorisée/);
          return { action: 'reply', text: 'Je reste sur une discussion générale.' };
        },
      },
      tools
    );
    assert.match(
      (await service.respond(input('Réfléchissons'), signal())).text,
      /discussion générale/
    );
  });

  test('repeated tool requests are bounded and never repeat an inspection', async () => {
    let inspections = 0;
    const tools = new CodingAgentTools({
      resolveWorkspace: async () => target,
      requestConsent: async () => true,
      inspector: { inspect: async () => String(++inspections) },
    });
    const service = new ConversationalService(
      { decide: async () => ({ action: 'inspect_project', text: 'Inspect' }) },
      tools
    );
    await assert.rejects(service.respond(input('Inspect'), signal()), /limite/);
    assert.equal(inspections, 1);
  });

  test('abort discards the turn history and prevents a late tool decision', async () => {
    const pending = deferred<BrainDecision>();
    let calls = 0;
    const tools = new CodingAgentTools({ resolveWorkspace: async () => assert.fail('No tool') });
    const service = new ConversationalService(
      {
        decide: async (messages) => {
          if (calls++ === 0) return pending.promise;
          assert.equal(messages.length, 1);
          return { action: 'reply', text: 'Nouveau tour' };
        },
      },
      tools
    );
    const controller = new AbortController();
    const result = service.respond(input('Ancien tour'), controller.signal);
    const failure = assert.rejects(result, { name: 'AbortError' });
    await flush();
    await assert.rejects(service.respond(input('Concurrent'), signal()), /déjà en cours/);
    controller.abort();
    pending.resolve({ action: 'inspect_project', text: 'Late inspection' });
    await failure;
    await service.respond(input('Nouveau tour'), signal());
  });
});
