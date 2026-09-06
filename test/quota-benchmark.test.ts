import assert from 'node:assert/strict';
import test from 'node:test';
import { benchmarkFileSizeQuota } from '../src/quota-benchmark.js';

test('fails closed under a child file-size quota', { timeout: 45_000 }, async () => {
  if (process.platform !== 'darwin' && process.platform !== 'linux') return;
  const result = await benchmarkFileSizeQuota(128);
  assert.equal(result.quotaBytes, 65_536);
  assert.notEqual(result.childExitCode, 0);
  assert.equal(result.finalOutputFileCount, 0);
  assert.equal(result.stagingDirectoryCount, 0);
  assert.equal(result.rejectedByIntegrity, true);
});
