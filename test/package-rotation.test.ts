import assert from 'node:assert/strict';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { rotateSessionPackage } from '../src/package-rotation.js';
import { inspectSessionPackage } from '../src/session-index.js';

test('rotates only a verified package into an archive directory', async () => {
  const root = await mkdtemp('/tmp/wbc-rotation-');
  const source = join(root, 'current');
  const archive = join(root, 'archive');
  try {
    await cp(join(process.cwd(), 'artifacts/phase1/latest'), source, { recursive: true });
    const result = await rotateSessionPackage(source, archive);
    assert.equal(result.integrity, 'verified');
    assert.equal(result.mode, 'rename');
    assert.equal(result.counts.behaviors, 5);
    await assert.rejects(inspectSessionPackage(source), /session-index\.json|ENOENT/);
    const entries = await readdir(archive, { withFileTypes: true });
    assert.equal(entries.filter((entry) => entry.isDirectory()).length, 1);
    const archived = join(archive, entries.find((entry) => entry.isDirectory())!.name);
    assert.equal((await inspectSessionPackage(archived)).integrity, 'verified');

    const copySource = join(root, 'copy-current');
    await cp(join(process.cwd(), 'artifacts/phase1/latest'), copySource, { recursive: true });
    const copyArchive = join(root, 'copy-archive');
    const copied = await rotateSessionPackage(copySource, copyArchive, { forceCopyFallback: true });
    assert.equal(copied.mode, 'copy-verify-remove');
    assert.equal((await inspectSessionPackage(copied.archivePackage)).integrity, 'verified');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
