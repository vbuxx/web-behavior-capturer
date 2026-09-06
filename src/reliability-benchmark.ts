import { performance } from 'node:perf_hooks';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { captureSession } from './capture.js';
import { inspectSessionPackage } from './session-index.js';

export interface ReliabilityBenchmarkResult {
  parallelism: number;
  cycles: number;
  totalWallMs: number;
  sessions: Array<{
    cycle: number;
    slot: number;
    finalizationMs: number;
    integrity: 'verified';
    behaviors: number;
    records: number;
    droppedRecords: number;
    knownLoss: boolean;
  }>;
  failures: Array<{ cycle: number; slot: number; message: string }>;
}

export async function benchmarkParallelCapture(parallelism = 2, cycles = 1): Promise<ReliabilityBenchmarkResult> {
  if (!Number.isInteger(parallelism) || parallelism < 1 || parallelism > 4) throw new Error('Parallelism must be 1 to 4');
  if (!Number.isInteger(cycles) || cycles < 1 || cycles > 3) throw new Error('Cycles must be 1 to 3');
  const root = await mkdtemp('/tmp/wbc-reliability-');
  const started = performance.now();
  const sessions: ReliabilityBenchmarkResult['sessions'] = [];
  const failures: ReliabilityBenchmarkResult['failures'] = [];
  try {
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      await Promise.all(Array.from({ length: parallelism }, async (_, slot) => {
        const output = join(root, `cycle-${cycle}-slot-${slot}`);
        const sessionStarted = performance.now();
        try {
          const capture = await captureSession(output, { overheadRuns: 1 });
          const inspection = await inspectSessionPackage(output);
          sessions.push({
            cycle, slot, finalizationMs: Number((performance.now() - sessionStarted).toFixed(3)),
            integrity: inspection.integrity, behaviors: inspection.counts.behaviors, records: inspection.counts.records,
            droppedRecords: capture.contract.manifest.quality.droppedRecords,
            knownLoss: capture.contract.manifest.quality.knownLoss,
          });
        } catch (error) {
          failures.push({ cycle, slot, message: error instanceof Error ? error.message : String(error) });
        }
      }));
    }
    sessions.sort((left, right) => left.cycle - right.cycle || left.slot - right.slot);
    return { parallelism, cycles, totalWallMs: Number((performance.now() - started).toFixed(3)), sessions, failures };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
