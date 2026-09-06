import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultCodexCommand } from '../src/evaluation.js';
import { normalizeProbeRequest } from '../src/probes.js';

test('phase 2 default adapter forwards model and reasoning', () => {
  const command = defaultCodexCommand('gpt-5.6-sol', 'high');
  assert.match(command, /--model/);
  assert.match(command, /gpt-5\.6-sol/);
  assert.match(command, /model_reasoning_effort=high/);
  assert.match(command, /--sandbox workspace-write/);
});

test('probe request is bounded and recipe-controlled', () => {
  const plan = normalizeProbeRequest({
    resetRecipeId: 'nested-scroller-reverse',
    controlRun: true,
    timingOffsetsMs: [-20, 0, 20],
    directions: ['forward', 'reverse'],
    interruptionAtMs: [80],
    viewports: [{ width: 1100, height: 740 }],
    maxRuns: 6,
    timeoutMs: 10_000,
    behaviorIds: ['scroll-threshold-reveal'],
  });
  assert.equal(plan.controlRun, true);
  assert.deepEqual(plan.directions, ['forward', 'reverse']);
  assert.equal(plan.maxRuns, 6);
  assert.throws(() => normalizeProbeRequest({ resetRecipeId: 'arbitrary-javascript' }), /Unknown probe reset recipe/);
  assert.throws(() => normalizeProbeRequest({ maxRuns: 101 }), /maxRuns/);
});
