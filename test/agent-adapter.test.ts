import assert from 'node:assert/strict';
import test from 'node:test';
import { runAgentCommand } from '../src/agent-adapter.js';

test('agent adapter records process completion without persisting prompt or output', async () => {
  const result = await runAgentCommand({
    command: "node -e 'console.log(JSON.stringify({input_tokens: 12, output_tokens: 7}))'",
    cwd: process.cwd(),
    prompt: 'synthetic evaluation prompt',
    timeoutMs: 5_000,
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.inputTokens, 12);
  assert.equal(result.outputTokens, 7);
  assert.ok(result.stdoutBytes > 0);
});

test('agent adapter marks a timed out process explicitly', async () => {
  const result = await runAgentCommand({
    command: "node -e 'setTimeout(() => {}, 5000)'",
    cwd: process.cwd(),
    prompt: 'synthetic timeout prompt',
    timeoutMs: 1_000,
  });
  assert.equal(result.status, 'timeout');
});
