import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { captureSession, CaptureCancelledError } from './capture.js';
import { inspectSessionPackage, querySessionBehaviors, querySessionRecords, type SessionRecordQuery } from './session-index.js';
import { validateContract, validateSessionIndexManifest } from './validate.js';
import { runTechnicalProbes } from './probes.js';
import { verifyPhase0 } from './verify.js';
import type { BehaviorKind, CaptureSessionState, ContractPackage, VerificationReport } from './types.js';
import { readRevisionIndex, revisionEntryFor, validateRevision, writeRevisionIndex, type RevisionEntry } from './revisions.js';
import { validateEvidenceGraph } from './evidence-graph-validate.js';
import type { EvidenceGraph } from './evidence-graph.js';
import { compileEvidenceGraph } from './evidence-graph.js';
import type { EvidenceRecord } from './types.js';

export type ServiceJobStatus = 'queued' | 'running' | 'finalizing' | 'completed' | 'cancelled' | 'failed';

export interface ServiceJob {
  jobId: string;
  operation: string;
  status: ServiceJobStatus;
  createdAt: string;
  updatedAt: string;
  outputPath?: string;
  result?: Record<string, unknown>;
  error?: { name: string; message: string; stage: string };
}

export interface ImmutableSnapshot {
  sessionId: string;
  revisionId: string | null;
  contractSchemaVersion: string;
  contractSha256: string;
  evidenceGraphSha256?: string;
}

export interface SessionServiceOptions {
  workspaceRoot?: string;
  jobStorePath?: string;
}

class LocalJobStore {
  readonly #path: string;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(path: string) { this.#path = resolve(path); }

  async #read(): Promise<ServiceJob[]> {
    try { return JSON.parse(await readFile(this.#path, 'utf8')) as ServiceJob[]; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async #write(jobs: ServiceJob[]): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const temporary = `${this.#path}.tmp-${randomUUID()}`;
    await writeFile(temporary, `${JSON.stringify(jobs, null, 2)}\n`, 'utf8');
    await rename(temporary, this.#path);
  }

  async create(operation: string): Promise<ServiceJob> {
    const job: ServiceJob = {
      jobId: randomUUID(), operation, status: 'queued',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await this.update(() => job, job.jobId);
    return job;
  }

  async get(jobId: string): Promise<ServiceJob> {
    const job = (await this.#read()).find((candidate) => candidate.jobId === jobId);
    if (!job) throw new Error(`Unknown job: ${jobId}`);
    return job;
  }

  async update(mutator: (job: ServiceJob | undefined) => ServiceJob, jobId: string): Promise<ServiceJob> {
    let result!: ServiceJob;
    this.#writeQueue = this.#writeQueue.then(async () => {
      const jobs = await this.#read();
      const index = jobs.findIndex((candidate) => candidate.jobId === jobId);
      result = mutator(index >= 0 ? jobs[index] : undefined);
      if (index >= 0) jobs[index] = result; else jobs.push(result);
      await this.#write(jobs);
    });
    await this.#writeQueue;
    return result;
  }
}

function serviceStatus(state: CaptureSessionState): ServiceJobStatus {
  if (state === 'running') return 'running';
  if (state === 'finalizing') return 'finalizing';
  if (state === 'completed') return 'completed';
  if (state === 'cancelled' || state === 'stopping') return 'cancelled';
  return 'failed';
}

export class SessionService {
  readonly #workspaceRoot: string;
  readonly #jobs: LocalJobStore;
  readonly #controllers = new Map<string, AbortController>();

  constructor(options: SessionServiceOptions = {}) {
    this.#workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
    this.#jobs = new LocalJobStore(options.jobStorePath ?? resolve(this.#workspaceRoot, '.wbc/jobs.json'));
  }

  async status(jobId: string): Promise<ServiceJob> { return this.#jobs.get(jobId); }

  async startCapture(options: { outputPath?: string; maxRecords?: number; visualPolicyPath?: string; resumedFromSessionId?: string; resumeCheckpoint?: string } = {}): Promise<ServiceJob> {
    const job = await this.#jobs.create('capture.start');
    const outputPath = resolve(this.#workspaceRoot, options.outputPath ?? `.wbc/sessions/${job.jobId}`);
    const controller = new AbortController();
    this.#controllers.set(job.jobId, controller);
    void captureSession(outputPath, {
      signal: controller.signal,
      ...(options.maxRecords ? { maxPageRecords: options.maxRecords } : {}),
      ...(options.visualPolicyPath ? { visualPolicyPath: resolve(this.#workspaceRoot, options.visualPolicyPath) } : {}),
      ...(options.resumedFromSessionId ? { resumedFromSessionId: options.resumedFromSessionId } : {}),
      ...(options.resumeCheckpoint ? { resumeCheckpoint: options.resumeCheckpoint } : {}),
      onStateChange: (state) => { void this.#jobs.update((current) => ({ ...(current ?? job), status: serviceStatus(state), updatedAt: new Date().toISOString(), outputPath }), job.jobId); },
    }).then((result) => this.#jobs.update((current) => ({ ...(current ?? job), status: 'completed', updatedAt: new Date().toISOString(), outputPath, result: { sessionId: result.contract.manifest.sessionId, behaviors: result.contract.behaviors.length } }), job.jobId))
      .catch((error: unknown) => this.#jobs.update((current) => ({
        ...(current ?? job),
        status: error instanceof CaptureCancelledError ? 'cancelled' : 'failed',
        updatedAt: new Date().toISOString(),
        outputPath,
        error: { name: error instanceof Error ? error.name : 'UnknownError', message: error instanceof Error ? error.message : String(error), stage: 'capture' },
      }), job.jobId))
      .finally(() => { this.#controllers.delete(job.jobId); });
    return { ...job, status: 'running', outputPath };
  }

  async stopCapture(jobId: string): Promise<ServiceJob> {
    const controller = this.#controllers.get(jobId);
    if (!controller) return this.#jobs.get(jobId);
    controller.abort();
    return this.#jobs.get(jobId);
  }

  async #snapshot(packagePath: string, revisionId?: string): Promise<ImmutableSnapshot> {
    const packageRoot = resolve(this.#workspaceRoot, packagePath);
    await inspectSessionPackage(packageRoot);
    const index = await validateSessionIndexManifest(JSON.parse(await readFile(resolve(packageRoot, 'session-index.json'), 'utf8')));
    const contract = await validateContract(JSON.parse(await readFile(resolve(packageRoot, index.contract.path), 'utf8')));
    const revisions = await readRevisionIndex(packageRoot, contract.manifest.sessionId);
    const revision = revisionEntryFor(revisions, revisionId);
    if (revisionId && !revision) throw new Error(`Unknown revision: ${revisionId}`);
    const revisionContract = revision ? (await validateRevision(packageRoot, revision)).contract : undefined;
    return {
      sessionId: contract.manifest.sessionId,
      revisionId: revision?.revisionId ?? null,
      contractSchemaVersion: revisionContract?.schemaVersion ?? contract.schemaVersion,
      contractSha256: revision?.contract.sha256 ?? index.contract.sha256,
      ...(revision ? { evidenceGraphSha256: revision.evidenceGraph.sha256 } : index.evidenceGraph ? { evidenceGraphSha256: index.evidenceGraph.sha256 } : {}),
    };
  }

  async listRevisions(packagePath: string): Promise<{ sessionId: string; activeRevisionId: string | null; revisions: RevisionEntry[] }> {
    const packageRoot = resolve(this.#workspaceRoot, packagePath);
    await inspectSessionPackage(packageRoot);
    const index = await validateSessionIndexManifest(JSON.parse(await readFile(resolve(packageRoot, 'session-index.json'), 'utf8')));
    const contract = await validateContract(JSON.parse(await readFile(resolve(packageRoot, index.contract.path), 'utf8')));
    const revisions = await readRevisionIndex(packageRoot, contract.manifest.sessionId);
    for (const revision of revisions.revisions) await validateRevision(packageRoot, revision);
    return revisions;
  }

  async #writeProbeRevision(packagePath: string, reportPath: string): Promise<{ revisionId: string; contractPath: string; reportPath: string }> {
    const packageRoot = resolve(this.#workspaceRoot, packagePath);
    const index = await validateSessionIndexManifest(JSON.parse(await readFile(resolve(packageRoot, 'session-index.json'), 'utf8')));
    const baseContract = await validateContract(JSON.parse(await readFile(resolve(packageRoot, index.contract.path), 'utf8')));
    let baseGraph: EvidenceGraph;
    if (index.evidenceGraph) {
      const baseGraphPath = resolve(packageRoot, index.evidenceGraph.path);
      baseGraph = await validateEvidenceGraph(JSON.parse(await readFile(baseGraphPath, 'utf8')));
    } else {
      const events = baseContract.evidenceIndex.find((entry) => entry.mediaType === 'application/x-ndjson');
      const records: EvidenceRecord[] = events
        ? (await readFile(resolve(packageRoot, events.path), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as EvidenceRecord)
        : [];
      baseGraph = compileEvidenceGraph(baseContract, records);
    }
    const revisionId = `revision-${randomUUID()}`;
    const revisionRoot = resolve(packageRoot, 'revisions', revisionId);
    await mkdir(revisionRoot, { recursive: true });
    const revisionReportPath = resolve(revisionRoot, 'technical-probe-report.json');
    await cp(reportPath, revisionReportPath);
    const reportSha = createHash('sha256').update(await readFile(revisionReportPath)).digest('hex');
    const relativeReportPath = `revisions/${revisionId}/technical-probe-report.json`;
    const probeEvidenceId = `probe-report-${revisionId}`;
    const reportEvidence = { id: probeEvidenceId, path: relativeReportPath, mediaType: 'application/x-ndjson' as const, sha256: reportSha };
    const revisionContract: ContractPackage = {
      ...baseContract,
      evidenceIndex: [...baseContract.evidenceIndex, reportEvidence],
      manifest: {
        ...baseContract.manifest,
        revision: revisionId,
        probeRun: { path: relativeReportPath, sha256: reportSha },
      },
    };
    const graph: EvidenceGraph = {
      ...baseGraph,
      revision: revisionId,
      generatedAt: new Date().toISOString(),
      nodes: [
        ...baseGraph.nodes.filter((node) => node.kind !== 'probe_run'),
        { id: `probe:${revisionId}`, kind: 'probe_run', evidenceRefs: [probeEvidenceId], targetRef: null, navigationId: null, clockUncertaintyMs: null, payload: { status: 'completed', reportPath: relativeReportPath } },
      ],
      edges: baseGraph.edges.filter((edge) => !edge.from.startsWith('probe:') && !edge.to.startsWith('probe:')),
      limitations: baseGraph.limitations.filter((limitation) => !limitation.includes('Probe-run node is a placeholder')),
    };
    graph.edges.push(...revisionContract.behaviors.slice(0, 1).map((behavior, index) => ({
      id: `edge:probe:${index}`,
      from: `probe:${revisionId}`,
      to: `state:${behavior.behaviorId}`,
      class: 'experiment_supported' as const,
      evidenceRefs: [probeEvidenceId],
      targetRef: behavior.targetRef,
      navigationId: null,
      clockUncertaintyMs: null,
      limitation: 'Technical probe result is associated with the first covered behavior; per-behavior causality requires a targeted probe.',
    })));
    await validateEvidenceGraph(graph);
    await validateContract(revisionContract);
    const revisionContractPath = resolve(revisionRoot, 'behavior-contract.json');
    await writeFile(revisionContractPath, `${JSON.stringify(revisionContract, null, 2)}\n`, 'utf8');
    const revisionGraphPath = resolve(revisionRoot, 'evidence-graph.json');
    await writeFile(revisionGraphPath, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');
    revisionContract.manifest.evidenceGraph = { revision: revisionId, path: `revisions/${revisionId}/evidence-graph.json`, sha256: createHash('sha256').update(await readFile(revisionGraphPath)).digest('hex') };
    await writeFile(revisionContractPath, `${JSON.stringify(revisionContract, null, 2)}\n`, 'utf8');
    const revisionEntry: RevisionEntry = {
      revisionId,
      createdAt: new Date().toISOString(),
      contract: { path: `revisions/${revisionId}/behavior-contract.json`, sha256: createHash('sha256').update(await readFile(revisionContractPath)).digest('hex') },
      evidenceGraph: { path: `revisions/${revisionId}/evidence-graph.json`, sha256: createHash('sha256').update(await readFile(revisionGraphPath)).digest('hex') },
      probeRun: { path: relativeReportPath, sha256: reportSha },
    };
    const revisionIndex = await readRevisionIndex(packageRoot, baseContract.manifest.sessionId);
    revisionIndex.revisions.push(revisionEntry);
    revisionIndex.activeRevisionId = revisionId;
    await writeRevisionIndex(packageRoot, revisionIndex);
    return { revisionId, contractPath: revisionContractPath, reportPath: revisionReportPath };
  }

  async listBehaviors(packagePath: string, options: { kind?: BehaviorKind; limit?: number; offset?: number; revisionId?: string } = {}): Promise<{ snapshot: ImmutableSnapshot; behaviors: Awaited<ReturnType<typeof querySessionBehaviors>> }> {
    const snapshot = await this.#snapshot(packagePath, options.revisionId);
    const selectedRevisionId = options.revisionId ?? snapshot.revisionId ?? undefined;
    if (!selectedRevisionId) return { snapshot, behaviors: await querySessionBehaviors(resolve(this.#workspaceRoot, packagePath), options) };
    const packageRoot = resolve(this.#workspaceRoot, packagePath);
    const index = await this.listRevisions(packagePath);
    const revision = index.revisions.find((candidate) => candidate.revisionId === selectedRevisionId);
    if (!revision) throw new Error(`Unknown revision: ${selectedRevisionId}`);
    const loaded = await validateRevision(packageRoot, revision);
    const filtered = loaded.contract.behaviors.filter((behavior) => !options.kind || behavior.kind === options.kind);
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 20)));
    return { snapshot, behaviors: filtered.slice(offset, offset + limit).map((behavior) => ({ behaviorId: behavior.behaviorId, kind: behavior.kind, targetRef: behavior.targetRef })) };
  }

  async getBehavior(packagePath: string, behaviorId: string, revisionId?: string): Promise<{ snapshot: ImmutableSnapshot; behavior: ContractPackage['behaviors'][number] }> {
    const packageRoot = resolve(this.#workspaceRoot, packagePath);
    const snapshot = await this.#snapshot(packagePath, revisionId);
    const selectedRevisionId = revisionId ?? snapshot.revisionId ?? undefined;
    if (selectedRevisionId) {
      const revisions = await this.listRevisions(packagePath);
      const revision = revisions.revisions.find((candidate) => candidate.revisionId === selectedRevisionId);
      if (!revision) throw new Error(`Unknown revision: ${selectedRevisionId}`);
      const behavior = (await validateRevision(packageRoot, revision)).contract.behaviors.find((candidate) => candidate.behaviorId === behaviorId);
      if (!behavior) throw new Error(`Unknown behavior: ${behaviorId}`);
      return { snapshot, behavior };
    }
    const manifest = await validateSessionIndexManifest(JSON.parse(await readFile(resolve(packageRoot, 'session-index.json'), 'utf8')));
    const contract = await validateContract(JSON.parse(await readFile(resolve(packageRoot, manifest.contract.path), 'utf8')));
    const behavior = contract.behaviors.find((candidate) => candidate.behaviorId === behaviorId);
    if (!behavior) throw new Error(`Unknown behavior: ${behaviorId}`);
    return { snapshot, behavior };
  }

  async getEvidence(packagePath: string, query: SessionRecordQuery = {}): Promise<{ snapshot: ImmutableSnapshot; page: Awaited<ReturnType<typeof querySessionRecords>> }> {
    const snapshot = await this.#snapshot(packagePath, query.revisionId);
    return { snapshot, page: await querySessionRecords(resolve(this.#workspaceRoot, packagePath), query) };
  }

  async getEvidenceGraph(packagePath: string, revisionId?: string): Promise<{ snapshot: ImmutableSnapshot; graph: EvidenceGraph }> {
    const packageRoot = resolve(this.#workspaceRoot, packagePath);
    const snapshot = await this.#snapshot(packagePath, revisionId);
    const selectedRevisionId = revisionId ?? snapshot.revisionId ?? undefined;
    const revisions = await this.listRevisions(packagePath);
    if (selectedRevisionId) {
      const entry = revisions.revisions.find((candidate) => candidate.revisionId === selectedRevisionId);
      if (!entry) throw new Error(`Unknown revision: ${selectedRevisionId}`);
      return { snapshot, graph: (await validateRevision(packageRoot, entry)).graph };
    }
    const manifest = await validateSessionIndexManifest(JSON.parse(await readFile(resolve(packageRoot, 'session-index.json'), 'utf8')));
    if (!manifest.evidenceGraph) throw new Error('Evidence graph unavailable');
    return { snapshot, graph: await validateEvidenceGraph(JSON.parse(await readFile(resolve(packageRoot, manifest.evidenceGraph.path), 'utf8'))) };
  }

  async runProbe(packagePath = 'artifacts/phase1/latest'): Promise<ServiceJob> {
    const job = await this.#jobs.create('probe.run');
    const outputPath = resolve(this.#workspaceRoot, `.wbc/jobs/${job.jobId}/technical-probe-report.json`);
    void runTechnicalProbes(outputPath)
      .then(async (report) => {
        const revision = await this.#writeProbeRevision(packagePath, outputPath);
        return this.#jobs.update((current) => ({ ...(current ?? job), status: report.summary.failed === 0 ? 'completed' : 'failed', updatedAt: new Date().toISOString(), outputPath, result: { summary: report.summary, revisionId: revision.revisionId, contractPath: revision.contractPath } }), job.jobId);
      })
      .catch((error: unknown) => this.#jobs.update((current) => ({ ...(current ?? job), status: 'failed', updatedAt: new Date().toISOString(), outputPath, error: { name: error instanceof Error ? error.name : 'UnknownError', message: error instanceof Error ? error.message : String(error), stage: 'probe' } }), job.jobId));
    return { ...job, status: 'running', outputPath };
  }

  async verifyReplica(packagePath: string): Promise<ServiceJob> {
    const job = await this.#jobs.create('replica.verify');
    const contractPath = resolve(this.#workspaceRoot, packagePath, 'behavior-contract.json');
    const outputPath = resolve(this.#workspaceRoot, `.wbc/jobs/${job.jobId}/replica-verification.json`);
    void verifyPhase0(contractPath, { target: 'replica', outputFile: outputPath })
      .then((report: VerificationReport) => this.#jobs.update((current) => ({ ...(current ?? job), status: report.summary.failed === 0 ? 'completed' : 'failed', updatedAt: new Date().toISOString(), outputPath, result: { summary: report.summary } }), job.jobId))
      .catch((error: unknown) => this.#jobs.update((current) => ({ ...(current ?? job), status: 'failed', updatedAt: new Date().toISOString(), outputPath, error: { name: error instanceof Error ? error.name : 'UnknownError', message: error instanceof Error ? error.message : String(error), stage: 'verify' } }), job.jobId));
    return { ...job, status: 'running', outputPath };
  }

  async exportCapture(sourcePath: string, destinationPath: string): Promise<{ sourcePath: string; destinationPath: string; snapshot: ImmutableSnapshot }> {
    const snapshot = await this.#snapshot(sourcePath);
    const source = resolve(this.#workspaceRoot, sourcePath);
    const destination = resolve(this.#workspaceRoot, destinationPath);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true, errorOnExist: true });
    await inspectSessionPackage(destination);
    return { sourcePath: source, destinationPath: destination, snapshot };
  }
}
