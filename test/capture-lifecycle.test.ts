import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
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
    await assert.rejects(captureSession(join(root, 'invalid'), { resumedFromSessionId: 'session-old', resumeCheckpoint: 'host-42' }), /source package/);
    const source = await captureSession(join(root, 'source'), { overheadRuns: 1 });
    const checkpoint = JSON.parse((await readFile(join(root, 'source', 'evidence', 'events.jsonl'), 'utf8')).split('\n').find(Boolean)!) as { id: string };
    const result = await captureSession(join(root, 'resumed'), {
      resumedFromSessionId: source.contract.manifest.sessionId,
      resumePackagePath: join(root, 'source'),
      resumeCheckpoint: checkpoint.id,
      overheadRuns: 1,
    });
    assert.equal(result.contract.manifest.resumedFromSessionId, source.contract.manifest.sessionId);
    assert.equal(result.contract.manifest.resumeCheckpoint, checkpoint.id);
    assert.notEqual(result.contract.manifest.sessionId, source.contract.manifest.sessionId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cancellation during stream flush is deterministic and removes staging', { timeout: 60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'wbc-cancel-flush-'));
  const output = join(root, 'cancelled-flush');
  const controller = new AbortController();
  const phases: string[] = [];
  try {
    await assert.rejects(
      captureSession(output, {
        enduranceDurationMs: 1_000,
        overheadRuns: 1,
        signal: controller.signal,
        onPhase: (phase) => {
          phases.push(phase);
          if (phase === 'before-stream-stop') controller.abort();
        },
      }),
      (error: unknown) => error instanceof CaptureCancelledError,
    );
    assert.deepEqual(phases, ['before-stream-stop']);
    assert.equal((await readdir(root)).some((entry) => entry.startsWith('cancelled-flush.staging-')), false);
    assert.equal((await readdir(root)).includes('cancelled-flush'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cancellation immediately before promotion never publishes a package', { timeout: 60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'wbc-cancel-promote-'));
  const output = join(root, 'cancelled-promote');
  const controller = new AbortController();
  try {
    await assert.rejects(
      captureSession(output, {
        enduranceDurationMs: 1_000,
        overheadRuns: 1,
        signal: controller.signal,
        onPhase: (phase) => {
          if (phase === 'before-promotion') controller.abort();
        },
      }),
      (error: unknown) => error instanceof CaptureCancelledError,
    );
    assert.equal((await readdir(root)).some((entry) => entry.startsWith('cancelled-promote.staging-')), false);
    assert.equal((await readdir(root)).includes('cancelled-promote'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
