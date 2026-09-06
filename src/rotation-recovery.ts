import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { inspectSessionPackage } from './session-index.js';

export const ROTATION_MARKER_SCHEMA_VERSION = '1.0.0';
export type RotationPhase = 'copying' | 'verified' | 'promoted' | 'source_removed';

export interface RotationMarker {
  schemaVersion: typeof ROTATION_MARKER_SCHEMA_VERSION;
  markerId: string;
  sourcePackage: string;
  stagingPackage: string;
  archivePackage: string;
  sessionId: string;
  sourceChecksum: string;
  phase: RotationPhase;
  createdAt: string;
  updatedAt: string;
}

export type RotationRecoveryAction = 'promote' | 'duplicate' | 'finalize' | 'quarantine' | 'unresolved';

export interface RotationRecoveryItem {
  marker: string;
  action: RotationRecoveryAction;
  applied: boolean;
  reason: string;
  sourcePackage: string;
  stagingPackage: string;
  archivePackage: string;
}

export interface RotationRecoveryResult {
  archiveDirectory: string;
  dryRun: boolean;
  scanned: number;
  items: RotationRecoveryItem[];
}

function markerPath(archiveDirectory: string, markerId: string): string {
  return join(archiveDirectory, `.rotation-marker-${markerId}.json`);
}

function isRotationMarkerName(name: string): boolean {
  return name.startsWith('.rotation-marker-') && name.endsWith('.json');
}

async function checksum(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function assertMarker(value: unknown): RotationMarker {
  if (!value || typeof value !== 'object') throw new Error('Rotation marker must be an object');
  const marker = value as Partial<RotationMarker>;
  const phases: RotationPhase[] = ['copying', 'verified', 'promoted', 'source_removed'];
  if (marker.schemaVersion !== ROTATION_MARKER_SCHEMA_VERSION
    || typeof marker.markerId !== 'string'
    || typeof marker.sourcePackage !== 'string'
    || typeof marker.stagingPackage !== 'string'
    || typeof marker.archivePackage !== 'string'
    || typeof marker.sessionId !== 'string'
    || typeof marker.sourceChecksum !== 'string'
    || !phases.includes(marker.phase as RotationPhase)
    || typeof marker.createdAt !== 'string'
    || typeof marker.updatedAt !== 'string') {
    throw new Error('Rotation marker schema validation failed');
  }
  return marker as RotationMarker;
}

export async function writeRotationMarker(
  archiveDirectory: string,
  marker: Omit<RotationMarker, 'schemaVersion' | 'createdAt' | 'updatedAt'> & Partial<Pick<RotationMarker, 'createdAt' | 'updatedAt'>>,
): Promise<string> {
  const now = new Date().toISOString();
  const complete: RotationMarker = {
    ...marker,
    schemaVersion: ROTATION_MARKER_SCHEMA_VERSION,
    createdAt: marker.createdAt ?? now,
    updatedAt: marker.updatedAt ?? now,
  };
  const path = markerPath(resolve(archiveDirectory), complete.markerId);
  await atomicWrite(path, complete);
  return path;
}

export async function updateRotationMarker(path: string, marker: RotationMarker, phase: RotationPhase): Promise<void> {
  await atomicWrite(path, { ...marker, phase, updatedAt: new Date().toISOString() });
}

async function packageExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function item(markerPathValue: string, marker: Partial<RotationMarker>, action: RotationRecoveryAction, applied: boolean, reason: string): RotationRecoveryItem {
  return {
    marker: markerPathValue,
    action,
    applied,
    reason,
    sourcePackage: marker.sourcePackage ?? '',
    stagingPackage: marker.stagingPackage ?? '',
    archivePackage: marker.archivePackage ?? '',
  };
}

export async function recoverRotationMarkers(
  archiveDirectory: string,
  options: { apply?: boolean } = {},
): Promise<RotationRecoveryResult> {
  const archiveRoot = resolve(archiveDirectory);
  const entries = await readdir(archiveRoot, { withFileTypes: true });
  const markerNames = entries.filter((entry) => entry.isFile() && isRotationMarkerName(entry.name)).map((entry) => entry.name);
  const dryRun = options.apply !== true;
  const items: RotationRecoveryItem[] = [];

  for (const name of markerNames) {
    const markerFile = join(archiveRoot, name);
    let marker: RotationMarker;
    try {
      marker = assertMarker(JSON.parse(await readFile(markerFile, 'utf8')));
    } catch (error) {
      items.push(item(markerFile, {}, 'quarantine', false, `invalid marker: ${(error as Error).message}`));
      continue;
    }

    const sourceExists = await packageExists(marker.sourcePackage);
    const stagingExists = await packageExists(marker.stagingPackage);
    const archiveExists = await packageExists(marker.archivePackage);

    if (stagingExists && !archiveExists) {
      try {
        const staging = await inspectSessionPackage(marker.stagingPackage);
        if (staging.sessionId !== marker.sessionId || await checksum(join(marker.stagingPackage, 'session-index.json')) !== marker.sourceChecksum) {
          items.push(item(markerFile, marker, 'quarantine', false, 'staging identity or checksum differs; no mutation performed'));
          continue;
        }
        if (dryRun) {
          items.push(item(markerFile, marker, 'promote', false, 'verified staging can be promoted (dry-run)'));
          continue;
        }
        await rename(marker.stagingPackage, marker.archivePackage);
        await inspectSessionPackage(marker.archivePackage);
        await updateRotationMarker(markerFile, marker, 'promoted');
        marker = { ...marker, phase: 'promoted' };
        items.push(item(markerFile, marker, 'promote', true, 'verified staging promoted to archive'));
      } catch (error) {
        items.push(item(markerFile, marker, 'quarantine', false, `staging is not a verified package: ${(error as Error).message}`));
      }
      continue;
    }

    if (archiveExists) {
      try {
        const archived = await inspectSessionPackage(marker.archivePackage);
        const archiveChecksum = await checksum(join(marker.archivePackage, 'session-index.json'));
        if (archived.sessionId !== marker.sessionId || archiveChecksum !== marker.sourceChecksum) {
          items.push(item(markerFile, marker, 'quarantine', false, 'archive identity or checksum differs; source retained'));
          continue;
        }
        if (sourceExists) {
          if (dryRun) {
            items.push(item(markerFile, marker, 'duplicate', false, 'verified archive duplicates source; source removal requires --apply'));
            continue;
          }
          await rm(marker.sourcePackage, { recursive: true, force: false });
          await updateRotationMarker(markerFile, marker, 'source_removed');
          await rm(markerFile, { force: true });
          items.push(item(markerFile, marker, 'duplicate', true, 'verified duplicate source removed'));
        } else {
          if (!dryRun) await rm(markerFile, { force: true });
          items.push(item(markerFile, marker, 'finalize', !dryRun, 'archive is verified and source is absent'));
        }
      } catch (error) {
        items.push(item(markerFile, marker, 'quarantine', false, `archive is not verified: ${(error as Error).message}`));
      }
      continue;
    }

    items.push(item(markerFile, marker, 'unresolved', false, sourceExists ? 'marker has no staging or archive; source retained' : 'marker has no staging, archive, or source'));
  }

  return { archiveDirectory: archiveRoot, dryRun, scanned: markerNames.length, items };
}
