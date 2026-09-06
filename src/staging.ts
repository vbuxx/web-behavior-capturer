import { readdir, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

export interface StagingCleanupResult {
  outputDirectory: string;
  maxAgeMs: number;
  scanned: number;
  removed: string[];
  retained: string[];
}

export async function cleanupStagingOrphans(outputDirectory: string, maxAgeMs = 86_400_000): Promise<StagingCleanupResult> {
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 1_000) throw new Error('Staging cleanup age must be at least 1000 ms');
  const absoluteOutput = resolve(outputDirectory);
  const parent = dirname(absoluteOutput);
  const prefix = `${basename(absoluteOutput)}.staging-`;
  const entries = await readdir(parent, { withFileTypes: true });
  const candidates = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix));
  const cutoff = Date.now() - maxAgeMs;
  const removed: string[] = [];
  const retained: string[] = [];
  for (const entry of candidates) {
    const directory = join(parent, entry.name);
    const metadata = await stat(directory);
    if (metadata.mtimeMs <= cutoff) {
      await rm(directory, { recursive: true, force: true });
      removed.push(directory);
    } else {
      retained.push(directory);
    }
  }
  return { outputDirectory: absoluteOutput, maxAgeMs, scanned: candidates.length, removed, retained };
}
