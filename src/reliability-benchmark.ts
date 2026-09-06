import { performance } from 'node:perf_hooks';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { captureSession } from './capture.js';
import { inspectSessionPackage } from './session-index.js';

export interface ReliabilityBenchmarkResult {
  parallelism: number;
  cycles: number;
  totalWallMs: number;
  peakRssBytes: number;
  peakHeapUsedBytes: number;
  peakOpenFileDescriptors: number | null;
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
  let peakRssBytes = 0;
  let peakHeapUsedBytes = 0;
  let peakOpenFileDescriptors: number | null = null;
  const sampleResources = async (): Promise<void> => {
    const memory = process.memoryUsage();
    peakRssBytes = Math.max(peakRssBytes, memory.rss);
    peakHeapUsedBytes = Math.max(peakHeapUsedBytes, memory.heapUsed);
    try {
      const descriptors = await readdir('/dev/fd');
      peakOpenFileDescriptors = Math.max(peakOpenFileDescriptors ?? 0, descriptors.length);
    } catch {
      // /dev/fd is not portable; null means the host did not expose it.
    }
  };
  await sampleResources();
  const sampler = setInterval(() => { void sampleResources(); }, 100);
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
    await sampleResources();
    return {
      parallelism, cycles, totalWallMs: Number((performance.now() - started).toFixed(3)),
      peakRssBytes, peakHeapUsedBytes, peakOpenFileDescriptors, sessions, failures,
    };
  } finally {
    clearInterval(sampler);
    await rm(root, { recursive: true, force: true });
  }
}
