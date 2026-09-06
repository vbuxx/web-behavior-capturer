import assert from 'node:assert/strict';
import test from 'node:test';
import { loadEvaluationTaskSpec, taskForId, taskPath } from '../src/evaluation-tasks.js';

test('evaluation task specification validates twelve isolated tasks and safe paths', async () => {
  const spec = await loadEvaluationTaskSpec();
  assert.equal(spec.tasks.length, 12);
  const nested = taskForId(spec, 'nested-scroller-reverse');
  assert.equal(nested.captureRecipeId, 'nested-scroller-reverse');
  assert.ok(taskPath(nested, 'groundTruthPath').endsWith('/fixtures/evaluation/ground-truth.json'));
  assert.deepEqual(Object.keys(nested.evidenceAllowlist).sort(), ['screenshot', 'trace', 'wbc']);
});
