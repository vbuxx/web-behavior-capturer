import { performance } from 'node:perf_hooks';
import { inspectSessionPackage, querySessionBehaviors, querySessionRecords } from './session-index.js';

export interface BenchmarkResult {
  packageDirectory: string;
  iterations: number;
  counts: { targets: number; elements: number; behaviors: number; evidence: number; records: number };
  latencyMs: {
    startupIntegrity: { median: number; p95: number; samples: number[] };
    behaviorQuery: { median: number; p95: number; samples: number[] };
    evidenceQuery: { median: number; p95: number; samples: number[] };
    total: { median: number; p95: number; samples: number[] };
  };
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
