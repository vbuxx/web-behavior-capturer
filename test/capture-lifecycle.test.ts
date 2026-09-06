import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { captureSession, CaptureCancelledError } from '../src/capture.js';

test('cancellation before browser start is explicit and never promotes a package', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wbc-cancel-'));
  const output = join(root, 'cancelled');
  const controller = new AbortController();
  controller.abort();
  const states: string[] = [];
  try {
    await assert.rejects(
      captureSession(output, { signal: controller.signal, onStateChange: (state) => states.push(state) }),
      (error: unknown) => error instanceof CaptureCancelledError,
    );
    assert.deepEqual(states, ['stopping', 'cancelled']);
    assert.equal((await readdir(root)).some((entry) => entry.startsWith('cancelled.staging-')), false);
    assert.equal((await readdir(root)).includes('cancelled'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cancellation during browser capture closes the page and never promotes staging', { timeout: 45_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'wbc-cancel-active-'));
  const output = join(root, 'cancelled-active');
  const controller = new AbortController();
  const states: string[] = [];
  const timer = setTimeout(() => controller.abort(), 250);
  try {
    await assert.rejects(
      captureSession(output, { signal: controller.signal, onStateChange: (state) => states.push(state) }),
      (error: unknown) => error instanceof CaptureCancelledError,
    );
    assert.ok(states.includes('stopping'));
    assert.ok(states.includes('cancelled'));
    assert.equal((await readdir(root)).some((entry) => entry.startsWith('cancelled-active.staging-')), false);
    assert.equal((await readdir(root)).includes('cancelled-active'), false);
  } finally {
    clearTimeout(timer);
    await rm(root, { recursive: true, force: true });
  }
});

test('resume metadata requires a checkpoint and creates a new session revision', { timeout: 45_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'wbc-resume-'));
  try {
    await assert.rejects(captureSession(join(root, 'invalid'), { resumedFromSessionId: 'session-old' }), /checkpoint reference/);
    const result = await captureSession(join(root, 'resumed'), { resumedFromSessionId: 'session-old', resumeCheckpoint: 'host-42', overheadRuns: 1 });
    assert.equal(result.contract.manifest.resumedFromSessionId, 'session-old');
    assert.notEqual(result.contract.manifest.sessionId, 'session-old');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
