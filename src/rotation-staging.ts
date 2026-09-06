import { readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export interface RotationStagingCleanupResult {
  archiveDirectory: string;
  maxAgeMs: number;
  scanned: number;
  plannedRemovals: string[];
  removed: string[];
  retained: string[];
}

export async function cleanupRotationStaging(archiveDirectory: string, maxAgeMs = 86_400_000, options: { apply?: boolean } = {}): Promise<RotationStagingCleanupResult> {
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 1_000) throw new Error('Rotation staging cleanup age must be at least 1000 ms');
  const archiveRoot = resolve(archiveDirectory);
  const entries = await readdir(archiveRoot, { withFileTypes: true });
  const candidates = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith('.rotation-staging-'));
  const cutoff = Date.now() - maxAgeMs;
  const plannedRemovals: string[] = [];
  const retained: string[] = [];
  for (const entry of candidates) {
    const path = join(archiveRoot, entry.name);
    if ((await stat(path)).mtimeMs <= cutoff) {
      plannedRemovals.push(path);
    } else {
      retained.push(path);
    }
  }
  const removed = options.apply ? plannedRemovals : [];
  if (options.apply) for (const path of plannedRemovals) await rm(path, { recursive: true, force: true });
  return { archiveDirectory: archiveRoot, maxAgeMs, scanned: candidates.length, plannedRemovals, removed, retained };
}
