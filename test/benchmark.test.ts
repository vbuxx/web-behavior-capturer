import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { benchmarkSessionPackage, benchmarkSyntheticSessionPackage } from '../src/benchmark.js';

test('benchmarks verified package integrity and bounded queries', { timeout: 30_000 }, async () => {
  const result = await benchmarkSessionPackage(join(process.cwd(), 'artifacts/phase1/latest'), 2);
  assert.equal(result.iterations, 2);
  assert.equal(result.counts.behaviors, 5);
  assert.equal(result.counts.records, 291);
  assert.ok(result.latencyMs.startupIntegrity.p95 >= result.latencyMs.startupIntegrity.median);
  assert.ok(result.latencyMs.behaviorQuery.p95 >= result.latencyMs.behaviorQuery.median);
  assert.ok(result.latencyMs.evidenceQuery.p95 >= result.latencyMs.evidenceQuery.median);
});

test('creates and benchmarks a temporary synthetic load package', { timeout: 30_000 }, async () => {
  const result = await benchmarkSyntheticSessionPackage({
    sourcePackage: join(process.cwd(), 'artifacts/phase1/latest'),
    records: 500,
    evidenceMb: 1,
    iterations: 1,
  });
  assert.equal(result.counts.records, 500);
  assert.equal(result.packageBytes > 1_000_000, true);
  assert.equal(result.latencyMs.total.samples.length, 1);
});
