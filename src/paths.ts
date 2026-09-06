import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolve(here, '..');
export const fixtureRoot = resolve(repoRoot, 'fixtures/phase0');
export const replicaRoot = resolve(repoRoot, 'fixtures/replica');
export const probesRoot = resolve(repoRoot, 'fixtures/probes');
export const loadFixtureRoot = resolve(repoRoot, 'fixtures/load');
export const reviewRoot = resolve(repoRoot, 'fixtures/review');
export const schemaPath = resolve(repoRoot, 'schema/behavior-contract.schema.json');
export const verificationScenarioSchemaPath = resolve(repoRoot, 'schema/verification-scenario.schema.json');
export const sessionIndexSchemaPath = resolve(repoRoot, 'schema/session-index.schema.json');
export const evidenceGraphSchemaPath = resolve(repoRoot, 'schema/evidence-graph.schema.json');
export const evaluationTaskSchemaPath = resolve(repoRoot, 'schema/evaluation-task.schema.json');
export const evaluationTaskSpecPath = resolve(repoRoot, 'fixtures/evaluation/task-spec.json');
