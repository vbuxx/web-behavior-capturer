import assert from 'node:assert/strict';
import test from 'node:test';
import { benchmarkCaptureFinalization } from '../src/capture-benchmark.js';

test('measures end-to-end capture finalization and verifies the temporary package', { timeout: 60_000 }, async () => {
  const result = await benchmarkCaptureFinalization(1);
  assert.equal(result.contractSchemaVersion, '1.6.0');
  assert.equal(result.counts.behaviors, 5);
  assert.equal(result.quality.droppedRecords, 0);
  assert.equal(result.quality.knownLoss, false);
  assert.ok(result.finalizationMs > 0);
  assert.ok(result.artifactBytes > 100_000);
});
