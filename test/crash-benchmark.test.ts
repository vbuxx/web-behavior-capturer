import assert from 'node:assert/strict';
import test from 'node:test';
import { runCrashInjection } from '../src/crash-benchmark.js';

test('does not promote a capture interrupted before finalization', { timeout: 30_000 }, async () => {
  const result = await runCrashInjection(15_000);
  assert.equal(result.childExitSignal, 'SIGKILL');
  assert.equal(result.childExitCode, null);
  assert.equal(result.partialOutputExists, true);
  assert.ok(result.partialFileCount > 0);
  assert.equal(result.rejectedByIntegrity, true);
  assert.match(result.rejectionMessage, /session-index\.json|checksum|schema|manifest/i);
});
