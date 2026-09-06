import type { Frame, Page, Worker } from 'playwright';
import { drainPageObserver, readPageObserver, type PageObserverState } from './browser-observer.js';
import type { CaptureTargetKind, ElementRef, EvidenceRecord, TargetCoverage } from './types.js';

interface WorkerObserverState {
  records: Array<{
    id: string;
    sequence: number;
    sourceTime: number;
    receiveTime: number;
    type: string;
    payload: Record<string, unknown>;
  }>;
  droppedRecords: number;
  timeOrigin: number;
  now: number;
}

interface RealmClock {
  timeOrigin: number;
  now: number;
}

interface RealmSnapshot<T> {
  observer?: T;
  clock?: RealmClock;
  elements?: Array<Pick<ElementRef, 'dataWbcId' | 'instanceOrdinal' | 'bounds' | 'structuralFingerprint' | 'locatorCandidates' | 'ambiguity'>>;
  checkpointAt: number;
  hostBefore: number;
  hostReceiveTime: number;
  failure?: string;
}

async function sampleClock(read: () => Promise<RealmClock>): Promise<{ clock: RealmClock; hostBefore: number; hostReceiveTime: number }> {
  let best: { clock: RealmClock; hostBefore: number; hostReceiveTime: number } | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const hostBefore = Date.now();
    try {
      const clock = await read();
      const hostReceiveTime = Date.now();
      if (!best || hostReceiveTime - hostBefore < best.hostReceiveTime - best.hostBefore) {
        best = { clock, hostBefore, hostReceiveTime };
      }
    } catch (error) {
      lastError = error;
    }
  }
  if (best) return best;
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

interface RegisteredFrame {
  frame: Frame;
  logicalId: string;
  targetId: string;
  navigationId: string;
  epoch: number;
  parentTargetId: string | null;
  attachedAt: number;
  url: string;
  lifecycleStatus: TargetCoverage['lifecycleStatus'];
  detachedAt?: number;
  coverageEnd?: number;
  snapshot?: RealmSnapshot<PageObserverState>;
  lifecycleGap?: string;
}

interface RegisteredWorker {
  worker: Worker;
  targetId: string;
  navigationId: string;
  epoch: number;
  parentTargetId: string;
  attachedAt: number;
  url: string;
  lifecycleStatus: TargetCoverage['lifecycleStatus'];
  detachedAt?: number;
  coverageEnd?: number;
  installation: Promise<void>;
  installationError?: string;
  snapshot?: RealmSnapshot<WorkerObserverState>;
  lifecycleGap?: string;
}

export interface CollectedTargetRecord {
  targetId: string;
  record: EvidenceRecord;
}

export interface TargetRegistrySnapshot {
  coverage: TargetCoverage[];
  records: CollectedTargetRecord[];
  elements: ElementRef[];
  streaming: {
    mode: 'host_batch';
    flushIntervalMs: number;
    batchSize: number;
    queueCapacity: number;
    queuePeak: number;
    coalescedRecordTypes: string[];
    batchCount: number;
    coalescedRecords: number;
    hostDroppedRecords: number;
  };
}

function clockMapping(snapshot: RealmSnapshot<unknown>): NonNullable<TargetCoverage['clockMapping']> | undefined {
  if (!snapshot.clock) return undefined;
  const mappedEpoch = snapshot.clock.timeOrigin + snapshot.clock.now;
  const hostMidpoint = snapshot.hostBefore + ((snapshot.hostReceiveTime - snapshot.hostBefore) / 2);
  const roundTripUncertainty = (snapshot.hostReceiveTime - snapshot.hostBefore) / 2;
  return {
    sourceTimeOrigin: { value: snapshot.clock.timeOrigin, unit: 'epoch_ms' },
    observedAt: { value: snapshot.clock.now, unit: 'ms' },
    mappedEpoch: { value: mappedEpoch, unit: 'epoch_ms' },
    hostReceiveTime: { value: snapshot.hostReceiveTime, unit: 'epoch_ms' },
    estimatedError: { value: Math.abs(hostMidpoint - mappedEpoch) + roundTripUncertainty, unit: 'ms' },
  };
}

function isInitialUrl(url: string): boolean {
  return url === '' || url === 'about:blank';
}

function classifyFrame(url: string, mainUrl: string, logicalId: string): CaptureTargetKind {
  if (logicalId === 'main') return 'main_frame';
  try {
    return new URL(url).origin === new URL(mainUrl).origin
      ? 'same_origin_iframe'
      : 'cross_origin_iframe';
  } catch {
    return 'same_origin_iframe';
  }
}

export class TargetRegistry {
  readonly #page: Page;
  readonly #maxRecords: number;
  readonly #currentFrames = new Map<Frame, RegisteredFrame>();
  readonly #frameHistory: RegisteredFrame[] = [];
  readonly #frameEpochs = new Map<string, number>();
  readonly #currentWorkers = new Map<Worker, RegisteredWorker>();
  readonly #workerHistory: RegisteredWorker[] = [];
  #nextFrame = 0;
  #nextWorker = 0;
  #mainEpoch = 1;
  #streamTimer: NodeJS.Timeout | undefined;
  #streamDrain: Promise<void> | undefined;
  #streamQueue: CollectedTargetRecord[] = [];
  #streamedRecords: CollectedTargetRecord[] = [];
  #streamBatchCount = 0;
  #streamCoalescedRecords = 0;
  #streamHostDroppedRecords = 0;
  #streamDroppedByTarget = new Map<string, number>();
  #streamingConfig = { flushIntervalMs: 50, batchSize: 128, queueCapacity: 10_000 };
  #streamPeakQueue = 0;

  constructor(page: Page, maxRecords = 10_000) {
    this.#page = page;
    this.#maxRecords = maxRecords;
    this.#registerFrame(page.mainFrame(), null, 'main');
    page.on('frameattached', (frame) => this.#registerFrame(frame));
    page.on('framenavigated', (frame) => this.#handleFrameNavigation(frame));
    page.on('framedetached', (frame) => this.#archiveFrame(frame, 'detached'));
    page.on('worker', (worker) => this.#registerWorker(worker));
  }

  startStreaming(options: { flushIntervalMs?: number; batchSize?: number; queueCapacity?: number } = {}): void {
    if (this.#streamTimer) return;
    this.#streamingConfig = {
      flushIntervalMs: options.flushIntervalMs ?? 50,
      batchSize: options.batchSize ?? 128,
      queueCapacity: options.queueCapacity ?? 10_000,
    };
    if (!Number.isInteger(this.#streamingConfig.flushIntervalMs) || this.#streamingConfig.flushIntervalMs < 1) {
      throw new Error('Streaming flush interval must be a positive integer');
    }
    if (!Number.isInteger(this.#streamingConfig.batchSize) || this.#streamingConfig.batchSize < 1) {
      throw new Error('Streaming batch size must be a positive integer');
    }
    if (!Number.isInteger(this.#streamingConfig.queueCapacity) || this.#streamingConfig.queueCapacity < this.#streamingConfig.batchSize) {
      throw new Error('Streaming queue capacity must be at least the batch size');
    }
    this.#streamTimer = setInterval(() => {
      void this.#drainStreaming();
    }, this.#streamingConfig.flushIntervalMs);
  }

  async stopStreaming(): Promise<void> {
    if (this.#streamTimer) clearInterval(this.#streamTimer);
    this.#streamTimer = undefined;
    await this.#drainStreaming();
    this.#flushStreamingQueue();
  }

  #flushStreamingQueue(): void {
    if (this.#streamQueue.length === 0) return;
    this.#streamedRecords.push(...this.#streamQueue.splice(0));
    this.#streamBatchCount += 1;
  }

  #enqueueStreamedRecord(record: CollectedTargetRecord): void {
    if (this.#streamQueue.length >= this.#streamingConfig.queueCapacity) {
      const coalescible = record.record.type === 'pointerover' || record.record.type === 'pointerout' || record.record.type === 'scroll';
      if (coalescible) {
        const existingIndex = this.#streamQueue.findIndex((candidate) => (
          candidate.targetId === record.targetId && candidate.record.type === record.record.type
        ));
        if (existingIndex >= 0) {
          this.#streamQueue[existingIndex] = record;
          this.#streamCoalescedRecords += 1;
          return;
        }
      }
      this.#streamHostDroppedRecords += 1;
      this.#streamDroppedByTarget.set(record.targetId, (this.#streamDroppedByTarget.get(record.targetId) ?? 0) + 1);
      return;
    }
    this.#streamQueue.push(record);
    this.#streamPeakQueue = Math.max(this.#streamPeakQueue, this.#streamQueue.length);
    if (this.#streamQueue.length >= this.#streamingConfig.batchSize) this.#flushStreamingQueue();
  }

  async #drainStreaming(): Promise<void> {
    if (this.#streamDrain) return this.#streamDrain;
    this.#streamDrain = (async () => {
      for (const registered of this.#currentFrames.values()) {
        if (registered.frame.isDetached()) continue;
        try {
          const observer = await drainPageObserver(registered.frame);
          for (const raw of observer.records) this.#enqueueStreamedRecord({ targetId: registered.targetId, record: {
            ...raw,
            id: `${registered.targetId}:${raw.id}`,
            ...(raw.targetRef ? { targetRef: raw.targetRef.replace('nav-1:main', registered.targetId) } : {}),
          } });
        } catch {
          // Final checkpoint records the collector failure and coverage gap.
        }
      }
      for (const registered of this.#currentWorkers.values()) {
        await registered.installation;
        try {
          const observer = await registered.worker.evaluate(() => {
            const state = (globalThis as unknown as { __WBC_WORKER_OBSERVER__: WorkerObserverState }).__WBC_WORKER_OBSERVER__;
            const records = state.records.splice(0, state.records.length);
            return { ...state, records, timeOrigin: performance.timeOrigin, now: performance.now() };
          });
          for (const raw of observer.records) this.#enqueueStreamedRecord({
            targetId: registered.targetId,
            record: { ...raw, id: `${registered.targetId}:${raw.id}`, source: 'page' },
          });
        } catch {
          // Worker lifecycle errors are represented by target coverage.
        }
      }
    })().finally(() => { this.#streamDrain = undefined; });
    return this.#streamDrain;
  }

  #createFrameEntry(frame: Frame, logicalId: string, epoch: number, parentTargetId: string | null): RegisteredFrame {
    const rootNavigationId = parentTargetId?.split(':')[0] ?? `nav-${this.#mainEpoch}`;
    const isMain = logicalId === 'main';
    const navigationId = isMain ? rootNavigationId : `${rootNavigationId}/${logicalId}/${epoch}`;
    const targetId = isMain ? `${rootNavigationId}:main` : `${rootNavigationId}:${logicalId}:epoch-${epoch}`;
    const entry: RegisteredFrame = {
      frame,
      logicalId,
      targetId,
      navigationId,
      epoch,
      parentTargetId,
      attachedAt: Date.now(),
      url: frame.url(),
      lifecycleStatus: 'active',
    };
    this.#currentFrames.set(frame, entry);
    this.#frameHistory.push(entry);
    this.#frameEpochs.set(logicalId, epoch);
    return entry;
  }

  #registerFrame(frame: Frame, explicitParent: string | null = null, explicitLogicalId?: string): RegisteredFrame {
    const existing = this.#currentFrames.get(frame);
    if (existing) return existing;
    const logicalId = explicitLogicalId ?? `frame-${++this.#nextFrame}`;
    const parent = frame.parentFrame();
    const parentTargetId = logicalId === 'main'
      ? null
      : (parent ? this.#registerFrame(parent).targetId : explicitParent);
    return this.#createFrameEntry(frame, logicalId, 1, parentTargetId);
  }

  #handleFrameNavigation(frame: Frame): void {
    const current = this.#currentFrames.get(frame) ?? this.#registerFrame(frame);
    const nextUrl = frame.url();
    if (isInitialUrl(current.url)) {
      current.url = nextUrl;
      current.attachedAt = Date.now();
      return;
    }
    if (nextUrl === current.url) return;

    this.#archiveFrame(frame, 'navigated');
    if (current.logicalId === 'main') this.#mainEpoch += 1;
    const nextEpoch = (this.#frameEpochs.get(current.logicalId) ?? current.epoch) + 1;
    const parent = frame.parentFrame();
    const parentTargetId = current.logicalId === 'main'
      ? null
      : (parent ? this.#currentFrames.get(parent)?.targetId ?? current.parentTargetId : current.parentTargetId);
    this.#createFrameEntry(frame, current.logicalId, nextEpoch, parentTargetId);
  }

  #archiveFrame(frame: Frame, status: 'navigated' | 'detached'): void {
    const current = this.#currentFrames.get(frame);
    if (!current || current.lifecycleStatus !== 'active') return;
    const endedAt = Date.now();
    current.lifecycleStatus = status;
    current.detachedAt = endedAt;
    current.coverageEnd = current.snapshot?.checkpointAt ?? endedAt;
    current.lifecycleGap = status === 'navigated'
      ? 'checkpoint_to_navigation_unobserved'
      : 'checkpoint_to_detach_unobserved';
    this.#currentFrames.delete(frame);
  }

  #registerWorker(worker: Worker): void {
    if (this.#currentWorkers.has(worker)) return;
    const workerNumber = ++this.#nextWorker;
    const registered: RegisteredWorker = {
      worker,
      targetId: `nav-${this.#mainEpoch}:worker-${workerNumber}:epoch-1`,
      navigationId: `nav-${this.#mainEpoch}/worker-${workerNumber}/1`,
      epoch: 1,
      parentTargetId: this.#currentFrames.get(this.#page.mainFrame())?.targetId ?? `nav-${this.#mainEpoch}:main`,
      attachedAt: Date.now(),
      url: worker.url(),
      lifecycleStatus: 'active',
      installation: Promise.resolve(),
    };
    registered.installation = worker.evaluate('globalThis.__name = globalThis.__name || ((target) => target)')
      .then(() => worker.evaluate((limit) => {
        const state = {
          records: [] as WorkerObserverState['records'],
          droppedRecords: 0,
          sequence: 0,
        };
        const push = (type: string, payload: Record<string, unknown>) => {
          if (state.records.length >= limit) {
            state.droppedRecords += 1;
            return;
          }
          state.sequence += 1;
          state.records.push({
            id: `worker-${state.sequence}`,
            sequence: state.sequence,
            sourceTime: performance.now(),
            receiveTime: Date.now(),
            type,
            payload,
          });
        };
        self.addEventListener('message', (event) => push('message-received', { dataType: typeof event.data }));
        (globalThis as unknown as { __WBC_WORKER_OBSERVER__: typeof state }).__WBC_WORKER_OBSERVER__ = state;
        push('collector-installed', { url: location.href });
      }, this.#maxRecords))
      .catch((error: unknown) => {
        registered.installationError = error instanceof Error ? error.message : String(error);
      });
    this.#currentWorkers.set(worker, registered);
    this.#workerHistory.push(registered);
    worker.on('close', () => this.#archiveWorker(worker));
  }

  #archiveWorker(worker: Worker): void {
    const current = this.#currentWorkers.get(worker);
    if (!current || current.lifecycleStatus !== 'active') return;
    const endedAt = Date.now();
    current.lifecycleStatus = 'detached';
    current.detachedAt = endedAt;
    current.coverageEnd = current.snapshot?.checkpointAt ?? endedAt;
    current.lifecycleGap = 'checkpoint_to_worker_destroy_unobserved';
    this.#currentWorkers.delete(worker);
  }

  async #snapshotFrame(registered: RegisteredFrame): Promise<void> {
    let observer: PageObserverState | undefined;
    let clock: RealmClock | undefined;
    let elements: RealmSnapshot<PageObserverState>['elements'];
    let failure: string | undefined;
    try {
      observer = await readPageObserver(registered.frame);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    let hostBefore = Date.now();
    let hostReceiveTime = hostBefore;
    try {
      const sample = await sampleClock(() => registered.frame.evaluate(() => ({ timeOrigin: performance.timeOrigin, now: performance.now() })));
      clock = sample.clock;
      hostBefore = sample.hostBefore;
      hostReceiveTime = sample.hostReceiveTime;
    } catch (error) {
      failure ??= error instanceof Error ? error.message : String(error);
    }
    try {
      elements = await registered.frame.locator('[data-wbc-id]').evaluateAll((matches) => {
        const inferRole = (element: Element): string | null => {
          const explicit = element.getAttribute('role');
          if (explicit) return explicit;
          if (element instanceof HTMLButtonElement) return 'button';
          if (element instanceof HTMLAnchorElement && element.hasAttribute('href')) return 'link';
          if (element instanceof HTMLInputElement) return element.type === 'checkbox' ? 'checkbox' : 'textbox';
          return null;
        };
        const allElements = [...document.body.querySelectorAll('*')];
        const documentHeight = Math.max(document.documentElement.scrollHeight, 1);
        return matches.map((element) => {
          const htmlElement = element as HTMLElement;
          const dataWbcId = htmlElement.dataset.wbcId ?? '';
          const dataSelector = `[data-wbc-id="${CSS.escape(dataWbcId)}"]`;
          const duplicateElements = matches.filter((candidate) => (candidate as HTMLElement).dataset.wbcId === dataWbcId);
          const candidates: Array<{
            strategy: 'data_attribute' | 'id' | 'role';
            value: string;
            score: number;
            matchCount: number;
          }> = [{
            strategy: 'data_attribute',
            value: dataSelector,
            score: 1,
            matchCount: document.querySelectorAll(dataSelector).length,
          }];
          if (htmlElement.id) {
            const idSelector = `#${CSS.escape(htmlElement.id)}`;
            candidates.push({ strategy: 'id', value: idSelector, score: 0.95, matchCount: document.querySelectorAll(idSelector).length });
          }
          const role = inferRole(element);
          if (role) {
            candidates.push({
              strategy: 'role',
              value: role,
              score: 0.7,
              matchCount: matches.filter((candidate) => inferRole(candidate) === role).length,
            });
          }
          candidates.sort((left, right) => {
            const uniqueDelta = Number(right.matchCount === 1) - Number(left.matchCount === 1);
            return uniqueDelta || right.score - left.score;
          });
          const preferred = candidates[0]!;
          const rect = element.getBoundingClientRect();
          const computed = getComputedStyle(element);
          const transitionDurations = computed.transitionDuration.split(',').map((value) => {
            const trimmed = value.trim();
            return trimmed.endsWith('ms') ? Number.parseFloat(trimmed) : Number.parseFloat(trimmed) * 1000;
          });
          let depth = 0;
          for (let current = element.parentElement; current; current = current.parentElement) depth += 1;
          return {
            dataWbcId,
            instanceOrdinal: duplicateElements.indexOf(element) + 1,
            bounds: { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height },
            structuralFingerprint: {
              tagName: element.tagName.toLowerCase(),
              role,
              depth,
              childElementCount: element.childElementCount,
              documentOrder: allElements.indexOf(element),
              documentProgress: (rect.top + scrollY) / documentHeight,
              widthRatio: rect.width / Math.max(document.documentElement.clientWidth, 1),
              heightPx: rect.height,
              hasTransition: transitionDurations.some((duration) => duration > 0),
              transitionDurationMs: Math.max(0, ...transitionDurations.filter(Number.isFinite)),
            },
            locatorCandidates: candidates,
            ambiguity: {
              status: preferred.matchCount === 1 ? 'unique' as const : 'ambiguous' as const,
              preferredStrategy: preferred.strategy,
              matchCount: preferred.matchCount,
            },
          };
        });
      });
    } catch (error) {
      failure ??= error instanceof Error ? error.message : String(error);
    }
    registered.snapshot = {
      ...(observer ? { observer } : {}),
      ...(clock ? { clock } : {}),
      ...(elements ? { elements } : {}),
      checkpointAt: Date.now(),
      hostBefore,
      hostReceiveTime,
      ...(failure ? { failure } : {}),
    };
  }

  async #snapshotWorker(registered: RegisteredWorker): Promise<void> {
    await registered.installation;
    let observer: WorkerObserverState | undefined;
    let clock: RealmClock | undefined;
    let failure = registered.installationError;
    if (!failure) {
      try {
        observer = await registered.worker.evaluate(() => {
          const state = (globalThis as unknown as { __WBC_WORKER_OBSERVER__: Omit<WorkerObserverState, 'timeOrigin' | 'now'> }).__WBC_WORKER_OBSERVER__;
          return { ...state, timeOrigin: performance.timeOrigin, now: performance.now() };
        });
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
    }
    let hostBefore = Date.now();
    let hostReceiveTime = hostBefore;
    if (!failure) {
      try {
        const sample = await sampleClock(() => registered.worker.evaluate(() => ({ timeOrigin: performance.timeOrigin, now: performance.now() })));
        clock = sample.clock;
        hostBefore = sample.hostBefore;
        hostReceiveTime = sample.hostReceiveTime;
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
    }
    registered.snapshot = {
      ...(observer ? { observer } : {}),
      ...(clock ? { clock } : {}),
      checkpointAt: Date.now(),
      hostBefore,
      hostReceiveTime,
      ...(failure ? { failure } : {}),
    };
  }

  async checkpoint(): Promise<void> {
    for (const registered of this.#currentFrames.values()) {
      if (!registered.frame.isDetached()) await this.#snapshotFrame(registered);
    }
    for (const registered of this.#currentWorkers.values()) await this.#snapshotWorker(registered);
  }

  async collect(): Promise<TargetRegistrySnapshot> {
    for (const frame of this.#page.frames()) this.#registerFrame(frame);
    await this.checkpoint();

    const coverage: TargetCoverage[] = [];
    const records: CollectedTargetRecord[] = [...this.#streamedRecords, ...this.#streamQueue];
    const elements: ElementRef[] = [];
    const mainUrl = this.#frameHistory.find((entry) => entry.logicalId === 'main' && entry.lifecycleStatus === 'active')?.url
      ?? this.#page.mainFrame().url();

    for (const registered of this.#frameHistory) {
      const observer = registered.snapshot?.observer;
      for (const observed of registered.snapshot?.elements ?? []) {
        const dataCandidate = observed.locatorCandidates.find((candidate) => candidate.strategy === 'data_attribute');
        const needsOrdinal = (dataCandidate?.matchCount ?? 0) > 1;
        const elementId = `${registered.targetId}:${observed.dataWbcId}${needsOrdinal ? `:${observed.instanceOrdinal}` : ''}`;
        elements.push({
          id: elementId,
          navigationId: registered.navigationId,
          targetId: registered.targetId,
          frame: registered.logicalId === 'main' ? 'main' : 'iframe',
          coordinateSpace: 'document',
          selector: observed.locatorCandidates[0]!.value,
          ...observed,
        });
      }
      if (observer) {
        for (const raw of observer.records) {
          const normalizedTargetRef = raw.targetRef?.replace('nav-1:main', registered.targetId);
          records.push({
            targetId: registered.targetId,
            record: {
              ...raw,
              id: `${registered.targetId}:${raw.id}`,
              ...(normalizedTargetRef ? { targetRef: normalizedTargetRef } : {}),
            },
          });
        }
      }
      const streamedCount = [...this.#streamedRecords, ...this.#streamQueue].filter((candidate) => candidate.targetId === registered.targetId).length;
      const droppedRecords = (observer?.droppedRecords ?? 0) + (this.#streamDroppedByTarget.get(registered.targetId) ?? 0);
      const failed = !observer;
      const archived = registered.lifecycleStatus !== 'active';
      const gaps = [
        ...(registered.lifecycleGap ? [registered.lifecycleGap] : []),
        ...(registered.snapshot?.failure ? [`collector_unavailable: ${registered.snapshot.failure}`] : []),
      ];
      const mappedClock = registered.snapshot ? clockMapping(registered.snapshot) : undefined;
      coverage.push({
        targetId: registered.targetId,
        navigationId: registered.navigationId,
        epoch: registered.epoch,
        parentTargetId: registered.parentTargetId,
        kind: classifyFrame(registered.url, mainUrl, registered.logicalId),
        url: registered.url,
        attachedAt: { value: registered.attachedAt, unit: 'epoch_ms' },
        ...(registered.detachedAt ? { detachedAt: { value: registered.detachedAt, unit: 'epoch_ms' as const } } : {}),
        ...(registered.coverageEnd ? { coverageEnd: { value: registered.coverageEnd, unit: 'epoch_ms' as const } } : {}),
        lifecycleStatus: registered.lifecycleStatus,
        coverageStart: 'document_start',
        collector: {
          status: failed ? 'failed' : 'installed',
          recordCount: streamedCount + (observer?.records.length ?? 0),
          droppedRecords,
          knownLoss: droppedRecords > 0,
        },
        ...(mappedClock ? { clockMapping: mappedClock } : {}),
        completeness: failed || archived ? 'partial' : 'full',
        gaps,
      });
    }

    for (const registered of this.#workerHistory) {
      const observer = registered.snapshot?.observer;
      if (observer) {
        for (const raw of observer.records) {
          records.push({
            targetId: registered.targetId,
            record: { ...raw, id: `${registered.targetId}:${raw.id}`, source: 'page' },
          });
        }
      }
      const droppedRecords = (observer?.droppedRecords ?? 0) + (this.#streamDroppedByTarget.get(registered.targetId) ?? 0);
      const failed = !observer;
      const gaps = [
        'worker_start_to_collector_install',
        ...(registered.lifecycleGap ? [registered.lifecycleGap] : []),
        ...(registered.snapshot?.failure ? [`collector_install_failed: ${registered.snapshot.failure}`] : []),
      ];
      const mappedClock = registered.snapshot ? clockMapping(registered.snapshot) : undefined;
      coverage.push({
        targetId: registered.targetId,
        navigationId: registered.navigationId,
        epoch: registered.epoch,
        parentTargetId: registered.parentTargetId,
        kind: 'dedicated_worker',
        url: registered.url,
        attachedAt: { value: registered.attachedAt, unit: 'epoch_ms' },
        ...(registered.detachedAt ? { detachedAt: { value: registered.detachedAt, unit: 'epoch_ms' as const } } : {}),
        ...(registered.coverageEnd ? { coverageEnd: { value: registered.coverageEnd, unit: 'epoch_ms' as const } } : {}),
        lifecycleStatus: registered.lifecycleStatus,
        coverageStart: 'runtime',
        collector: {
          status: failed ? 'failed' : 'installed',
          recordCount: [...this.#streamedRecords, ...this.#streamQueue].filter((candidate) => candidate.targetId === registered.targetId).length + (observer?.records.length ?? 0),
          droppedRecords,
          knownLoss: droppedRecords > 0,
        },
        ...(mappedClock ? { clockMapping: mappedClock } : {}),
        completeness: 'partial',
        gaps,
      });
    }

    return {
      coverage,
      records,
      elements,
      streaming: {
        mode: 'host_batch',
        flushIntervalMs: this.#streamingConfig.flushIntervalMs,
        batchSize: this.#streamingConfig.batchSize,
        queueCapacity: this.#streamingConfig.queueCapacity,
        queuePeak: this.#streamPeakQueue,
        coalescedRecordTypes: ['pointerover', 'pointerout', 'scroll'],
        batchCount: this.#streamBatchCount,
        coalescedRecords: this.#streamCoalescedRecords,
        hostDroppedRecords: this.#streamHostDroppedRecords,
      },
    };
  }
}
