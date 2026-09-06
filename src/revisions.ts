import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { validateContract } from './validate.js';
import { validateEvidenceGraph } from './evidence-graph-validate.js';
import type { ContractPackage } from './types.js';
import type { EvidenceGraph } from './evidence-graph.js';

export interface RevisionEntry {
  revisionId: string;
  createdAt: string;
  contract: { path: string; sha256: string };
  evidenceGraph: { path: string; sha256: string };
  probeRun?: { path: string; sha256: string };
}

export interface RevisionIndex {
  schemaVersion: '1.0.0';
  sessionId: string;
  activeRevisionId: string | null;
  revisions: RevisionEntry[];
}

function safePath(packageRoot: string, relativePath: string): string {
  const root = resolve(packageRoot);
  const path = resolve(root, relativePath);
  if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error(`Revision path escapes package: ${relativePath}`);
  return path;
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export async function readRevisionIndex(packageRoot: string, sessionId: string): Promise<RevisionIndex> {
  const path = resolve(packageRoot, 'revisions/index.json');
  try {
    const index = JSON.parse(await readFile(path, 'utf8')) as RevisionIndex;
    if (index.schemaVersion !== '1.0.0' || index.sessionId !== sessionId || !Array.isArray(index.revisions)) throw new Error('Invalid revision index');
    return index;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: '1.0.0', sessionId, activeRevisionId: null, revisions: [] };
    throw error;
  }
}

export async function writeRevisionIndex(packageRoot: string, index: RevisionIndex): Promise<void> {
  const path = resolve(packageRoot, 'revisions/index.json');
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

export async function validateRevision(packageRoot: string, entry: RevisionEntry): Promise<{ contract: ContractPackage; graph: EvidenceGraph }> {
  const contractPath = safePath(packageRoot, entry.contract.path);
  const graphPath = safePath(packageRoot, entry.evidenceGraph.path);
  if (await sha256(contractPath) !== entry.contract.sha256) throw new Error(`Revision contract checksum mismatch: ${entry.revisionId}`);
  if (await sha256(graphPath) !== entry.evidenceGraph.sha256) throw new Error(`Revision graph checksum mismatch: ${entry.revisionId}`);
  const contract = await validateContract(JSON.parse(await readFile(contractPath, 'utf8')));
  const graph = await validateEvidenceGraph(JSON.parse(await readFile(graphPath, 'utf8')));
  if (contract.manifest.revision !== entry.revisionId || contract.manifest.evidenceGraph?.revision !== entry.revisionId) throw new Error(`Revision identity mismatch: ${entry.revisionId}`);
  if (graph.sessionId !== contract.manifest.sessionId || graph.revision !== entry.revisionId) throw new Error(`Revision graph identity mismatch: ${entry.revisionId}`);
  for (const evidence of contract.evidenceIndex) {
    if (await sha256(safePath(packageRoot, evidence.path)) !== evidence.sha256) throw new Error(`Revision evidence checksum mismatch: ${evidence.id}`);
  }
  return { contract, graph };
}

export function revisionEntryFor(index: RevisionIndex, revisionId?: string): RevisionEntry | undefined {
  const selected = revisionId ?? index.activeRevisionId;
  return selected ? index.revisions.find((entry) => entry.revisionId === selected) : undefined;
}
