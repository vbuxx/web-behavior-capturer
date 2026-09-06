import { mkdir, rename } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { inspectSessionPackage } from './session-index.js';

export interface PackageRotationResult {
  sourcePackage: string;
  archivePackage: string;
  sessionId: string;
  integrity: 'verified';
  counts: { targets: number; elements: number; behaviors: number; evidence: number; records: number };
}

export async function rotateSessionPackage(packageDirectory: string, archiveDirectory = `${resolve(packageDirectory)}.archive`): Promise<PackageRotationResult> {
  const sourcePackage = resolve(packageDirectory);
  const archiveRoot = resolve(archiveDirectory);
  const archiveRelative = relative(sourcePackage, archiveRoot);
  if (archiveRelative === '' || (!archiveRelative.startsWith(`..${sep}`) && archiveRelative !== '..')) {
    throw new Error('Archive directory must not be inside the source package');
  }
  const inspection = await inspectSessionPackage(sourcePackage);
  await mkdir(archiveRoot, { recursive: true });
  const archivePackage = resolve(archiveRoot, `${basename(sourcePackage)}-${inspection.sessionId}-${randomUUID()}`);
  await rename(sourcePackage, archivePackage);
  return {
    sourcePackage,
    archivePackage,
    sessionId: inspection.sessionId,
    integrity: inspection.integrity,
    counts: inspection.counts,
  };
}
