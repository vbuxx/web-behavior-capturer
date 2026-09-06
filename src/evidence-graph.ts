import type { Behavior, ContractPackage, EvidenceRecord } from './types.js';

export type EvidenceGraphNodeKind = 'input' | 'observable_state' | 'mutation' | 'animation' | 'network_completion' | 'visual_checkpoint' | 'probe_run';

export interface EvidenceGraphNode {
  id: string;
  kind: EvidenceGraphNodeKind;
  evidenceRefs: string[];
  targetRef: string | null;
  navigationId: string | null;
  clockUncertaintyMs: number | null;
  payload: Record<string, unknown>;
}

export interface EvidenceGraphEdge {
  id: string;
  from: string;
  to: string;
  class: 'direct' | 'experiment_supported' | 'correlated' | 'unknown';
  evidenceRefs: string[];
  targetRef: string | null;
  navigationId: string | null;
  clockUncertaintyMs: number | null;
  limitation: string;
}

export interface EvidenceGraph {
  schemaVersion: '1.0.0';
  revision: string;
  sessionId: string;
  generatedAt: string;
  nodes: EvidenceGraphNode[];
  edges: EvidenceGraphEdge[];
  limitations: string[];
}

function navigationForTarget(contract: ContractPackage, targetRef: string | null): string | null {
  if (!targetRef) return null;
  const target = contract.manifest.targetCoverage.find((candidate) => candidate.targetId === targetRef);
  if (target) return target.navigationId;
  const element = contract.elements.find((candidate) => candidate.id === targetRef);
  return element ? element.navigationId : null;
}

function uncertaintyForTarget(contract: ContractPackage, targetRef: string | null): number | null {
  const target = contract.manifest.targetCoverage.find((candidate) => candidate.targetId === targetRef);
  return target?.clockMapping?.estimatedError.value ?? null;
}

function recordNode(contract: ContractPackage, record: EvidenceRecord): EvidenceGraphNode {
  const kind: EvidenceGraphNodeKind = record.type === 'mutation'
    ? 'mutation'
    : record.type.startsWith('animation-') || record.type === 'css-animation-sample'
      ? 'animation'
      : record.type === 'network-response'
        ? 'network_completion'
        : record.source === 'input'
          ? 'input'
          : 'observable_state';
  return {
    id: `node:${record.id}`,
    kind,
    evidenceRefs: [record.id],
    targetRef: record.targetRef ?? null,
    navigationId: navigationForTarget(contract, record.targetRef ?? null),
    clockUncertaintyMs: uncertaintyForTarget(contract, record.targetRef ?? null),
    payload: { type: record.type, sourceTime: record.sourceTime, source: record.source, data: record.payload },
  };
}

function behaviorStateNode(contract: ContractPackage, behavior: Behavior, records: EvidenceRecord[]): EvidenceGraphNode {
  const evidenceRefs = [...new Set([
    ...behavior.trigger.evidenceRefs,
    ...behavior.provenance.evidenceRefs,
    ...behavior.visualEvidenceRefs,
    ...(behavior.interruption?.evidenceRefs ?? []),
  ])];
  const firstSample = behavior.tracks[0]?.samples[0];
  const fingerprintRecord = records.find((record) => record.type === 'observable-state-fingerprint'
    && record.targetRef === behavior.targetRef
    && record.payload.behaviorId === behavior.behaviorId);
  const fingerprint = fingerprintRecord?.payload.fingerprint ?? {
    url: contract.manifest.source.url,
    focus: null,
    visibility: 'unknown',
    relevantAttributes: {},
    scroll: firstSample?.scrollY ?? null,
    layoutCheckpoint: firstSample ? { x: firstSample.x, y: firstSample.y, transform: firstSample.transform } : null,
  };
  return {
    id: `state:${behavior.behaviorId}`,
    kind: 'observable_state',
    evidenceRefs: [...new Set([...evidenceRefs, ...(fingerprintRecord ? [fingerprintRecord.id] : [])])],
    targetRef: behavior.targetRef,
    navigationId: navigationForTarget(contract, behavior.targetRef),
    clockUncertaintyMs: uncertaintyForTarget(contract, behavior.targetRef),
    payload: {
      behaviorId: behavior.behaviorId,
      fingerprint,
      ...(fingerprintRecord ? {} : { limitation: 'Focus, visibility, and attributes are unknown until a state fingerprint checkpoint is captured.' }),
    },
  };
}

function edge(from: EvidenceGraphNode, to: EvidenceGraphNode, index: number, edgeClass: EvidenceGraphEdge['class']): EvidenceGraphEdge {
  return {
    id: `edge:${index}`,
    from: from.id,
    to: to.id,
    class: edgeClass,
    evidenceRefs: [...new Set([...from.evidenceRefs, ...to.evidenceRefs])],
    targetRef: to.targetRef ?? from.targetRef,
    navigationId: to.navigationId ?? from.navigationId,
    clockUncertaintyMs: Math.max(from.clockUncertaintyMs ?? 0, to.clockUncertaintyMs ?? 0) || null,
    limitation: edgeClass === 'direct' ? 'Shared evidence reference or target scope.' : 'Relationship inferred from capture ordering or behavior provenance.',
  };
}

export function compileEvidenceGraph(contract: ContractPackage, records: EvidenceRecord[]): EvidenceGraph {
  const nodes = records.map((record) => recordNode(contract, record));
  nodes.push(...contract.evidenceIndex.filter((evidence) => evidence.mediaType === 'image/png').map((evidence) => ({
    id: `visual:${evidence.id}`,
    kind: 'visual_checkpoint' as const,
    evidenceRefs: [evidence.id],
    targetRef: null,
    navigationId: null,
    clockUncertaintyMs: null,
    payload: { path: evidence.path, mediaType: evidence.mediaType },
  })));
  nodes.push(...contract.behaviors.map((behavior) => behaviorStateNode(contract, behavior, records)));
  nodes.push({
    id: 'probe:pending',
    kind: 'probe_run',
    evidenceRefs: [],
    targetRef: null,
    navigationId: null,
    clockUncertaintyMs: null,
    payload: { status: 'not_run', limitation: 'No diagnostic probe was executed during natural capture.' },
  });

  const edges: EvidenceGraphEdge[] = [];
  let edgeIndex = 0;
  for (const behavior of contract.behaviors) {
    const state = nodes.find((node) => node.id === `state:${behavior.behaviorId}`)!;
    for (const source of nodes.filter((node) => node.id !== state.id && node.evidenceRefs.some((ref) => state.evidenceRefs.includes(ref)))) {
      edges.push(edge(source, state, edgeIndex++, 'direct'));
    }
  }
  const ordered = nodes.filter((node) => node.kind !== 'probe_run' && node.evidenceRefs.length > 0);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (previous.targetRef && previous.targetRef === current.targetRef) edges.push(edge(previous, current, edgeIndex++, 'correlated'));
  }
  return {
    schemaVersion: '1.0.0',
    revision: `graph-${contract.manifest.sessionId}-1`,
    sessionId: contract.manifest.sessionId,
    generatedAt: new Date().toISOString(),
    nodes,
    edges,
    limitations: [
      'Natural capture does not establish causal edges without intervention; non-direct edges are correlated.',
    records.some((record) => record.type === 'observable-state-fingerprint')
      ? 'Fingerprint checkpoints cover the configured behavior targets; focus outside those targets remains out of scope.'
      : 'Observable-state focus, visibility, and relevant attributes are unknown until dedicated fingerprint checkpoints are enabled.',
      'Probe-run node is a placeholder until a diagnostic probe contributes evidence.',
    ],
  };
}
