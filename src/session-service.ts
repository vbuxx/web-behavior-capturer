import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { captureSession, CaptureCancelledError } from './capture.js';
import { inspectSessionPackage, querySessionBehaviors, querySessionRecords, type SessionRecordQuery } from './session-index.js';
import { validateContract, validateSessionIndexManifest } from './validate.js';
import { normalizeProbeRequest, runTechnicalProbes, type ProbeRunRequest } from './probes.js';
import { verifyPhase0 } from './verify.js';
import type { BehaviorKind, CaptureSessionState, ContractPackage, VerificationReport } from './types.js';
import { readRevisionIndex, revisionEntryFor, validateRevision, writeRevisionIndex, type RevisionEntry } from './revisions.js';
import { validateEvidenceGraph } from './evidence-graph-validate.js';
import type { EvidenceGraph } from './evidence-graph.js';
import { compileEvidenceGraph } from './evidence-graph.js';
import type { EvidenceRecord } from './types.js';
import { createAnnotationRevision } from './annotation-revision.js';

export type ServiceJobStatus = 'queued' | 'running' | 'stopping' | 'finalizing' | 'completed' | 'cancelled' | 'failed';

export interface ServiceJobError {
  name: string;
  message: string;
  stage: string;
}

export interface ServiceJob {
  jobId: string;
  operation: string;
  status: ServiceJobStatus;
  createdAt: string;
  updatedAt: string;
  outputPath?: string;
  parameters?: Record<string, unknown>;
  cancelRequestedAt?: string;
  heartbeatAt?: string;
  workerPid?: number;
  result?: Record<string, unknown>;
  error?: ServiceJobError;
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
  constructor(path: string) { this.#path = resolve(path); }
  get path(): string { return this.#path; }

  #database(): DatabaseSync {
    const database = new DatabaseSync(this.#path);
    database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        output_path TEXT,
        parameters_json TEXT,
        cancel_requested_at TEXT,
        heartbeat_at TEXT,
        worker_pid INTEGER,
        result_json TEXT,
        error_json TEXT
      );
    `);
    return database;
  }

  #fromRow(row: Record<string, unknown>): ServiceJob {
    return {
      jobId: String(row.job_id), operation: String(row.operation), status: row.status as ServiceJobStatus,
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      ...(row.output_path ? { outputPath: String(row.output_path) } : {}),
      ...(row.parameters_json ? { parameters: JSON.parse(String(row.parameters_json)) as Record<string, unknown> } : {}),
      ...(row.cancel_requested_at ? { cancelRequestedAt: String(row.cancel_requested_at) } : {}),
      ...(row.heartbeat_at ? { heartbeatAt: String(row.heartbeat_at) } : {}),
      ...(row.worker_pid ? { workerPid: Number(row.worker_pid) } : {}),
      ...(row.result_json ? { result: JSON.parse(String(row.result_json)) as Record<string, unknown> } : {}),
      ...(row.error_json ? { error: JSON.parse(String(row.error_json)) as ServiceJobError } : {}),
    };
  }

  async create(operation: string, parameters: Record<string, unknown> = {}): Promise<ServiceJob> {
    const job: ServiceJob = {
      jobId: randomUUID(), operation, status: 'queued',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      parameters,
    };
    await mkdir(dirname(this.#path), { recursive: true });
    const database = this.#database();
    try {
      database.prepare(`INSERT INTO jobs (job_id, operation, status, created_at, updated_at, parameters_json) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(job.jobId, job.operation, job.status, job.createdAt, job.updatedAt, JSON.stringify(parameters));
    } finally { database.close(); }
    return job;
  }

  async get(jobId: string): Promise<ServiceJob> {
    await mkdir(dirname(this.#path), { recursive: true });
    const database = this.#database();
    try {
      const row = database.prepare('SELECT * FROM jobs WHERE job_id = ?').get(jobId) as Record<string, unknown> | undefined;
      if (!row) throw new Error(`Unknown job: ${jobId}`);
      return this.#fromRow(row);
    } finally { database.close(); }
  }

  async update(mutator: (job: ServiceJob | undefined) => ServiceJob, jobId: string): Promise<ServiceJob> {
    await mkdir(dirname(this.#path), { recursive: true });
    const database = this.#database();
    try {
      database.exec('BEGIN IMMEDIATE');
      const row = database.prepare('SELECT * FROM jobs WHERE job_id = ?').get(jobId) as Record<string, unknown> | undefined;
      const result = mutator(row ? this.#fromRow(row) : undefined);
      database.prepare(`
        INSERT INTO jobs (job_id, operation, status, created_at, updated_at, output_path, parameters_json, cancel_requested_at, heartbeat_at, worker_pid, result_json, error_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_id) DO UPDATE SET
          operation=excluded.operation, status=excluded.status, created_at=excluded.created_at, updated_at=excluded.updated_at,
          output_path=excluded.output_path, parameters_json=excluded.parameters_json, cancel_requested_at=excluded.cancel_requested_at,
          heartbeat_at=excluded.heartbeat_at, worker_pid=excluded.worker_pid, result_json=excluded.result_json, error_json=excluded.error_json
      `).run(
        result.jobId, result.operation, result.status, result.createdAt, result.updatedAt, result.outputPath ?? null,
        JSON.stringify(result.parameters ?? {}), result.cancelRequestedAt ?? null, result.heartbeatAt ?? null,
        result.workerPid ?? null, result.result ? JSON.stringify(result.result) : null, result.error ? JSON.stringify(result.error) : null,
      );
      database.exec('COMMIT');
      return result;
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch { /* transaction may not have started */ }
      throw error;
    } finally { database.close(); }
  }

  async requestCancellation(jobId: string): Promise<ServiceJob> {
    return this.update((current) => {
      if (!current) throw new Error(`Unknown job: ${jobId}`);
      if (['completed', 'cancelled', 'failed'].includes(current.status)) return current;
      return { ...current, status: 'stopping', cancelRequestedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    }, jobId);
  }
}

function serviceStatus(state: CaptureSessionState): ServiceJobStatus {
  if (state === 'running') return 'running';
  if (state === 'stopping') return 'stopping';
  if (state === 'finalizing') return 'finalizing';
  if (state === 'completed') return 'completed';
  if (state === 'cancelled') return 'cancelled';
  return 'failed';
}

export class SessionService {
  readonly #workspaceRoot: string;
  readonly #jobs: LocalJobStore;
  readonly #controllers = new Map<string, AbortController>();

  constructor(options: SessionServiceOptions = {}) {
    this.#workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
    this.#jobs = new LocalJobStore(options.jobStorePath ?? resolve(this.#workspaceRoot, '.wbc/jobs.sqlite'));
  }

  async status(jobId: string): Promise<ServiceJob> { return this.#jobs.get(jobId); }

  async startCapture(options: { outputPath?: string; maxRecords?: number; visualPolicyPath?: string; resumedFromSessionId?: string; resumeCheckpoint?: string; resumePackagePath?: string } = {}): Promise<ServiceJob> {
    const job = await this.#jobs.create('capture.start');
    const outputPath = resolve(this.#workspaceRoot, options.outputPath ?? `.wbc/sessions/${job.jobId}`);
    const parameters = { ...options, outputPath };
    await this.#jobs.update((current) => ({ ...(current ?? job), status: 'running', updatedAt: new Date().toISOString(), outputPath, parameters }), job.jobId);
    const cliPath = fileURLToPath(new URL('./cli.ts', import.meta.url));
    const worker = spawn(process.execPath, ['--import', 'tsx/esm', cliPath, 'capture-worker', '--job', job.jobId], {
      cwd: this.#workspaceRoot,
      env: { ...process.env, WBC_WORKSPACE_ROOT: this.#workspaceRoot, WBC_JOB_STORE: this.#jobs.path },
      detached: true,
      stdio: 'ignore',
    });
    worker.unref();
    return this.#jobs.update((current) => ({ ...(current ?? job), status: 'running', updatedAt: new Date().toISOString(), outputPath, ...(worker.pid ? { workerPid: worker.pid } : {}) }), job.jobId);
  }

  async stopCapture(jobId: string): Promise<ServiceJob> {
    const controller = this.#controllers.get(jobId);
    const job = await this.#jobs.requestCancellation(jobId);
    controller?.abort();
    return job;
  }

  async runCaptureWorker(jobId: string): Promise<void> {
    const initial = await this.#jobs.get(jobId);
    const parameters = initial.parameters ?? {};
    const outputPath = String(parameters.outputPath ?? initial.outputPath ?? resolve(this.#workspaceRoot, `.wbc/sessions/${jobId}`));
    const controller = new AbortController();
    this.#controllers.set(jobId, controller);
    let polling = true;
    const poll = async (): Promise<void> => {
      if (!polling) return;
      const current = await this.#jobs.get(jobId);
      if (current.cancelRequestedAt) controller.abort();
      await this.#jobs.update((latest) => ({ ...(latest ?? initial), heartbeatAt: new Date().toISOString(), updatedAt: new Date().toISOString() }), jobId);
    };
    const timer = setInterval(() => { void poll().catch(() => undefined); }, 100);
    try {
      const result = await captureSession(outputPath, {
        signal: controller.signal,
        ...(typeof parameters.maxRecords === 'number' ? { maxPageRecords: parameters.maxRecords } : {}),
        ...(typeof parameters.visualPolicyPath === 'string' ? { visualPolicyPath: resolve(this.#workspaceRoot, parameters.visualPolicyPath) } : {}),
        ...(typeof parameters.resumedFromSessionId === 'string' ? { resumedFromSessionId: parameters.resumedFromSessionId } : {}),
        ...(typeof parameters.resumeCheckpoint === 'string' ? { resumeCheckpoint: parameters.resumeCheckpoint } : {}),
        ...(typeof parameters.resumePackagePath === 'string' ? { resumePackagePath: resolve(this.#workspaceRoot, parameters.resumePackagePath) } : {}),
        onStateChange: (state) => { void this.#jobs.update((current) => ({ ...(current ?? initial), status: serviceStatus(state), updatedAt: new Date().toISOString(), outputPath }), jobId); },
      });
      await this.#jobs.update((current) => ({ ...(current ?? initial), status: 'completed', updatedAt: new Date().toISOString(), outputPath, result: { sessionId: result.contract.manifest.sessionId, behaviors: result.contract.behaviors.length } }), jobId);
    } catch (error) {
      await this.#jobs.update((current) => ({
        ...(current ?? initial), status: error instanceof CaptureCancelledError ? 'cancelled' : 'failed', updatedAt: new Date().toISOString(), outputPath,
        error: { name: error instanceof Error ? error.name : 'UnknownError', message: error instanceof Error ? error.message : String(error), stage: 'capture' },
      }), jobId);
    } finally {
      polling = false;
      clearInterval(timer);
      this.#controllers.delete(jobId);
    }
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

  async #writeProbeRevision(packagePath: string, reportPath: string, baseRevisionId?: string, behaviorIds: string[] = []): Promise<{ revisionId: string; contractPath: string; reportPath: string }> {
    const packageRoot = resolve(this.#workspaceRoot, packagePath);
    const index = await validateSessionIndexManifest(JSON.parse(await readFile(resolve(packageRoot, 'session-index.json'), 'utf8')));
    const indexedContract = await validateContract(JSON.parse(await readFile(resolve(packageRoot, index.contract.path), 'utf8')));
    const revisions = await readRevisionIndex(packageRoot, indexedContract.manifest.sessionId);
    const selectedBase = revisionEntryFor(revisions, baseRevisionId);
    if (baseRevisionId && !selectedBase) throw new Error(`Unknown base revision: ${baseRevisionId}`);
    const baseRevision = selectedBase ? await validateRevision(packageRoot, selectedBase) : undefined;
    const baseContract = baseRevision?.contract ?? indexedContract;
    let baseGraph: EvidenceGraph;
    if (baseRevision) {
      baseGraph = baseRevision.graph;
    } else if (index.evidenceGraph) {
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
    const testedBehaviorIds = behaviorIds.length > 0 ? behaviorIds : revisionContract.behaviors.map((behavior) => behavior.behaviorId);
    const graph: EvidenceGraph = {
      ...baseGraph,
      revision: revisionId,
      generatedAt: new Date().toISOString(),
      nodes: [
        ...baseGraph.nodes.filter((node) => node.kind !== 'probe_run'),
        ...testedBehaviorIds.map((behaviorId) => ({ id: `probe:${revisionId}:${behaviorId}`, kind: 'probe_run' as const, evidenceRefs: [probeEvidenceId], targetRef: revisionContract.behaviors.find((behavior) => behavior.behaviorId === behaviorId)?.targetRef ?? null, navigationId: null, clockUncertaintyMs: null, payload: { status: 'completed', reportPath: relativeReportPath, behaviorId } })),
      ],
      edges: baseGraph.edges.filter((edge) => !edge.from.startsWith('probe:') && !edge.to.startsWith('probe:')),
      limitations: baseGraph.limitations.filter((limitation) => !limitation.includes('Probe-run node is a placeholder')),
    };
    graph.edges.push(...testedBehaviorIds.flatMap((behaviorId, index) => {
      const behavior = revisionContract.behaviors.find((candidate) => candidate.behaviorId === behaviorId);
      if (!behavior) return [];
      return [{
      id: `edge:probe:${revisionId}:${index}`,
      from: `probe:${revisionId}:${behaviorId}`,
      to: `state:${behavior.behaviorId}`,
      class: 'experiment_supported' as const,
      evidenceRefs: [probeEvidenceId],
      targetRef: behavior.targetRef,
      navigationId: null,
      clockUncertaintyMs: null,
      limitation: 'Probe/control variation is recorded for this behavior; causal scope is limited to the declared target and navigation.',
      }];
    }));
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
    revisions.revisions.push(revisionEntry);
    revisions.activeRevisionId = revisionId;
    await writeRevisionIndex(packageRoot, revisions);
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

  async runProbe(packagePath = 'artifacts/phase1/latest', request: ProbeRunRequest = {}): Promise<ServiceJob> {
    const probePlan = normalizeProbeRequest(request);
    const job = await this.#jobs.create('probe.run', { packagePath, ...request, probePlan });
    const outputPath = resolve(this.#workspaceRoot, `.wbc/jobs/${job.jobId}/technical-probe-report.json`);
    await this.#jobs.update((current) => ({ ...(current ?? job), status: 'running', updatedAt: new Date().toISOString(), outputPath }), job.jobId);
    const probePromise = runTechnicalProbes(outputPath, probePlan);
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(`Probe timeout after ${probePlan.timeoutMs} ms`)), probePlan.timeoutMs);
      timeoutHandle.unref();
    });
    const heartbeatHandle = setInterval(() => {
      void this.#jobs.update((current) => ({ ...(current ?? job), heartbeatAt: new Date().toISOString(), updatedAt: new Date().toISOString() }), job.jobId).catch(() => undefined);
    }, 100);
    heartbeatHandle.unref();
    void Promise.race([probePromise, timeoutPromise])
      .then(async (report) => {
        const current = await this.#jobs.get(job.jobId);
        if (current.cancelRequestedAt) return this.#jobs.update((latest) => ({ ...(latest ?? current), status: 'cancelled', updatedAt: new Date().toISOString(), outputPath }), job.jobId);
        const revision = await this.#writeProbeRevision(packagePath, outputPath, typeof request.baseRevisionId === 'string' ? request.baseRevisionId : undefined, probePlan.behaviorIds);
        return this.#jobs.update((current) => ({ ...(current ?? job), status: report.summary.failed === 0 ? 'completed' : 'failed', updatedAt: new Date().toISOString(), outputPath, result: { summary: report.summary, revisionId: revision.revisionId, contractPath: revision.contractPath } }), job.jobId);
      })
      .catch((error: unknown) => this.#jobs.update((current) => ({ ...(current ?? job), status: 'failed', updatedAt: new Date().toISOString(), outputPath, error: { name: error instanceof Error ? error.name : 'UnknownError', message: error instanceof Error ? error.message : String(error), stage: 'probe' } }), job.jobId))
      .finally(() => { if (timeoutHandle) clearTimeout(timeoutHandle); clearInterval(heartbeatHandle); });
    return { ...job, status: 'running', outputPath, parameters: { packagePath, ...request, probePlan } };
  }

  async createAnnotation(packagePath: string, input: { note: string; targetRef?: string; evidenceRefs?: string[]; edgeCorrection?: { edgeId: string; class?: 'direct' | 'experiment_supported' | 'correlated' | 'unknown'; limitation?: string } }): Promise<{ revisionId: string; contractPath: string; graphPath: string }> {
    if (!input.note.trim()) throw new Error('Annotation note must not be empty');
    return createAnnotationRevision(resolve(this.#workspaceRoot, packagePath), {
      annotationId: randomUUID(),
      createdAt: new Date().toISOString(),
      note: input.note,
      ...(input.targetRef ? { targetRef: input.targetRef } : {}),
      ...(input.evidenceRefs ? { evidenceRefs: input.evidenceRefs } : {}),
      ...(input.edgeCorrection ? { edgeCorrection: input.edgeCorrection } : {}),
    });
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
