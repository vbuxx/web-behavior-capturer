import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { evaluatePhase2 } from '../src/evaluation.js';

test('evaluation separates verifier measurements from unavailable agent baselines', { timeout: 90_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'wbc-evaluation-'));
  try {
    const reportPath = join(root, 'report.json');
    const report = await evaluatePhase2('artifacts/phase1/latest', reportPath, 1);
    assert.equal(report.conditions.wbc.agentSuccess, 'not_measured');
    assert.equal(report.conditions.screenshot.status, 'unavailable');
    assert.equal(report.fixtureMatrix.length, 12);
    assert.equal(JSON.parse(await readFile(reportPath, 'utf8')).schemaVersion, '1.2.0');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
