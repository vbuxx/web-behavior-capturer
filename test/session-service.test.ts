import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { SessionService } from '../src/session-service.js';
import { inspectSessionPackage } from '../src/session-index.js';

test('session service returns immutable snapshot summaries and exports only verified packages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wbc-service-'));
  try {
    const service = new SessionService({ workspaceRoot: process.cwd(), jobStorePath: join(root, 'jobs.json') });
    const listed = await service.listBehaviors('artifacts/phase1/latest', { limit: 2 });
    assert.equal(listed.snapshot.contractSchemaVersion, '1.5.0');
    assert.equal(listed.behaviors.length, 2);
    const behavior = await service.getBehavior('artifacts/phase1/latest', 'hover-card-enter');
    assert.equal(behavior.behavior.kind, 'hover');
    const evidence = await service.getEvidence('artifacts/phase1/latest', { limit: 1, byteBudget: 32_000 });
    assert.equal(evidence.page.records.length, 1);
    const exported = await service.exportCapture('artifacts/phase1/latest', join(root, 'exported'));
    assert.equal((await inspectSessionPackage(exported.destinationPath)).integrity, 'verified');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('probe job writes a new contract revision without replacing the base contract', { timeout: 45_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'wbc-probe-service-'));
  try {
    await cp(join(process.cwd(), 'artifacts/phase1/latest'), join(root, 'package'), { recursive: true });
    const service = new SessionService({ workspaceRoot: root, jobStorePath: join(root, 'jobs.json') });
    const job = await service.runProbe('package');
    let final = await service.status(job.jobId);
    for (let attempt = 0; attempt < 300 && ['queued', 'running', 'finalizing'].includes(final.status); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      final = await service.status(job.jobId);
    }
    assert.notEqual(final.status, 'running');
    assert.ok(typeof final.result?.revisionId === 'string');
    const revisionContract = String(final.result?.contractPath);
    const revision = JSON.parse(await readFile(revisionContract, 'utf8')) as { manifest: { revision?: string; probeRun?: { path: string } } };
    assert.equal(revision.manifest.revision, final.result?.revisionId);
    assert.ok(revision.manifest.probeRun?.path.includes('technical-probe-report.json'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
