import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { cleanupStagingOrphans } from '../src/staging.js';

test('removes only age-expired staging orphans', async () => {
  const root = await mkdtemp('/tmp/wbc-staging-test-');
  const output = join(root, 'capture');
  const expired = `${output}.staging-expired`;
  const active = `${output}.staging-active`;
  try {
    await mkdir(expired, { recursive: true });
    await mkdir(active, { recursive: true });
    await writeFile(join(expired, 'partial.json'), '{}');
    await writeFile(join(active, 'partial.json'), '{}');
    const old = new Date(Date.now() - 10_000);
    await utimes(expired, old, old);
    const dryRun = await cleanupStagingOrphans(output, 1_000);
    assert.deepEqual(dryRun.plannedRemovals, [expired]);
    assert.deepEqual(dryRun.removed, []);
    const result = await cleanupStagingOrphans(output, 1_000, { apply: true });
    assert.equal(result.scanned, 2);
    assert.deepEqual(result.removed, [expired]);
    assert.deepEqual(result.retained, [active]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
