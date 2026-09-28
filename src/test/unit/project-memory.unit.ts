import * as assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { suite, test } from 'node:test';
import { ProjectMemory } from '../../memory/project-memory';
import { CodingAgentTools } from '../../conversational/tools';
import { ConversationalService } from '../../conversational/service';

suite('Project Decision Memory', () => {
  test('returns empty snapshot and hasMemory=false when memory.md is absent', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'nexus-memory-test-'));
    try {
      const memory = new ProjectMemory();
      assert.equal(memory.hasMemory(tempDir), false);
      assert.equal(memory.readMemory(tempDir), '');
      assert.deepEqual(memory.listDecisions(tempDir), []);

      const snapshot = memory.getSnapshot(tempDir);
      assert.equal(snapshot.rootPath, tempDir);
      assert.equal(snapshot.exists, false);
      assert.equal(snapshot.rawContent, '');
      assert.deepEqual(snapshot.decisions, []);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('records decisions and preserves structured fields across reads', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'nexus-memory-test-'));
    try {
      const memory = new ProjectMemory();
      const dec1 = memory.recordDecision(tempDir, {
        title: 'Choix de SQLite',
        decision: 'Utiliser SQLite local pour le stockage des sessions et états.',
        context: 'Besoin d’une solution sans daemon externe pour un démarrage rapide.',
        status: 'accepted',
      });

      assert.equal(dec1.title, 'Choix de SQLite');
      assert.equal(dec1.status, 'accepted');
      assert.equal(
        dec1.context,
        'Besoin d’une solution sans daemon externe pour un démarrage rapide.'
      );
      assert.ok(dec1.id.startsWith('dec-'));
      assert.match(dec1.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(memory.hasMemory(tempDir), true);

      // Record a second decision with superseded status
      const dec2 = memory.recordDecision(tempDir, {
        title: 'Format de sérialisation JSON',
        decision: 'Utiliser JSON standard pour les échanges WebSocket.',
        status: 'superseded',
      });

      assert.equal(dec2.title, 'Format de sérialisation JSON');
      assert.equal(dec2.status, 'superseded');

      const decisions = memory.listDecisions(tempDir);
      assert.equal(decisions.length, 2);
      assert.equal(decisions[0].id, dec1.id);
      assert.equal(decisions[0].title, 'Choix de SQLite');
      assert.equal(decisions[0].status, 'accepted');
      assert.equal(decisions[1].id, dec2.id);
      assert.equal(decisions[1].title, 'Format de sérialisation JSON');
      assert.equal(decisions[1].status, 'superseded');

      const snapshot = memory.getSnapshot(tempDir);
      assert.equal(snapshot.exists, true);
      assert.equal(snapshot.decisions.length, 2);
      assert.ok(snapshot.rawContent.includes('# Mémoire de Décisions Nexus'));
      assert.ok(snapshot.rawContent.includes('### ['));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('validates required fields on recordDecision', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'nexus-memory-test-'));
    try {
      const memory = new ProjectMemory();
      assert.throws(() => {
        memory.recordDecision(tempDir, { title: '  ', decision: 'Valid decision' });
      }, /titre/);

      assert.throws(() => {
        memory.recordDecision(tempDir, { title: 'Valid title', decision: '   ' });
      }, /corps/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('clearMemory resets memory.md to initial header', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'nexus-memory-test-'));
    try {
      const memory = new ProjectMemory();
      memory.recordDecision(tempDir, {
        title: 'Architecture hexagonale',
        decision: 'Séparer strictement domaine et adapters.',
      });

      assert.equal(memory.listDecisions(tempDir).length, 1);

      memory.clearMemory(tempDir);
      assert.equal(memory.hasMemory(tempDir), true);
      assert.equal(memory.listDecisions(tempDir).length, 0);
      assert.ok(memory.readMemory(tempDir).includes('# Mémoire de Décisions Nexus'));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('CodingAgentTools exposes project memory query and record methods', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'nexus-memory-test-'));
    const signal = new AbortController().signal;
    try {
      const memory = new ProjectMemory();
      const tools = new CodingAgentTools({
        resolveWorkspace: async () => ({
          root: tempDir,
          git: { directory: join(tempDir, '.git'), branch: 'staging' },
        }),
        projectMemory: memory,
      });

      const initialSnapshot = await tools.getProjectMemory(signal);
      assert.equal(initialSnapshot.exists, false);
      assert.equal(initialSnapshot.decisions.length, 0);

      const recorded = await tools.recordDecision(
        {
          title: 'Adoption de Tailwind CSS',
          decision: 'Migrer vers Tailwind pour le style web.',
          context: 'Amélioration de la vélocité UI.',
        },
        signal
      );

      assert.equal(recorded.title, 'Adoption de Tailwind CSS');
      assert.equal(recorded.status, 'accepted');

      const updatedSnapshot = await tools.getProjectMemory(signal);
      assert.equal(updatedSnapshot.exists, true);
      assert.equal(updatedSnapshot.decisions.length, 1);
      assert.equal(updatedSnapshot.decisions[0].id, recorded.id);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('ConversationalService handles get_project_memory and record_decision actions', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'nexus-memory-test-'));
    const signal = new AbortController().signal;
    try {
      const memory = new ProjectMemory();
      const tools = new CodingAgentTools({
        resolveWorkspace: async () => ({
          root: tempDir,
          git: { directory: join(tempDir, '.git'), branch: 'staging' },
        }),
        projectMemory: memory,
      });

      let step = 0;
      const service = new ConversationalService(
        {
          decide: async (messages) => {
            if (step === 0) {
              step++;
              return { action: 'get_project_memory', text: '' };
            }
            if (step === 1) {
              step++;
              const lastTool = messages.at(-1)!;
              assert.match(lastTool.text, /decisions/);
              return {
                action: 'record_decision',
                text: JSON.stringify({
                  title: 'WebSocket binaire',
                  decision: 'Encapsuler l’audio en chunks Opus.',
                  context: 'Latence réduite sur réseau mobile.',
                }),
              };
            }
            const lastTool = messages.at(-1)!;
            assert.match(lastTool.text, /WebSocket binaire/);
            return {
              action: 'reply',
              text: 'Décision enregistrée avec succès dans la mémoire du projet.',
            };
          },
        },
        tools
      );

      const reply = await service.respond(
        {
          conversationId: 'conv-memory',
          message: 'Enregistre notre décision technique',
          project: { name: 'test-project', branch: 'staging' },
        },
        signal
      );

      assert.match(reply.text, /enregistrée avec succès/);
      assert.equal(memory.listDecisions(tempDir).length, 1);
      assert.equal(memory.listDecisions(tempDir)[0].title, 'WebSocket binaire');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
