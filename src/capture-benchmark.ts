import { performance } from 'node:perf_hooks';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { captureSession } from './capture.js';
import { inspectSessionPackage } from './session-index.js';

export interface CaptureBenchmarkResult {
  overheadRuns: number;
  finalizationMs: number;
  artifactBytes: number;
  contractSchemaVersion: string;
  counts: { targets: number; elements: number; behaviors: number; evidence: number; records: number };
  quality: {
    droppedRecords: number;
    knownLoss: boolean;
    baselineP95FrameMs: number;
    captureP95FrameMs: number;
    degradationPercent: number;
  };
}

async function directoryBytes(directory: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    total += entry.isDirectory() ? await directoryBytes(path) : (await stat(path)).size;
  }
  return total;
}

export async function benchmarkCaptureFinalization(overheadRuns = 1): Promise<CaptureBenchmarkResult> {
  if (!Number.isInteger(overheadRuns) || overheadRuns < 1 || overheadRuns > 5) {
    throw new Error('Capture benchmark overhead runs must be 1 to 5');
  }
  const outputDirectory = await mkdtemp('/tmp/wbc-capture-benchmark-');
  const started = performance.now();
  try {
    const capture = await captureSession(outputDirectory, { overheadRuns });
    const inspection = await inspectSessionPackage(outputDirectory);
    return {
      overheadRuns,
      finalizationMs: Number((performance.now() - started).toFixed(3)),
      artifactBytes: await directoryBytes(outputDirectory),
      contractSchemaVersion: capture.contract.schemaVersion,
      counts: inspection.counts,
      quality: {
        droppedRecords: capture.contract.manifest.quality.droppedRecords,
        knownLoss: capture.contract.manifest.quality.knownLoss,
        ...capture.contract.manifest.quality.observerCost,
      },
    };
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
}
