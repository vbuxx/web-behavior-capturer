import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { inspectSessionPackage } from '../src/session-index.js';
import { recoverRotationMarkers, writeRotationMarker } from '../src/rotation-recovery.js';

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

test('rotation recovery promotes verified staging and removes only a verified duplicate with --apply', async () => {
  const root = '/tmp/wbc-rotation-recovery-test';
  await rm(root, { recursive: true, force: true });
  const source = join(root, 'current');
  const archive = join(root, 'archive');
  const staging = join(archive, '.rotation-staging-fixture');
  const archived = join(archive, 'current-session');
  try {
    await cp(join(process.cwd(), 'artifacts/phase1/latest'), source, { recursive: true });
    await mkdir(archive, { recursive: true });
    await cp(source, staging, { recursive: true });
    const session = await inspectSessionPackage(source);
    const sourceChecksum = createHash('sha256').update(await readFile(join(source, 'session-index.json'))).digest('hex');
    await writeRotationMarker(archive, {
      markerId: 'fixture',
      sourcePackage: source,
      stagingPackage: staging,
      archivePackage: archived,
      sessionId: session.sessionId,
      sourceChecksum,
      phase: 'verified',
    });

    const dryRun = await recoverRotationMarkers(archive);
    assert.equal(dryRun.dryRun, true);
    assert.equal(dryRun.items[0]?.action, 'promote');
    assert.equal(await exists(staging), true);
    assert.equal(await exists(archived), false);

    const promoted = await recoverRotationMarkers(archive, { apply: true });
    assert.equal(promoted.items[0]?.applied, true);
    assert.equal((await inspectSessionPackage(archived)).integrity, 'verified');
    assert.equal(await exists(source), true);

    const duplicate = await recoverRotationMarkers(archive);
    assert.equal(duplicate.items[0]?.action, 'duplicate');
    const removed = await recoverRotationMarkers(archive, { apply: true });
    assert.equal(removed.items[0]?.applied, true);
    assert.equal(await exists(source), false);
    assert.equal((await readdir(archive)).some((name) => name.startsWith('.rotation-marker-')), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
