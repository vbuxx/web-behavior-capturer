import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { cleanupRotationStaging } from '../src/rotation-staging.js';

test('cleans only expired rotation staging directories', async () => {
  const root = await mkdtemp('/tmp/wbc-rotation-staging-');
  const archive = join(root, 'archive');
  const expired = join(archive, '.rotation-staging-expired');
  const active = join(archive, '.rotation-staging-active');
  try {
    await mkdir(expired, { recursive: true });
    await mkdir(active, { recursive: true });
    const old = new Date(Date.now() - 10_000);
    await utimes(expired, old, old);
    const result = await cleanupRotationStaging(archive, 1_000);
    assert.equal(result.scanned, 2);
    assert.deepEqual(result.removed, [expired]);
    assert.deepEqual(result.retained, [active]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
