import * as assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
  AntigravityError,
  processError,
  sessionLostError,
  turnTimeoutError,
} from '../../antigravity/errors';

suite('Antigravity errors', () => {
  test('processError classifies ENOENT as not_installed with actionable guidance', () => {
    const error = processError({ code: 'ENOENT', message: 'spawn agy ENOENT' });
    assert.equal(error instanceof AntigravityError, true);
    assert.equal(error.code, 'not_installed');
    assert.match(error.message, /agy --version/);
  });

  test('processError classifies unexpected process errors as process_failed', () => {
    const error = processError(new Error('Process terminated unexpectedly'));
    assert.equal(error instanceof AntigravityError, true);
    assert.equal(error.code, 'process_failed');
    assert.match(error.message, /La connexion au processus Antigravity a été perdue/);
  });

  test('turnTimeoutError distinguishes confirmed vs unconfirmed termination', () => {
    const confirmed = turnTimeoutError(true);
    assert.equal(confirmed.code, 'turn_timeout');
    assert.match(confirmed.message, /Antigravity a confirmé la fin du turn/);

    const unconfirmed = turnTimeoutError(false);
    assert.equal(unconfirmed.code, 'turn_timeout');
    assert.match(unconfirmed.message, /fermé la connexion et demandé l’arrêt/);
  });

  test('sessionLostError provides recovery commands', () => {
    const error = sessionLostError('sess-42');
    assert.equal(error.code, 'session_lost');
    assert.match(error.message, /sess-42/);
    assert.match(error.message, /\/resume/);
    assert.match(error.message, /\/new/);
  });
});
