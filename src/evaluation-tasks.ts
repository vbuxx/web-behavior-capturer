import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { ErrorObject } from 'ajv';
import { evaluationTaskSchemaPath, evaluationTaskSpecPath, repoRoot } from './paths.js';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020').default as new (options: object) => {
  compile(schema: object): ((value: unknown) => boolean) & { errors?: ErrorObject[] | null };
};

export type EvaluationCondition = 'screenshot' | 'trace' | 'wbc';
export type EvaluationTaskStatus = 'supported' | 'partial' | 'unknown' | 'unsupported';

export interface EvaluationTask {
  id: string;
  status: EvaluationTaskStatus;
  starterPath: string;
  referencePath: string;
  groundTruthPath: string;
  captureRecipeId: string;
  behaviorId?: string;
  scenarioIds: string[];
  evidenceAllowlist: Record<EvaluationCondition, string[]>;
}

export interface EvaluationTaskSpec {
  schemaVersion: '1.0.0';
  tasks: EvaluationTask[];
}

function withinRepo(path: string): string {
  const absolute = resolve(repoRoot, path);
  const rel = relative(repoRoot, absolute);
  if (isAbsolute(rel) || rel.startsWith('..') || rel.includes(`..${sep}`)) {
    throw new Error(`Evaluation task path escapes repository: ${path}`);
  }
  return absolute;
}

export async function loadEvaluationTaskSpec(path = evaluationTaskSpecPath): Promise<EvaluationTaskSpec> {
  const value = JSON.parse(await readFile(resolve(path), 'utf8')) as unknown;
  const schema = JSON.parse(await readFile(evaluationTaskSchemaPath, 'utf8')) as object;
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  if (!validate(value)) {
    const message = validate.errors?.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
    throw new Error(`Evaluation task specification validation failed: ${message}`);
  }
  const spec = value as EvaluationTaskSpec;
  const ids = new Set<string>();
  for (const task of spec.tasks) {
    if (ids.has(task.id)) throw new Error(`Duplicate evaluation task: ${task.id}`);
    ids.add(task.id);
    for (const candidate of [task.starterPath, task.referencePath, task.groundTruthPath]) {
      const resolved = withinRepo(candidate);
      try { await stat(resolved); } catch { throw new Error(`Evaluation task path does not exist: ${candidate}`); }
    }
    for (const pattern of Object.values(task.evidenceAllowlist).flat()) {
      if (pattern.startsWith('/') || pattern.includes('..')) throw new Error(`Evaluation evidence allowlist escapes bundle: ${pattern}`);
    }
  }
  if (ids.size !== 12) throw new Error(`Evaluation task specification must contain exactly 12 tasks, got ${ids.size}`);
  return spec;
}

export function taskForId(spec: EvaluationTaskSpec, taskId: string): EvaluationTask {
  const task = spec.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error(`Unknown evaluation task: ${taskId}`);
  return task;
}

export function taskPath(task: EvaluationTask, field: 'starterPath' | 'referencePath' | 'groundTruthPath'): string {
  return withinRepo(task[field]);
}
