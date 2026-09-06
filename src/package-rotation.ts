import { cp, mkdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { inspectSessionPackage } from './session-index.js';

export interface PackageRotationResult {
  sourcePackage: string;
  archivePackage: string;
  sessionId: string;
  integrity: 'verified';
  mode: 'rename' | 'copy-verify-remove';
  counts: { targets: number; elements: number; behaviors: number; evidence: number; records: number };
}

export interface PackageRotationOptions {
  forceCopyFallback?: boolean;
}

export async function rotateSessionPackage(
  packageDirectory: string,
  archiveDirectory = `${resolve(packageDirectory)}.archive`,
  options: PackageRotationOptions = {},
): Promise<PackageRotationResult> {
  const sourcePackage = resolve(packageDirectory);
  const archiveRoot = resolve(archiveDirectory);
  const archiveRelative = relative(sourcePackage, archiveRoot);
  if (archiveRelative === '' || (!archiveRelative.startsWith(`..${sep}`) && archiveRelative !== '..')) {
    throw new Error('Archive directory must not be inside the source package');
  }
  const inspection = await inspectSessionPackage(sourcePackage);
  await mkdir(archiveRoot, { recursive: true });
  const archivePackage = resolve(archiveRoot, `${basename(sourcePackage)}-${inspection.sessionId}-${randomUUID()}`);
  let mode: PackageRotationResult['mode'] = 'rename';
  if (!options.forceCopyFallback) {
    try {
      await rename(sourcePackage, archivePackage);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      mode = 'copy-verify-remove';
    }
  } else {
    mode = 'copy-verify-remove';
  }
  if (mode === 'copy-verify-remove') {
    const stagingArchive = resolve(archiveRoot, `.rotation-staging-${randomUUID()}`);
    try {
      await cp(sourcePackage, stagingArchive, { recursive: true, errorOnExist: true });
      await inspectSessionPackage(stagingArchive);
      await rename(stagingArchive, archivePackage);
      await inspectSessionPackage(archivePackage);
      await rm(sourcePackage, { recursive: true, force: false });
    } catch (error) {
      await rm(stagingArchive, { recursive: true, force: true });
      throw error;
    }
  }
  return {
    sourcePackage,
    archivePackage,
    sessionId: inspection.sessionId,
    integrity: inspection.integrity,
    mode,
    counts: inspection.counts,
  };
}
