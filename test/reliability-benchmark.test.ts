import assert from 'node:assert/strict';
import test from 'node:test';
import { benchmarkParallelCapture } from '../src/reliability-benchmark.js';

test('keeps parallel capture sessions isolated and reopenable', { timeout: 60_000 }, async () => {
  const result = await benchmarkParallelCapture(2, 1);
  assert.equal(result.failures.length, 0);
  assert.ok(result.peakRssBytes > 0);
  assert.ok(result.peakHeapUsedBytes > 0);
  assert.equal(result.sessions.length, 2);
  assert.ok(result.sessions.every((session) => session.integrity === 'verified'));
  assert.ok(result.sessions.every((session) => session.behaviors === 5));
  assert.ok(result.sessions.every((session) => session.droppedRecords === 0 && !session.knownLoss));
});
