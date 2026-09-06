import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { benchmarkPackageCorruption } from '../src/corruption-benchmark.js';

test('rejects corruption of every persisted package artifact', { timeout: 30_000 }, async () => {
  const result = await benchmarkPackageCorruption(join(process.cwd(), 'artifacts/phase1/latest'));
  assert.equal(result.sourceIntegrity, 'verified');
  assert.deepEqual(result.cases.map((item) => item.kind), ['contract', 'session-index', 'evidence', 'visual']);
  assert.ok(result.cases.every((item) => item.accepted === false));
  assert.ok(result.cases.every((item) => /checksum|evidence/i.test(item.rejectionMessage)));
});
