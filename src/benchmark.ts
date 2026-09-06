import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { inspectSessionPackage, querySessionBehaviors, querySessionRecords } from './session-index.js';
import { buildSessionIndex } from './session-index.js';
import { validateContract } from './validate.js';
import type { ContractPackage, EvidenceRecord } from './types.js';

export interface BenchmarkResult {
  packageDirectory: string;
  iterations: number;
  counts: { targets: number; elements: number; behaviors: number; evidence: number; records: number };
  packageBytes?: number;
  latencyMs: {
    startupIntegrity: { median: number; p95: number; samples: number[] };
    behaviorQuery: { median: number; p95: number; samples: number[] };
    evidenceQuery: { median: number; p95: number; samples: number[] };
    total: { median: number; p95: number; samples: number[] };
  };
}

export interface SyntheticBenchmarkOptions {
  sourcePackage: string;
  records: number;
  evidenceMb: number;
  iterations?: number;
}

async function directoryBytes(directory: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    total += entry.isDirectory() ? await directoryBytes(path) : (await stat(path)).size;
  }
  return total;
}

function percentile(values: number[], percentileValue: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return Number((sorted[index] ?? 0).toFixed(3));
}

function summary(samples: number[]): { median: number; p95: number; samples: number[] } {
  return {
    median: percentile(samples, 50),
    p95: percentile(samples, 95),
    samples: samples.map((sample) => Number(sample.toFixed(3))),
  };
}

export async function benchmarkSessionPackage(packageDirectory: string, iterations = 3): Promise<BenchmarkResult> {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 20) {
    throw new Error('Benchmark iterations must be an integer from 1 to 20');
  }
  const startup: number[] = [];
  const behavior: number[] = [];
  const evidence: number[] = [];
  const total: number[] = [];
  let counts: BenchmarkResult['counts'] | undefined;
  for (let index = 0; index < iterations; index += 1) {
    const totalStart = performance.now();
    const startupStart = performance.now();
    const inspection = await inspectSessionPackage(packageDirectory);
    startup.push(performance.now() - startupStart);
    counts ??= inspection.counts;

    const behaviorStart = performance.now();
    await querySessionBehaviors(packageDirectory, { limit: 100 });
    behavior.push(performance.now() - behaviorStart);

    const evidenceStart = performance.now();
    await querySessionRecords(packageDirectory, { limit: 20, byteBudget: 64 * 1024 });
    evidence.push(performance.now() - evidenceStart);
    total.push(performance.now() - totalStart);
  }
  return {
    packageDirectory,
    iterations,
    counts: counts!,
    latencyMs: {
      startupIntegrity: summary(startup),
      behaviorQuery: summary(behavior),
      evidenceQuery: summary(evidence),
      total: summary(total),
    },
  };
}

export async function createSyntheticSessionPackage(options: SyntheticBenchmarkOptions): Promise<string> {
  if (!Number.isInteger(options.records) || options.records < 1) throw new Error('Synthetic records must be a positive integer');
  if (!Number.isFinite(options.evidenceMb) || options.evidenceMb <= 0 || options.evidenceMb > 120) {
    throw new Error('Synthetic evidence size must be greater than 0 and no more than 120 MB');
  }
  const sourceRoot = resolve(options.sourcePackage);
  const outputRoot = await mkdtemp('/tmp/wbc-synthetic-');
  await cp(sourceRoot, outputRoot, { recursive: true });
  const contractPath = join(outputRoot, 'behavior-contract.json');
  const contract = JSON.parse(await readFile(contractPath, 'utf8')) as ContractPackage;
  const eventLines = (await readFile(join(outputRoot, 'evidence/events.jsonl'), 'utf8'))
    .split('\n').filter(Boolean).map((line) => JSON.parse(line) as EvidenceRecord);
  if (eventLines.length === 0) throw new Error('Source package has no evidence records');

  const syntheticPath = join(outputRoot, 'evidence/synthetic-load.ndjson');
  const targetBytes = Math.floor(options.evidenceMb * 1024 * 1024);
  const chunk = Buffer.from(`${JSON.stringify({ synthetic: true, payload: 'wbc-load-fixture' })}\n`, 'utf8');
  const syntheticBytes = Buffer.alloc(targetBytes);
  for (let offset = 0; offset < targetBytes; offset += chunk.byteLength) {
    chunk.copy(syntheticBytes, offset, 0, Math.min(chunk.byteLength, targetBytes - offset));
  }
  await writeFile(syntheticPath, syntheticBytes);
  const syntheticHash = createHash('sha256').update(syntheticBytes).digest('hex');
  contract.evidenceIndex.push({
    id: 'synthetic-load-evidence',
    path: 'evidence/synthetic-load.ndjson',
    mediaType: 'application/x-ndjson',
    sha256: syntheticHash,
  });

  const records: EvidenceRecord[] = Array.from({ length: options.records }, (_, index) => {
    const source = eventLines[index % eventLines.length]!;
    return {
      ...source,
      id: `synthetic:${index}:${source.id}`,
      sequence: index + 1,
      sourceTime: source.sourceTime + index,
      receiveTime: source.receiveTime + index,
      payload: { ...source.payload, syntheticIndex: index },
    };
  });
  contract.manifest.quality.recordCount = records.length;
  await validateContract(contract);
  await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
  await buildSessionIndex(outputRoot, contractPath, contract, records);
  return outputRoot;
}

export async function benchmarkSyntheticSessionPackage(options: SyntheticBenchmarkOptions): Promise<BenchmarkResult & { packageBytes: number }> {
  const packageDirectory = await createSyntheticSessionPackage(options);
  try {
    const result = await benchmarkSessionPackage(packageDirectory, options.iterations ?? 3);
    return { ...result, packageBytes: await directoryBytes(packageDirectory) };
  } finally {
    await rm(packageDirectory, { recursive: true, force: true });
  }
}
