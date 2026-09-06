import { readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { inspectSessionPackage } from './session-index.js';

export interface ArchiveRetentionResult {
  archiveDirectory: string;
  keep: number;
  scanned: number;
  verified: number;
  retained: string[];
  removed: string[];
  quarantined: string[];
}

export async function pruneVerifiedArchives(archiveDirectory: string, keep = 5): Promise<ArchiveRetentionResult> {
  if (!Number.isInteger(keep) || keep < 0 || keep > 1_000) throw new Error('Archive retention keep must be an integer from 0 to 1000');
  const archiveRoot = resolve(archiveDirectory);
  const entries = await readdir(archiveRoot, { withFileTypes: true });
  const candidates = entries.filter((entry) => entry.isDirectory());
  const verified: Array<{ path: string; mtimeMs: number }> = [];
  const quarantined: string[] = [];
  for (const entry of candidates) {
    const path = join(archiveRoot, entry.name);
    try {
      await inspectSessionPackage(path);
      verified.push({ path, mtimeMs: (await stat(path)).mtimeMs });
    } catch {
      quarantined.push(path);
    }
  }
  verified.sort((left, right) => right.mtimeMs - left.mtimeMs);
  const retained = verified.slice(0, keep).map((item) => item.path);
  const removed = verified.slice(keep).map((item) => item.path);
  for (const path of removed) await rm(path, { recursive: true, force: true });
  return { archiveDirectory: archiveRoot, keep, scanned: candidates.length, verified: verified.length, retained, removed, quarantined };
}
