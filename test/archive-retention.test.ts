import assert from 'node:assert/strict';
import { cp, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { pruneVerifiedArchives } from '../src/archive-retention.js';

test('retains newest verified archives and quarantines invalid ones', async () => {
  const root = await mkdtemp('/tmp/wbc-retention-');
  const archive = join(root, 'archive');
  try {
    const source = join(process.cwd(), 'artifacts/phase1/latest');
    await cp(source, join(archive, 'archive-old'), { recursive: true });
    await cp(source, join(archive, 'archive-new'), { recursive: true });
    await cp(source, join(archive, 'archive-invalid'), { recursive: true });
    await writeFile(join(archive, 'archive-invalid', 'session.sqlite'), 'corrupted');
    const old = new Date(Date.now() - 20_000);
    await utimes(join(archive, 'archive-old'), old, old);
    const dryRun = await pruneVerifiedArchives(archive, 1);
    assert.equal(dryRun.plannedRemovals.length, 1);
    assert.equal(dryRun.removed.length, 0);
    assert.equal((await readdir(archive)).length, 3);
    const result = await pruneVerifiedArchives(archive, 1, { apply: true });
    assert.equal(result.scanned, 3);
    assert.equal(result.verified, 2);
    assert.equal(result.retained.length, 1);
    assert.equal(result.plannedRemovals.length, 1);
    assert.equal(result.removed.length, 1);
    assert.equal(result.quarantined.length, 1);
    assert.equal((await readdir(archive)).length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
