import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgressTracker } from '../app/utils/task-progress.mjs';

test('createProgressTracker initializes with empty steps', () => {
  const tracker = createProgressTracker();
  assert.deepEqual(tracker.getSteps(), []);
});

test('createProgressTracker adds and updates sequential steps with auto-completion of prior running steps', () => {
  const tracker = createProgressTracker();
  tracker.addStep('Initialisation du workspace', 'running', '⟳');
  
  let steps = tracker.getSteps();
  assert.equal(steps.length, 1);
  assert.equal(steps[0].text, 'Initialisation du workspace');
  assert.equal(steps[0].status, 'running');
  assert.equal(steps[0].icon, '⟳');

  // Adding next running step auto-marks first step as done
  tracker.addStep('Lecture des fichiers', 'running', '📁');
  steps = tracker.getSteps();
  assert.equal(steps.length, 2);
  assert.equal(steps[0].status, 'done');
  assert.equal(steps[0].icon, '✓');
  assert.equal(steps[1].text, 'Lecture des fichiers');
  assert.equal(steps[1].status, 'running');
});

test('createProgressTracker deduplicates identical sequential steps', () => {
  const tracker = createProgressTracker();
  tracker.addStep('Analyse…', 'running', '⟳');
  tracker.addStep('Analyse…', 'running', '⟳');

  const steps = tracker.getSteps();
  assert.equal(steps.length, 1);
});

test('createProgressTracker marks all steps complete on completion', () => {
  const tracker = createProgressTracker();
  tracker.addStep('Exécution', 'running', '⟳');
  tracker.complete('Succès');

  const steps = tracker.getSteps();
  assert.equal(steps.length, 2);
  assert.equal(steps[0].status, 'done');
  assert.equal(steps[1].text, 'Succès');
  assert.equal(steps[1].status, 'done');
  assert.equal(steps[1].icon, '✓');
});

test('createProgressTracker marks running steps failed on error', () => {
  const tracker = createProgressTracker();
  tracker.addStep('Exécution', 'running', '⟳');
  tracker.fail('Timeout');

  const steps = tracker.getSteps();
  assert.equal(steps.length, 2);
  assert.equal(steps[0].status, 'failed');
  assert.equal(steps[1].text, 'Timeout');
  assert.equal(steps[1].status, 'failed');
  assert.equal(steps[1].icon, '✕');
});

test('createProgressTracker bounds step history to 20 items', () => {
  const tracker = createProgressTracker();
  for (let i = 0; i < 25; i++) {
    tracker.addStep(`Étape ${i}`, 'running');
  }

  const steps = tracker.getSteps();
  assert.equal(steps.length, 20);
  assert.equal(steps[0].text, 'Étape 5');
  assert.equal(steps[19].text, 'Étape 24');
});

test('createProgressTracker clears all steps cleanly', () => {
  const tracker = createProgressTracker();
  tracker.addStep('Test', 'running');
  tracker.clear();
  assert.deepEqual(tracker.getSteps(), []);
});
