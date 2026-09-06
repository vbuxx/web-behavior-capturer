import assert from 'node:assert/strict';
import test from 'node:test';
import { runFailureInjection } from '../src/failure-benchmark.js';

test('cleans staging and keeps final output invalid on injected ENOSPC boundaries', { timeout: 45_000 }, async () => {
  const results = await runFailureInjection();
  assert.deepEqual(results.map((result) => result.stage), ['before-contract', 'before-index']);
  for (const result of results) {
    assert.equal(result.childExitCode, 1);
    assert.equal(result.childExitSignal, null);
    assert.equal(result.finalOutputFileCount, 0);
    assert.equal(result.stagingDirectoryCount, 0);
    assert.equal(result.stagingFileCount, 0);
    assert.equal(result.rejectedByIntegrity, true);
    assert.match(result.rejectionMessage, /session-index\.json|checksum|schema|manifest/i);
  }
});
