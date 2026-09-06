import { randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { captureSession, CaptureCancelledError } from './capture.js';
import { inspectSessionPackage, querySessionBehaviors, querySessionRecords, type SessionRecordQuery } from './session-index.js';
import { validateContract, validateSessionIndexManifest } from './validate.js';
import { runTechnicalProbes } from './probes.js';
import { verifyPhase0 } from './verify.js';
import type { BehaviorKind, CaptureSessionState, ContractPackage, VerificationReport } from './types.js';

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

  async startCapture(options: { outputPath?: string; maxRecords?: number; visualPolicyPath?: string } = {}): Promise<ServiceJob> {
    const job = await this.#jobs.create('capture.start');
    const outputPath = resolve(this.#workspaceRoot, options.outputPath ?? `.wbc/sessions/${job.jobId}`);
    const controller = new AbortController();
    this.#controllers.set(job.jobId, controller);
    void captureSession(outputPath, {
      signal: controller.signal,
      ...(options.maxRecords ? { maxPageRecords: options.maxRecords } : {}),
      ...(options.visualPolicyPath ? { visualPolicyPath: resolve(this.#workspaceRoot, options.visualPolicyPath) } : {}),
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

  async #snapshot(packagePath: string): Promise<ImmutableSnapshot> {
    const packageRoot = resolve(this.#workspaceRoot, packagePath);
    await inspectSessionPackage(packageRoot);
    const index = await validateSessionIndexManifest(JSON.parse(await readFile(resolve(packageRoot, 'session-index.json'), 'utf8')));
    const contract = await validateContract(JSON.parse(await readFile(resolve(packageRoot, index.contract.path), 'utf8')));
    return {
      sessionId: contract.manifest.sessionId,
      contractSchemaVersion: contract.schemaVersion,
      contractSha256: index.contract.sha256,
      ...(index.evidenceGraph ? { evidenceGraphSha256: index.evidenceGraph.sha256 } : {}),
    };
  }

  async listBehaviors(packagePath: string, options: { kind?: BehaviorKind; limit?: number; offset?: number } = {}): Promise<{ snapshot: ImmutableSnapshot; behaviors: Awaited<ReturnType<typeof querySessionBehaviors>> }> {
    const snapshot = await this.#snapshot(packagePath);
    return { snapshot, behaviors: await querySessionBehaviors(resolve(this.#workspaceRoot, packagePath), options) };
  }

  async getBehavior(packagePath: string, behaviorId: string): Promise<{ snapshot: ImmutableSnapshot; behavior: ContractPackage['behaviors'][number] }> {
    const packageRoot = resolve(this.#workspaceRoot, packagePath);
    const snapshot = await this.#snapshot(packagePath);
    const manifest = await validateSessionIndexManifest(JSON.parse(await readFile(resolve(packageRoot, 'session-index.json'), 'utf8')));
    const contract = await validateContract(JSON.parse(await readFile(resolve(packageRoot, manifest.contract.path), 'utf8')));
    const behavior = contract.behaviors.find((candidate) => candidate.behaviorId === behaviorId);
    if (!behavior) throw new Error(`Unknown behavior: ${behaviorId}`);
    return { snapshot, behavior };
  }

  async getEvidence(packagePath: string, query: SessionRecordQuery = {}): Promise<{ snapshot: ImmutableSnapshot; page: Awaited<ReturnType<typeof querySessionRecords>> }> {
    const snapshot = await this.#snapshot(packagePath);
    return { snapshot, page: await querySessionRecords(resolve(this.#workspaceRoot, packagePath), query) };
  }

  async runProbe(): Promise<ServiceJob> {
    const job = await this.#jobs.create('probe.run');
    const outputPath = resolve(this.#workspaceRoot, `.wbc/jobs/${job.jobId}/technical-probe-report.json`);
    void runTechnicalProbes(outputPath)
      .then((report) => this.#jobs.update((current) => ({ ...(current ?? job), status: report.summary.failed === 0 ? 'completed' : 'failed', updatedAt: new Date().toISOString(), outputPath, result: { summary: report.summary } }), job.jobId))
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
