import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { inspectSessionPackage } from './session-index.js';
import { validateContract, validateSessionIndexManifest } from './validate.js';
import { compileEvidenceGraph, type EvidenceGraph } from './evidence-graph.js';
import { validateEvidenceGraph } from './evidence-graph-validate.js';
import { readRevisionIndex, revisionEntryFor, validateRevision, writeRevisionIndex, type RevisionEntry } from './revisions.js';
import type { ContractPackage, EvidenceRecord } from './types.js';
import type { EvidenceGraphEdge } from './evidence-graph.js';

export interface AnnotationRevisionInput {
  annotationId: string;
  createdAt: string;
  note: string;
  targetRef?: string;
  evidenceRefs?: string[];
  edgeCorrection?: {
    edgeId: string;
    class?: EvidenceGraphEdge['class'];
    limitation?: string;
  };
}

export async function createAnnotationRevision(packageRootInput: string, annotation: AnnotationRevisionInput): Promise<{ revisionId: string; contractPath: string; graphPath: string }> {
  const packageRoot = resolve(packageRootInput);
  await inspectSessionPackage(packageRoot);
  const index = await validateSessionIndexManifest(JSON.parse(await readFile(resolve(packageRoot, 'session-index.json'), 'utf8')));
  const baseContract = await validateContract(JSON.parse(await readFile(resolve(packageRoot, index.contract.path), 'utf8')));
  const revisions = await readRevisionIndex(packageRoot, baseContract.manifest.sessionId);
  const active = revisionEntryFor(revisions);
  let contract = baseContract;
  let graph: EvidenceGraph;
  if (active) {
    const current = await validateRevision(packageRoot, active);
    contract = current.contract;
    graph = current.graph;
  } else if (index.evidenceGraph) {
    graph = await validateEvidenceGraph(JSON.parse(await readFile(resolve(packageRoot, index.evidenceGraph.path), 'utf8')));
  } else {
    const events = baseContract.evidenceIndex.find((entry) => entry.mediaType === 'application/x-ndjson');
    const records: EvidenceRecord[] = events
      ? (await readFile(resolve(packageRoot, events.path), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as EvidenceRecord)
      : [];
    graph = compileEvidenceGraph(baseContract, records);
  }
  const revisionId = `revision-${randomUUID()}`;
  const revisionRoot = resolve(packageRoot, 'revisions', revisionId);
  await mkdir(revisionRoot, { recursive: true });
  const annotationPath = join(revisionRoot, 'annotation.jsonl');
  await writeFile(annotationPath, `${JSON.stringify(annotation)}\n`, 'utf8');
  const annotationEvidenceId = `annotation-${annotation.annotationId}`;
  const annotationEvidence = { id: annotationEvidenceId, path: relative(packageRoot, annotationPath), mediaType: 'application/x-ndjson' as const, sha256: createHash('sha256').update(await readFile(annotationPath)).digest('hex') };
  let revisionGraph: EvidenceGraph = {
    ...graph,
    revision: revisionId,
    generatedAt: new Date().toISOString(),
    limitations: [...graph.limitations, `Human annotation ${annotation.annotationId} is retained as immutable sidecar evidence; it does not alter raw observations.`],
  };
  if (annotation.edgeCorrection) {
    const target = revisionGraph.edges.find((edge) => edge.id === annotation.edgeCorrection?.edgeId);
    if (!target) throw new Error(`Unknown evidence edge for annotation correction: ${annotation.edgeCorrection.edgeId}`);
    revisionGraph = {
      ...revisionGraph,
      edges: revisionGraph.edges.map((edge) => edge.id === annotation.edgeCorrection?.edgeId
        ? { ...edge, ...(annotation.edgeCorrection.class ? { class: annotation.edgeCorrection.class } : {}), ...(annotation.edgeCorrection.limitation ? { limitation: annotation.edgeCorrection.limitation } : {}) }
        : edge),
      limitations: annotation.edgeCorrection.limitation ? [...revisionGraph.limitations, `Annotation ${annotation.annotationId} supplied a bounded edge limitation.`] : revisionGraph.limitations,
    };
  }
  const revisionContract: ContractPackage = {
    ...contract,
    evidenceIndex: [...contract.evidenceIndex, annotationEvidence],
    manifest: { ...contract.manifest, revision: revisionId, evidenceGraph: { revision: revisionId, path: `revisions/${revisionId}/evidence-graph.json`, sha256: '' } },
  };
  const graphPath = join(revisionRoot, 'evidence-graph.json');
  await validateEvidenceGraph(revisionGraph);
  await writeFile(graphPath, `${JSON.stringify(revisionGraph, null, 2)}\n`, 'utf8');
  const graphSha = createHash('sha256').update(await readFile(graphPath)).digest('hex');
  revisionContract.manifest.evidenceGraph = { revision: revisionId, path: `revisions/${revisionId}/evidence-graph.json`, sha256: graphSha };
  await validateContract(revisionContract);
  const contractPath = join(revisionRoot, 'behavior-contract.json');
  await writeFile(contractPath, `${JSON.stringify(revisionContract, null, 2)}\n`, 'utf8');
  const entry: RevisionEntry = {
    revisionId,
    createdAt: annotation.createdAt,
    contract: { path: relative(packageRoot, contractPath), sha256: createHash('sha256').update(await readFile(contractPath)).digest('hex') },
    evidenceGraph: { path: relative(packageRoot, graphPath), sha256: createHash('sha256').update(await readFile(graphPath)).digest('hex') },
  };
  revisions.revisions.push(entry);
  revisions.activeRevisionId = revisionId;
  await writeRevisionIndex(packageRoot, revisions);
  return { revisionId, contractPath, graphPath };
}
