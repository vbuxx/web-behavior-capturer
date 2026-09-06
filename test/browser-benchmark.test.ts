import assert from 'node:assert/strict';
import test from 'node:test';
import { benchmarkSyntheticBrowser } from '../src/browser-benchmark.js';

test('benchmarks a synthetic browser route with 5k nodes and 50 tracks', { timeout: 30_000 }, async () => {
  const result = await benchmarkSyntheticBrowser(1);
  assert.equal(result.nodeCount, 5011);
  assert.equal(result.trackCount, 50);
  assert.equal(result.observerDroppedRecords, 0);
  assert.ok(Number.isFinite(result.degradationPercent));
  assert.ok(result.observedPeakJsHeapBytes >= result.baselinePeakJsHeapBytes);
  assert.ok(result.observedPeakDomNodes >= result.baselinePeakDomNodes);
  assert.ok(result.observedPointerBursts > 0);
  assert.ok(result.baselineNavigationMs > 0);
  assert.ok(result.observedNavigationMs > 0);
});
