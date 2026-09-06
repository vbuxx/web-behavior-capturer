export type CapabilityStatus = 'supported' | 'unavailable' | 'failed' | 'not_attempted';
export type ProvenanceStatus = 'extracted' | 'observed' | 'inferred' | 'unknown';
export type EdgeClass = 'direct' | 'experiment_supported' | 'correlated' | 'unknown';
export type BehaviorKind =
  | 'hover'
  | 'css_animation'
  | 'interrupted_transition'
  | 'scroll_reveal'
  | 'gsap_scrub';

export type CaptureTargetKind = 'main_frame' | 'same_origin_iframe' | 'cross_origin_iframe' | 'dedicated_worker';

export interface TargetCoverage {
  targetId: string;
  navigationId: string;
  epoch: number;
  parentTargetId: string | null;
  kind: CaptureTargetKind;
  url: string;
  attachedAt: { value: number; unit: 'epoch_ms' };
  detachedAt?: { value: number; unit: 'epoch_ms' };
  coverageEnd?: { value: number; unit: 'epoch_ms' };
  lifecycleStatus: 'active' | 'navigated' | 'detached';
  coverageStart: 'document_start' | 'runtime';
  collector: {
    status: 'installed' | 'failed';
    recordCount: number;
    droppedRecords: number;
    knownLoss: boolean;
  };
  clockMapping?: {
    sourceTimeOrigin: { value: number; unit: 'epoch_ms' };
    observedAt: { value: number; unit: 'ms' };
    mappedEpoch: { value: number; unit: 'epoch_ms' };
    hostReceiveTime: { value: number; unit: 'epoch_ms' };
    estimatedError: { value: number; unit: 'ms' };
  };
  completeness: 'full' | 'partial';
  gaps: string[];
}

export interface EvidenceRecord {
  id: string;
  source: 'input' | 'page' | 'waapi' | 'cdp' | 'visual' | 'adapter' | 'verifier';
  sequence: number;
  sourceTime: number;
  receiveTime: number;
  type: string;
  targetRef?: string;
  payload: Record<string, unknown>;
}

export interface ElementRef {
  id: string;
  navigationId: string;
  targetId: string;
  frame: 'main' | 'iframe';
  coordinateSpace: 'document';
  selector: string;
  dataWbcId: string;
  instanceOrdinal: number;
  bounds: { x: number; y: number; width: number; height: number };
  structuralFingerprint: {
    tagName: string;
    role: string | null;
    depth: number;
    childElementCount: number;
    documentOrder: number;
    documentProgress: number;
    widthRatio: number;
    heightPx: number;
    hasTransition: boolean;
    transitionDurationMs: number;
  };
  locatorCandidates: Array<{
    strategy: 'data_attribute' | 'id' | 'role';
    value: string;
    score: number;
    matchCount: number;
  }>;
  ambiguity: {
    status: 'unique' | 'ambiguous';
    preferredStrategy: 'data_attribute' | 'id' | 'role';
    matchCount: number;
  };
}

export interface TimeTimeline {
  domain: 'time';
  duration: { value: number; unit: 'ms' };
  delay: { value: number; unit: 'ms' };
  easing: string;
  iterations: number | 'infinite';
}

export interface ScrollTimeline {
  domain: 'scroll';
  containerRef: 'viewport';
  axis: 'y';
  range: {
    start: { value: number; unit: 'px' };
    end: { value: number; unit: 'px' };
  };
  scrub: { mode: 'direct' | 'numeric'; catchUp?: { value: number; unit: 'ms' } };
}

export interface StyleSample {
  progress?: number;
  elapsedMs?: number;
  scrollY?: number;
  opacity: number;
  transform: string;
  x: number;
  y: number;
}

export interface Behavior {
  behaviorId: string;
  kind: BehaviorKind;
  targetRef: string;
  trigger: {
    type: string;
    targetRef: string;
    edgeClass: EdgeClass;
    evidenceRefs: string[];
  };
  timeline: TimeTimeline | ScrollTimeline;
  tracks: Array<{
    property: string;
    from: string | number;
    to: string | number;
    keyframes: Array<{ offset: number | null; easing: string; value: string | number }>;
    samples: StyleSample[];
  }>;
  provenance: {
    status: ProvenanceStatus;
    evidenceRefs: string[];
  };
  interruption?: {
    at: { value: number; unit: 'ms' };
    observedState: StyleSample;
    recoveryDuration: { value: number; unit: 'ms' };
    phases: Array<{
      name: 'entry' | 'recovery';
      status: 'interrupted' | 'completed';
      tracks: Array<{ property: string; from: string | number; to: string | number }>;
    }>;
    evidenceRefs: string[];
  };
  visualEvidenceRefs: string[];
  unknowns: string[];
}

export interface CaptureManifest {
  productVersion: string;
  schemaVersion: '1.5.0';
  sessionId: string;
  navigationId: string;
  generatedAt: string;
  source: {
    url: string;
    fixture: 'phase0';
  };
  environment: {
    browserName: string;
    browserVersion: string;
    platform: string;
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
    locale: string;
    timezone: string;
    reducedMotion: string;
  };
  captureMode: 'natural';
  capabilities: Array<{
    name: string;
    status: CapabilityStatus;
    detail?: string;
  }>;
  targetCoverage: TargetCoverage[];
  redaction: {
    policyVersion: '1.0.0';
    replacement: '[REDACTED]';
    redactedValues: number;
    categories: string[];
  };
  quality: {
    recordCount: number;
    droppedRecords: number;
    knownLoss: boolean;
    observerCost: {
      baselineP95FrameMs: number;
      captureP95FrameMs: number;
      degradationPercent: number;
      sampleCount: number;
    };
  };
  gaps: string[];
}

export interface ContractPackage {
  schemaVersion: '1.5.0';
  manifest: CaptureManifest;
  elements: ElementRef[];
  behaviors: Behavior[];
  evidenceIndex: Array<{
    id: string;
    path: string;
    mediaType: 'application/x-ndjson' | 'image/png';
    sha256: string;
  }>;
}

export interface VerificationCheck {
  scenarioId: string;
  behaviorId: string;
  status: 'passed' | 'failed';
  scenario: string;
  metrics: Record<string, number | string | boolean>;
  mismatches: string[];
}

export interface VerificationReport {
  schemaVersion: '1.0.0';
  verifiedAt: string;
  referenceSessionId: string;
  scenarioSuiteId: string;
  targetLabel: string;
  targetUrl: string;
  heldOutConditions: string[];
  checks: VerificationCheck[];
  summary: { passed: number; failed: number; total: number };
}

export interface SessionIndexManifest {
  schemaVersion: '1.1.0';
  generatedAt: string;
  database: { path: string; sha256: string };
  contract: { path: string; sha256: string };
  counts: { targets: number; elements: number; behaviors: number; evidence: number; records: number };
}
