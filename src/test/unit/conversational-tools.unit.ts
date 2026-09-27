import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { CodingAgentTools, InspectionConsent } from '../../conversational/tools';
import { deferred, flush } from './helpers';

const workspace = (branch = 'staging') => ({
  root: '/project/nexus',
  git: { directory: '/project/nexus/.git', branch },
});
const signal = () => new AbortController().signal;

suite('Brain coding agent tools', () => {
  test('status is passive and does not expose filesystem paths', async () => {
    let executions = 0;
    const tools = new CodingAgentTools({
      resolveWorkspace: async () => workspace(),
      inspector: { inspect: async () => String(++executions) },
      requestConsent: async () => {
        throw new Error('Status must not ask for consent');
      },
    });
    assert.deepEqual(await tools.getProjectStatus(signal()), {
      project: { name: 'nexus', branch: 'staging' },
      inspectionAvailable: true,
    });
    assert.equal(executions, 0);
  });

  test('inspection remains unavailable without a restricted adapter or consent handler', async () => {
    for (const options of [
      {},
      { inspector: { inspect: async () => assert.fail('Must not execute') } },
      { requestConsent: async () => true },
    ]) {
      const tools = new CodingAgentTools({ resolveWorkspace: async () => workspace(), ...options });
      assert.equal((await tools.getProjectStatus(signal())).inspectionAvailable, false);
      await assert.rejects(tools.inspectProject('Inspect sessions', signal()), /indisponible/);
    }
  });

  test('consent is scoped to the question and project, and each inspection asks again', async () => {
    const requests: InspectionConsent[] = [];
    const questions: string[] = [];
    const tools = new CodingAgentTools({
      resolveWorkspace: async () => workspace(),
      requestConsent: async (request) => {
        requests.push(request);
        return true;
      },
      inspector: {
        inspect: async (question, target) => {
          assert.deepEqual(target, workspace());
          questions.push(question);
          return 'Technical findings';
        },
      },
    });
    assert.equal(
      await tools.inspectProject('  Inspect sessions  ', signal()),
      'Technical findings'
    );
    await tools.inspectProject('Inspect tests', signal());
    assert.deepEqual(questions, ['Inspect sessions', 'Inspect tests']);
    assert.equal(requests[0].question, 'Inspect sessions');
    assert.deepEqual(requests[0].project, { name: 'nexus', branch: 'staging' });
    assert.notEqual(requests[0].id, requests[1].id);
  });

  test('refusal, UI failure and invalid questions never dispatch an inspection', async () => {
    let mode: 'refuse' | 'throw' = 'refuse';
    let approvals = 0;
    const tools = new CodingAgentTools({
      resolveWorkspace: async () => workspace(),
      requestConsent: async () => {
        approvals++;
        if (mode === 'throw') throw new Error('Offline');
        return false;
      },
      inspector: { inspect: async () => assert.fail('Must not execute') },
    });
    await assert.rejects(tools.inspectProject(' ', signal()), /caractères/);
    await assert.rejects(tools.inspectProject('x'.repeat(4001), signal()), /caractères/);
    assert.equal(approvals, 0);
    await assert.rejects(tools.inspectProject('Inspect', signal()), /non autorisée/);
    mode = 'throw';
    await assert.rejects(tools.inspectProject('Inspect', signal()), /non autorisée/);
  });

  test('a branch change while awaiting consent blocks execution', async () => {
    let branch = 'staging';
    const tools = new CodingAgentTools({
      resolveWorkspace: async () => workspace(branch),
      requestConsent: async () => {
        branch = 'other';
        return true;
      },
      inspector: { inspect: async () => assert.fail('Must not execute') },
    });
    await assert.rejects(tools.inspectProject('Inspect', signal()), { code: 'workspace_changed' });
  });

  test('a context change during inspection rejects the stale result', async () => {
    let branch = 'staging';
    const tools = new CodingAgentTools({
      resolveWorkspace: async () => workspace(branch),
      requestConsent: async () => true,
      inspector: {
        inspect: async () => {
          branch = 'other';
          return 'Stale result';
        },
      },
    });
    await assert.rejects(tools.inspectProject('Inspect', signal()), { code: 'workspace_changed' });
  });

  test('cancellation releases a stuck consent and ignores its later acceptance', async () => {
    const pending = deferred<boolean>();
    const controller = new AbortController();
    let consentSignal!: AbortSignal;
    const tools = new CodingAgentTools({
      resolveWorkspace: async () => workspace(),
      requestConsent: async (_request, value) => {
        consentSignal = value;
        return pending.promise;
      },
      inspector: { inspect: async () => assert.fail('Must not execute') },
    });
    const result = tools.inspectProject('Inspect', controller.signal);
    const failure = assert.rejects(result, { name: 'AbortError' });
    await flush();
    await assert.rejects(tools.inspectProject('Concurrent', signal()), /déjà en cours/);
    controller.abort();
    await failure;
    assert.equal(consentSignal.aborted, true);
    pending.resolve(true);
    await flush();
  });

  test('a consent that never settles expires and cannot be accepted late', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const pending = deferred<boolean>();
    const tools = new CodingAgentTools({
      resolveWorkspace: async () => workspace(),
      requestConsent: async () => pending.promise,
      inspector: { inspect: async () => assert.fail('Must not execute') },
    });
    const result = tools.inspectProject('Inspect', signal());
    const failure = assert.rejects(result, /expirée/);
    await flush();
    t.mock.timers.tick(60_000);
    await failure;
    pending.resolve(true);
    await flush();
  });

  test('a pre-aborted request never resolves the workspace', async () => {
    const tools = new CodingAgentTools({
      resolveWorkspace: async () => assert.fail('No preflight'),
    });
    const aborted = AbortSignal.abort();
    await assert.rejects(tools.getProjectStatus(aborted), { name: 'AbortError' });
    await assert.rejects(tools.inspectProject('Inspect', aborted), { name: 'AbortError' });
  });
});
