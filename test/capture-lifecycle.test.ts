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
