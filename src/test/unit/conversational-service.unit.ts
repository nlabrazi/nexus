import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { ConversationalService } from '../../conversational/service';
import { CodingAgentTools } from '../../conversational/tools';
import { BrainDecision, BrainMessage } from '../../conversational/model';
import {
  FileBrainSessionPersistence,
  MemoryBrainSessionPersistence,
} from '../../conversational/persistence';
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

  test('list_projects and switch_project are executed and results returned to the model', async () => {
    let currentProject = 'nexus';
    const tools = new CodingAgentTools({
      resolveWorkspace: async () => ({ root: `/projects/${currentProject}` }),
      listProjects: () => [
        {
          id: 'nexus',
          name: 'nexus',
          path: '/projects/nexus',
          isCurrent: currentProject === 'nexus',
        },
        {
          id: 'riftvision',
          name: 'riftvision',
          path: '/projects/riftvision',
          isCurrent: currentProject === 'riftvision',
        },
      ],
      switchProject: (target) => {
        currentProject = target;
        return { id: target, name: target, path: `/projects/${target}`, isCurrent: true };
      },
    });

    let step = 0;
    const service = new ConversationalService(
      {
        decide: async (messages) => {
          if (step === 0) {
            step++;
            return { action: 'list_projects', text: '' };
          }
          if (step === 1) {
            step++;
            assert.match(messages.at(-1)!.text, /riftvision/);
            return { action: 'switch_project', text: 'riftvision' };
          }
          assert.match(messages.at(-1)!.text, /riftvision/);
          return { action: 'reply', text: 'Contexte basculé sur riftvision !' };
        },
      },
      tools
    );

    const reply = await service.respond(input('Bascule sur riftvision'), signal());
    assert.equal(reply.text, 'Contexte basculé sur riftvision !');
    assert.equal(currentProject, 'riftvision');
  });

  test('persists conversation history across service instances and reloads upon restart', async () => {
    const persistence = new MemoryBrainSessionPersistence();
    const tools = new CodingAgentTools({
      resolveWorkspace: async () => target,
    });

    const service1 = new ConversationalService(
      {
        decide: async () => ({ action: 'reply', text: 'Première réponse' }),
      },
      tools,
      persistence
    );

    const reply1 = await service1.respond(
      input('Bonjour, retiens ce message', 'conv-p1'),
      signal()
    );
    assert.equal(reply1.text, 'Première réponse');

    // Recreate a new service instance (simulating restart) with the same persistence
    const seenMessages: BrainMessage[][] = [];
    const service2 = new ConversationalService(
      {
        decide: async (messages) => {
          seenMessages.push([...messages]);
          return { action: 'reply', text: 'Deuxième réponse avec contexte' };
        },
      },
      tools,
      persistence
    );

    const reply2 = await service2.respond(input('Que disais-je ?', 'conv-p1'), signal());
    assert.equal(reply2.text, 'Deuxième réponse avec contexte');
    assert.equal(seenMessages.length, 1);
    // Should have: previous user + previous assistant + new user
    assert.equal(seenMessages[0].length, 3);
    assert.equal(seenMessages[0][0].text, 'Bonjour, retiens ce message');
    assert.equal(seenMessages[0][1].text, 'Première réponse');
    assert.equal(seenMessages[0][2].text, 'Que disais-je ?');
  });

  test('/reset or reset clears conversation memory and persistence', async () => {
    const persistence = new MemoryBrainSessionPersistence();
    const tools = new CodingAgentTools({
      resolveWorkspace: async () => target,
    });

    const service = new ConversationalService(
      {
        decide: async () => ({ action: 'reply', text: 'Réponse' }),
      },
      tools,
      persistence
    );

    await service.respond(input('Premier message', 'conv-reset'), signal());
    assert.ok(persistence.load('conv-reset'));

    const resetReply = await service.respond(input('/reset', 'conv-reset'), signal());
    assert.match(resetReply.text, /réinitialisée/);
    assert.equal(persistence.load('conv-reset'), undefined);
    assert.equal(service.getConversationMessages('conv-reset'), undefined);
  });

  test('FileBrainSessionPersistence stores, bounds messages, compacts bulky tool results and clears', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'nexus-brain-file-test-'));
    try {
      const filePersistence = new FileBrainSessionPersistence(tempDir, 4);

      assert.equal(filePersistence.load('non-existent'), undefined);

      const bulkyObservation = JSON.stringify({
        action: 'inspect_project',
        question: 'analyse',
        result: 'A'.repeat(2000),
      });

      filePersistence.save({
        version: 1,
        conversationId: 'session:1',
        context: '{"name":"test"}',
        messages: [
          { role: 'user', text: 'msg1' },
          { role: 'assistant', text: 'resp1' },
          { role: 'tool', text: bulkyObservation },
          { role: 'user', text: 'msg2' },
          { role: 'assistant', text: 'resp2' },
          { role: 'user', text: 'msg3' },
        ],
        updatedAt: Date.now(),
      });

      const loaded = filePersistence.load('session:1');
      assert.ok(loaded);
      assert.equal(loaded.conversationId, 'session:1');
      // Max 4 messages bounded
      assert.equal(loaded.messages.length, 4);
      // Older tool message should be compacted if retained
      const toolMsg = loaded.messages.find((m) => m.role === 'tool');
      if (toolMsg) {
        assert.ok(toolMsg.text.length < 500);
        assert.match(toolMsg.text, /condensé/);
      }

      filePersistence.clear('session:1');
      assert.equal(filePersistence.load('session:1'), undefined);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
