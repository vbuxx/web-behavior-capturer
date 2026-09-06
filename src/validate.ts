import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { ErrorObject } from 'ajv';
import type { ContractPackage, SessionIndexManifest } from './types.js';
import { schemaPath, sessionIndexSchemaPath } from './paths.js';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020').default as new (options: object) => {
  compile(schema: object): ((value: unknown) => boolean) & { errors?: ErrorObject[] | null };
};
const addFormats = require('ajv-formats').default as (ajv: object) => void;

async function validateAgainstSchema<T>(value: unknown, path: string, label: string): Promise<T> {
  const schema = JSON.parse(await readFile(path, 'utf8')) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(value)) {
    const message = validate.errors?.map((error: ErrorObject) => `${error.instancePath || '/'} ${error.message}`).join('; ');
    throw new Error(`${label} schema validation failed: ${message}`);
  }
  return value as T;
}

export async function validateSessionIndexManifest(value: unknown): Promise<SessionIndexManifest> {
  return validateAgainstSchema<SessionIndexManifest>(value, sessionIndexSchemaPath, 'Session index manifest');
}

export async function validateContract(value: unknown): Promise<ContractPackage> {
  const contract = await validateAgainstSchema<ContractPackage>(value, schemaPath, 'Behavior Contract');
  const elementIds = new Set(contract.elements.map((element) => element.id));
  const evidenceIds = new Set(contract.evidenceIndex.map((entry) => entry.id));
  const targetIds = new Set(contract.manifest.targetCoverage.map((target) => target.targetId));
  const targetNavigationIds = new Set(contract.manifest.targetCoverage.map((target) => target.navigationId));

  if (targetIds.size !== contract.manifest.targetCoverage.length) {
    throw new Error('Target coverage contains duplicate target IDs');
  }
  if (targetNavigationIds.size !== contract.manifest.targetCoverage.length) {
    throw new Error('Target coverage contains duplicate navigation IDs');
  }
  const mainTargets = contract.manifest.targetCoverage.filter((target) => target.kind === 'main_frame');
  if (mainTargets.length !== 1 || mainTargets[0]?.parentTargetId !== null) {
    throw new Error('Target coverage must contain exactly one parentless main frame');
  }
  for (const target of contract.manifest.targetCoverage) {
    if (target.parentTargetId !== null && !targetIds.has(target.parentTargetId)) {
      throw new Error(`Target ${target.targetId} has missing parent ${target.parentTargetId}`);
    }
    if (target.collector.knownLoss !== (target.collector.droppedRecords > 0)) {
      throw new Error(`Target ${target.targetId} has inconsistent loss status`);
    }
    if (target.collector.status === 'failed' && (target.completeness !== 'partial' || target.gaps.length === 0)) {
      throw new Error(`Failed target ${target.targetId} must report partial coverage and a gap`);
    }
    if (target.lifecycleStatus === 'active' && (target.detachedAt || target.coverageEnd)) {
      throw new Error(`Active target ${target.targetId} cannot have an end boundary`);
    }
    if (target.lifecycleStatus !== 'active') {
      if (!target.detachedAt || !target.coverageEnd || target.completeness !== 'partial' || target.gaps.length === 0) {
        throw new Error(`Archived target ${target.targetId} must expose end boundaries and a coverage gap`);
      }
      if (target.coverageEnd.value > target.detachedAt.value) {
        throw new Error(`Target ${target.targetId} coverage ends after detach`);
      }
    }
  }
  const targetDroppedRecords = contract.manifest.targetCoverage.reduce((sum, target) => sum + target.collector.droppedRecords, 0);
  if (contract.manifest.quality.droppedRecords !== targetDroppedRecords
    || contract.manifest.quality.knownLoss !== (targetDroppedRecords > 0)) {
    throw new Error('Manifest loss summary does not match per-target coverage');
  }

  for (const behavior of contract.behaviors) {
    if (!elementIds.has(behavior.targetRef)) {
      throw new Error(`Behavior ${behavior.behaviorId} has missing targetRef ${behavior.targetRef}`);
    }
    if (behavior.trigger.targetRef !== 'viewport' && !elementIds.has(behavior.trigger.targetRef)) {
      throw new Error(`Behavior ${behavior.behaviorId} has missing trigger targetRef ${behavior.trigger.targetRef}`);
    }
    const refs = [
      ...behavior.trigger.evidenceRefs,
      ...behavior.provenance.evidenceRefs,
      ...behavior.visualEvidenceRefs,
      ...(behavior.interruption?.evidenceRefs ?? []),
    ];
    for (const ref of refs) {
      if (!evidenceIds.has(ref)) {
        throw new Error(`Behavior ${behavior.behaviorId} has missing evidence ref ${ref}`);
      }
    }
    if (behavior.provenance.status === 'extracted' && behavior.provenance.evidenceRefs.length === 0) {
      throw new Error(`Behavior ${behavior.behaviorId} is extracted without evidence`);
    }
  }

  return contract;
}
