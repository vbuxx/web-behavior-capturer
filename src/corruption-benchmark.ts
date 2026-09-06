import { appendFile, cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { inspectSessionPackage } from './session-index.js';
import type { ContractPackage } from './types.js';

export type CorruptionKind = 'contract' | 'session-index' | 'evidence' | 'visual';

export interface CorruptionResult {
  kind: CorruptionKind;
  mutatedPath: string;
  accepted: boolean;
  rejectionMessage: string;
}

export interface CorruptionBenchmarkResult {
  sourcePackage: string;
  sourceIntegrity: 'verified';
  cases: CorruptionResult[];
}

const visualPath = (contract: ContractPackage): string => {
  const visual = contract.evidenceIndex.find((evidence) => evidence.mediaType === 'image/png');
  if (!visual) throw new Error('Source package has no visual evidence to corrupt');
  return visual.path;
};

export async function benchmarkPackageCorruption(sourcePackage = 'artifacts/phase1/latest', kinds: CorruptionKind[] = ['contract', 'session-index', 'evidence', 'visual']): Promise<CorruptionBenchmarkResult> {
  const sourceRoot = resolve(sourcePackage);
  const sourceInspection = await inspectSessionPackage(sourceRoot);
  const contract = JSON.parse(await readFile(join(sourceRoot, 'behavior-contract.json'), 'utf8')) as ContractPackage;
  const cases: CorruptionResult[] = [];
  for (const kind of kinds) {
    const temporaryRoot = await mkdtemp('/tmp/wbc-corruption-');
    const packageRoot = join(temporaryRoot, 'package');
    await cp(sourceRoot, packageRoot, { recursive: true });
    const relativePath = kind === 'contract'
      ? 'behavior-contract.json'
      : kind === 'session-index'
        ? 'session.sqlite'
        : kind === 'evidence'
          ? 'evidence/events.jsonl'
          : visualPath(contract);
    const mutatedPath = join(packageRoot, relativePath);
    await appendFile(mutatedPath, kind === 'visual' ? Buffer.from([0]) : '\ncorrupted\n');
    let accepted = false;
    let rejectionMessage = 'Package unexpectedly accepted';
    try {
      await inspectSessionPackage(packageRoot);
      accepted = true;
    } catch (error) {
      rejectionMessage = error instanceof Error ? error.message : String(error);
    }
    cases.push({ kind, mutatedPath: relativePath, accepted, rejectionMessage });
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  return { sourcePackage: sourceRoot, sourceIntegrity: sourceInspection.integrity, cases };
}
