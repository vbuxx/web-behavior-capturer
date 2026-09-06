import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { ErrorObject } from 'ajv';
import { repoRoot, verificationScenarioSchemaPath } from './paths.js';
import type { BehaviorKind } from './types.js';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020').default as new (options: object) => {
  compile(schema: object): ((value: unknown) => boolean) & { errors?: ErrorObject[] | null };
};

export interface VerificationScenario {
  scenarioId: string;
  behaviorId: string;
  kind: BehaviorKind;
  parameters: Record<string, unknown>;
}

export interface VerificationScenarioSuite {
  schemaVersion: '1.0.0';
  suiteId: string;
  viewport: { width: number; height: number };
  scenarios: VerificationScenario[];
}

export const defaultScenarioPath = resolve(repoRoot, 'scenarios/phase0-held-out.json');

export async function loadScenarioSuite(path = defaultScenarioPath): Promise<VerificationScenarioSuite> {
  const value = JSON.parse(await readFile(resolve(path), 'utf8')) as Partial<VerificationScenarioSuite>;
  const schema = JSON.parse(await readFile(verificationScenarioSchemaPath, 'utf8')) as object;
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  if (!validate(value)) {
    const message = validate.errors?.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
    throw new Error(`Verification scenario schema validation failed: ${message}`);
  }
  const suite = value as VerificationScenarioSuite;
  const ids = new Set<string>();
  for (const scenario of suite.scenarios) {
    if (!scenario.scenarioId || !scenario.behaviorId || !scenario.kind || !scenario.parameters) {
      throw new Error('Invalid verification scenario entry');
    }
    if (ids.has(scenario.scenarioId)) throw new Error(`Duplicate scenarioId ${scenario.scenarioId}`);
    ids.add(scenario.scenarioId);
  }
  return suite;
}

export function numberParameter(scenario: VerificationScenario, name: string): number {
  const value = scenario.parameters[name];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Scenario ${scenario.scenarioId} requires numeric parameter ${name}`);
  }
  return value;
}

export function numberArrayParameter(scenario: VerificationScenario, name: string): number[] {
  const value = scenario.parameters[name];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    throw new Error(`Scenario ${scenario.scenarioId} requires numeric array parameter ${name}`);
  }
  return value;
}
