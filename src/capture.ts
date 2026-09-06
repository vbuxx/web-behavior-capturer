import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { chromium, type Browser, type CDPSession, type Page } from 'playwright';
import { installPageObserver, measureFrameIntervals } from './browser-observer.js';
import { startFixtureServer } from './server.js';
import { buildSessionIndex } from './session-index.js';
import { TargetRegistry } from './target-registry.js';
import { validateContract } from './validate.js';
import type {
  Behavior,
  ContractPackage,
  ElementRef,
  EvidenceRecord,
  StyleSample,
} from './types.js';

interface AnimationSnapshot {
  style: StyleSample;
  classes: string[];
  animations: Array<{
    id: string;
    type: string;
    playState: string;
    currentTime: number | null;
    timing: {
      delay: number;
      duration: number;
      easing: string;
      iterations: number | 'infinite';
      direction: string;
      fill: string;
    };
    keyframes: Array<Record<string, string | number | null>>;
  }>;
}

interface EvidenceFile {
  id: string;
  absolutePath: string;
  mediaType: 'application/x-ndjson' | 'image/png';
}

class EvidenceRecorder {
  readonly records: EvidenceRecord[] = [];
  readonly files: EvidenceFile[] = [];
  #sequence = 0;

  record(
    source: EvidenceRecord['source'],
    type: string,
    payload: Record<string, unknown>,
    targetRef?: string,
    sourceTime = performance.now(),
  ): string {
    this.#sequence += 1;
    const id = `host-${this.#sequence}`;
    const record: EvidenceRecord = {
      id,
      source,
      sequence: this.#sequence,
      sourceTime,
      receiveTime: Date.now(),
      type,
      payload,
    };
    if (targetRef) record.targetRef = targetRef;
    this.records.push(record);
    return id;
  }

  ingest(record: EvidenceRecord, targetId: string): string {
    this.#sequence += 1;
    const id = `host-${this.#sequence}`;
    this.records.push({
      ...record,
      id,
      sequence: this.#sequence,
      ...(record.targetRef ? { targetRef: record.targetRef } : {}),
      payload: {
        ...record.payload,
        sourceRecordId: record.id,
        sourceSequence: record.sequence,
        sourceTargetId: targetId,
      },
    });
    return id;
  }

  async screenshot(page: Page, selector: string, label: string, visualDirectory: string): Promise<string> {
    const id = `visual-${label}`;
    const path = join(visualDirectory, `${label}.png`);
    const clip = await page.locator(selector).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const x = Math.max(0, rect.x);
      const y = Math.max(0, rect.y);
      const right = Math.min(innerWidth, rect.right);
      const bottom = Math.min(innerHeight, rect.bottom);
      if (right <= x || bottom <= y) throw new Error('Target is outside the current viewport');
      return { x, y, width: right - x, height: bottom - y };
    });
    await page.screenshot({ path, animations: 'allow', clip });
    this.files.push({ id, absolutePath: path, mediaType: 'image/png' });
    return id;
  }
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function median(values: number[]): number {
  return percentile(values, 0.5);
}

function round(value: number, digits = 3): number {
  return Number(value.toFixed(digits));
}

function durationFrom(snapshot: AnimationSnapshot, fallback = 0): number {
  return snapshot.animations[0]?.timing.duration ?? fallback;
}

function easingFrom(snapshot: AnimationSnapshot, fallback = 'unknown'): string {
  const easings = new Set(snapshot.animations.flatMap((animation) => {
    const easing = animation.type === 'CSSTransition'
      ? animation.timing.easing
      : animation.keyframes[0]?.easing;
    return typeof easing === 'string' && easing.length > 0 ? [easing] : [];
  }));
  if (easings.size === 1) return [...easings][0] ?? fallback;
  if (easings.size > 1) return 'per-track';
  return snapshot.animations[0]?.timing.easing ?? fallback;
}

async function sampleElement(page: Page, selector: string, extra: Partial<StyleSample> = {}): Promise<AnimationSnapshot> {
  return page.locator(selector).evaluate((element, sampleExtra) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const animations = element.getAnimations().map((animation) => {
      const effect = animation.effect instanceof KeyframeEffect ? animation.effect : null;
      const timing = effect?.getTiming();
      const duration = typeof timing?.duration === 'number' ? timing.duration : 0;
      return {
        id: animation.id,
        type: animation.constructor.name,
        playState: animation.playState,
        currentTime: typeof animation.currentTime === 'number' ? animation.currentTime : null,
        timing: {
          delay: timing?.delay ?? 0,
          duration,
          easing: timing?.easing ?? 'linear',
          iterations: timing?.iterations === Infinity ? 'infinite' as const : (timing?.iterations ?? 1),
          direction: timing?.direction ?? 'normal',
          fill: timing?.fill ?? 'none',
        },
        keyframes: (effect?.getKeyframes() ?? []).map((frame) => {
          const result: Record<string, string | number | null> = {};
          for (const [key, value] of Object.entries(frame)) {
            if (typeof value === 'string' || typeof value === 'number' || value === null) result[key] = value;
          }
          return result;
        }),
      };
    });
    return {
      style: {
        ...sampleExtra,
        opacity: Number(style.opacity),
        transform: style.transform,
        x: rect.x,
        y: rect.y,
      },
      classes: [...element.classList],
      animations,
    };
  }, extra);
}

async function waitForAnimationIdle(page: Page, selector: string, timeoutMs = 1_000): Promise<number> {
  const started = performance.now();
  await page.locator(selector).evaluate(async (element, timeout) => {
    const begin = performance.now();
    while (performance.now() - begin < timeout) {
      if (element.getAnimations().every((animation) => animation.playState === 'finished')) return;
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    }
  }, timeoutMs);
  return performance.now() - started;
}

function timeBehavior(
  behaviorId: string,
  kind: Behavior['kind'],
  targetRef: string,
  triggerType: string,
  evidenceRefs: string[],
  visualEvidenceRefs: string[],
  before: AnimationSnapshot,
  mid: AnimationSnapshot,
  after: AnimationSnapshot,
  properties: string[],
  triggerTargetRef = targetRef,
): Behavior {
  const duration = durationFrom(mid);
  const timing = mid.animations[0]?.timing;
  return {
    behaviorId,
    kind,
    targetRef,
    trigger: { type: triggerType, targetRef: triggerTargetRef, edgeClass: 'experiment_supported', evidenceRefs },
    timeline: {
      domain: 'time',
      duration: { value: duration, unit: 'ms' },
      delay: { value: timing?.delay ?? 0, unit: 'ms' },
      easing: easingFrom(mid),
      iterations: timing?.iterations ?? 1,
    },
    tracks: properties.map((property) => {
      const propertyAnimation = mid.animations.find((animation) => animation.keyframes.some((frame) => property in frame));
      const keyframes = (propertyAnimation?.keyframes ?? []).flatMap((frame) => {
        const rawValue = frame[property];
        if (typeof rawValue !== 'string' && typeof rawValue !== 'number') return [];
        return [{
          offset: typeof frame.offset === 'number' ? frame.offset : null,
          easing: propertyAnimation?.type === 'CSSTransition'
            ? propertyAnimation.timing.easing
            : (typeof frame.easing === 'string' ? frame.easing : 'linear'),
          value: rawValue,
        }];
      });
      return {
        property,
        from: property === 'opacity' ? before.style.opacity : before.style.transform,
        to: property === 'opacity' ? after.style.opacity : after.style.transform,
        keyframes,
        samples: [before.style, mid.style, after.style],
      };
    }),
    provenance: { status: 'extracted', evidenceRefs },
    visualEvidenceRefs,
    unknowns: [],
  };
}

async function captureHover(page: Page, recorder: EvidenceRecorder, visualDirectory: string): Promise<Behavior> {
  const selector = '#hover-card';
  const targetRef = 'nav-1:main:hover-card';
  await page.evaluate(() => scrollTo(0, 0));
  await page.mouse.move(2, 2);
  const before = await sampleElement(page, selector, { elapsedMs: 0 });
  const beforeVisual = await recorder.screenshot(page, selector, 'hover-before', visualDirectory);
  const control = recorder.record('page', 'control-no-hover', { sample: before }, targetRef);
  await page.waitForTimeout(80);
  await page.locator(selector).hover();
  const input = recorder.record('input', 'hover-enter-requested', {}, targetRef);
  await page.waitForTimeout(90);
  const mid = await sampleElement(page, selector, { elapsedMs: 90 });
  const runtime = recorder.record('waapi', 'hover-animation-active', { snapshot: mid }, targetRef);
  const midVisual = await recorder.screenshot(page, selector, 'hover-mid', visualDirectory);
  await waitForAnimationIdle(page, selector);
  const after = await sampleElement(page, selector, { elapsedMs: durationFrom(mid) });
  const afterVisual = await recorder.screenshot(page, selector, 'hover-after', visualDirectory);
  return timeBehavior('hover-card-enter', 'hover', targetRef, 'pointerover', [control, input, runtime], [beforeVisual, midVisual, afterVisual], before, mid, after, ['opacity', 'transform']);
}

async function captureCssAnimation(page: Page, recorder: EvidenceRecorder, visualDirectory: string): Promise<Behavior> {
  const selector = '#css-animation';
  const targetRef = 'nav-1:main:css-animation';
  await page.locator(selector).scrollIntoViewIfNeeded();
  await settleScroll(page);
  const before = await sampleElement(page, selector, { elapsedMs: 0 });
  const beforeVisual = await recorder.screenshot(page, selector, 'css-animation-before', visualDirectory);
  await page.locator('#animation-trigger').click();
  const input = recorder.record('input', 'css-animation-click', { selector: '#animation-trigger' }, targetRef);
  await page.waitForTimeout(140);
  const mid = await sampleElement(page, selector, { elapsedMs: 140 });
  const runtime = recorder.record('waapi', 'css-keyframes-active', { snapshot: mid }, targetRef);
  const midVisual = await recorder.screenshot(page, selector, 'css-animation-mid', visualDirectory);
  await waitForAnimationIdle(page, selector);
  const after = await sampleElement(page, selector, { elapsedMs: durationFrom(mid) });
  const afterVisual = await recorder.screenshot(page, selector, 'css-animation-after', visualDirectory);
  return timeBehavior('css-keyframe-pulse', 'css_animation', targetRef, 'click', [input, runtime], [beforeVisual, midVisual, afterVisual], before, mid, after, ['transform'], 'nav-1:main:animation-trigger');
}

async function captureInterruptedTransition(page: Page, recorder: EvidenceRecorder, visualDirectory: string): Promise<Behavior> {
  const selector = '#interrupt-card';
  const targetRef = 'nav-1:main:interrupt-card';
  await page.locator(selector).scrollIntoViewIfNeeded();
  await settleScroll(page);
  await page.mouse.move(2, 2);
  const before = await sampleElement(page, selector, { elapsedMs: 0 });
  const beforeVisual = await recorder.screenshot(page, selector, 'interruption-before', visualDirectory);
  await page.locator(selector).hover();
  const enter = recorder.record('input', 'interruption-enter', {}, targetRef);
  const interruptAt = 105;
  await page.waitForTimeout(interruptAt);
  const interrupted = await sampleElement(page, selector, { elapsedMs: interruptAt });
  const midVisual = await recorder.screenshot(page, selector, 'interruption-point', visualDirectory);
  await page.mouse.move(2, 2);
  const leave = recorder.record('input', 'interruption-leave', { atMs: interruptAt, state: interrupted.style }, targetRef);
  await page.waitForTimeout(20);
  const returnMotion = await sampleElement(page, selector, { elapsedMs: interruptAt + 20 });
  const runtime = recorder.record('waapi', 'interruption-return-active', { snapshot: returnMotion }, targetRef);
  const recoveryDuration = await waitForAnimationIdle(page, selector);
  const after = await sampleElement(page, selector, { elapsedMs: interruptAt + recoveryDuration });
  const afterVisual = await recorder.screenshot(page, selector, 'interruption-after', visualDirectory);

  const behavior = timeBehavior(
    'interrupted-card-hover',
    'interrupted_transition',
    targetRef,
    'pointerover_then_pointerout',
    [enter, leave, runtime],
    [beforeVisual, midVisual, afterVisual],
    before,
    interrupted,
    after,
    ['opacity', 'transform'],
  );
  behavior.interruption = {
    at: { value: interruptAt, unit: 'ms' },
    observedState: interrupted.style,
    recoveryDuration: { value: round(recoveryDuration), unit: 'ms' },
    phases: [
      {
        name: 'entry',
        status: 'interrupted',
        tracks: ['opacity', 'transform'].map((property) => {
          const animation = interrupted.animations.find((item) => item.keyframes.some((frame) => property in frame));
          const target = animation?.keyframes.at(-1)?.[property];
          return {
            property,
            from: property === 'opacity' ? before.style.opacity : before.style.transform,
            to: typeof target === 'string' || typeof target === 'number'
              ? target
              : (property === 'opacity' ? interrupted.style.opacity : interrupted.style.transform),
          };
        }),
      },
      {
        name: 'recovery',
        status: 'completed',
        tracks: [
          { property: 'opacity', from: interrupted.style.opacity, to: after.style.opacity },
          { property: 'transform', from: interrupted.style.transform, to: after.style.transform },
        ],
      },
    ],
    evidenceRefs: [leave, runtime],
  };
  behavior.unknowns.push('Keyboard focus equivalence is not tested in Phase 0.');
  return behavior;
}

async function settleScroll(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function captureScrollReveal(page: Page, recorder: EvidenceRecorder, visualDirectory: string): Promise<Behavior> {
  const selector = '#scroll-reveal';
  const targetRef = 'nav-1:main:scroll-reveal';
  await page.evaluate(() => scrollTo(0, 0));
  await settleScroll(page);
  const absoluteTop = await page.locator(selector).evaluate((element) => element.getBoundingClientRect().top + scrollY);
  let onset = 0;
  for (let y = Math.max(0, absoluteTop - 900); y <= absoluteTop; y += 20) {
    await page.evaluate((nextY) => scrollTo(0, nextY), y);
    await settleScroll(page);
    const revealed = await page.locator(selector).evaluate((element) => element.classList.contains('revealed'));
    if (revealed) { onset = y; break; }
  }
  const beforeY = Math.max(0, onset - 40);
  await page.evaluate((y) => scrollTo(0, y), beforeY);
  await settleScroll(page);
  await page.waitForTimeout(420);
  const before = await sampleElement(page, selector, { scrollY: beforeY, elapsedMs: 0 });
  const beforeVisual = await recorder.screenshot(page, selector, 'scroll-reveal-before', visualDirectory);
  await page.evaluate((y) => scrollTo(0, y), onset);
  await settleScroll(page);
  const input = recorder.record('input', 'scroll-reveal-threshold-crossed', { scrollY: onset }, targetRef);
  await page.waitForTimeout(120);
  const mid = await sampleElement(page, selector, { scrollY: onset, elapsedMs: 120 });
  const runtime = recorder.record('waapi', 'scroll-reveal-transition-active', { snapshot: mid, onsetScrollY: onset }, targetRef);
  const midVisual = await recorder.screenshot(page, selector, 'scroll-reveal-mid', visualDirectory);
  await waitForAnimationIdle(page, selector);
  const after = await sampleElement(page, selector, { scrollY: onset, elapsedMs: durationFrom(mid) });
  const afterVisual = await recorder.screenshot(page, selector, 'scroll-reveal-after', visualDirectory);

  await page.evaluate((y) => scrollTo(0, y), Math.max(0, onset - 500));
  await settleScroll(page);
  const reversed = await page.locator(selector).evaluate((element) => !element.classList.contains('revealed'));
  const reverse = recorder.record('input', 'scroll-reveal-reverse-probe', { reversed }, targetRef);
  const behavior = timeBehavior('scroll-threshold-reveal', 'scroll_reveal', targetRef, 'viewport_scroll_threshold', [input, runtime, reverse], [beforeVisual, midVisual, afterVisual], before, mid, after, ['opacity', 'transform'], 'viewport');
  behavior.unknowns.push('Threshold is observed at a 20 CSS px scan resolution, not extracted from IntersectionObserver options.');
  return behavior;
}

type GsapAdapterRecord = {
  id: string | null;
  start: number;
  end: number;
  progress: number;
  scrub: boolean | number;
  triggerSelector: string | null;
  targetSelector: string;
  animationDuration: number | null;
  animationProgress: number | null;
};

async function readGsapAdapter(page: Page): Promise<GsapAdapterRecord> {
  const records = await page.evaluate(() => {
    const adapter = (window as unknown as { __WBC_GSAP_ADAPTER__: { list(): GsapAdapterRecord[] } }).__WBC_GSAP_ADAPTER__;
    return adapter.list();
  });
  const record = records.find((item) => item.id === 'phase0-scrub');
  if (!record) throw new Error('GSAP adapter did not expose phase0-scrub');
  return record;
}

async function captureGsapScrub(page: Page, recorder: EvidenceRecorder, visualDirectory: string): Promise<Behavior> {
  const selector = '#gsap-scrub';
  const targetRef = 'nav-1:main:gsap-scrub';
  const resolved = await readGsapAdapter(page);
  const adapterEvidence = recorder.record('adapter', 'gsap-scroll-trigger-resolved', { resolved }, targetRef);
  const samples: StyleSample[] = [];
  const visuals: string[] = [];
  for (const progress of [0, 0.25, 0.75, 1, 0.5]) {
    const scrollY = resolved.start + (resolved.end - resolved.start) * progress;
    await page.evaluate((y) => scrollTo(0, y), scrollY);
    await settleScroll(page);
    const actual = await readGsapAdapter(page);
    const snapshot = await sampleElement(page, selector, { progress: actual.progress, scrollY });
    samples.push(snapshot.style);
    const sampleEvidence = recorder.record('adapter', 'gsap-scrub-sample', { requestedProgress: progress, resolved: actual, sample: snapshot.style }, targetRef);
    if (progress === 0 || progress === 0.75 || progress === 1) {
      visuals.push(await recorder.screenshot(page, selector, `gsap-scrub-${String(progress).replace('.', '-')}`, visualDirectory));
    }
    if (progress === 0.5) recorder.record('input', 'gsap-scrub-reverse-probe', { evidenceRef: sampleEvidence }, targetRef);
  }
  const directScrub = resolved.scrub === true;
  return {
    behaviorId: 'gsap-scrolltrigger-scrub',
    kind: 'gsap_scrub',
    targetRef,
    trigger: { type: 'scroll_progress', targetRef: 'viewport', edgeClass: 'direct', evidenceRefs: [adapterEvidence] },
    timeline: {
      domain: 'scroll',
      containerRef: 'viewport',
      axis: 'y',
      range: {
        start: { value: round(resolved.start), unit: 'px' },
        end: { value: round(resolved.end), unit: 'px' },
      },
      scrub: directScrub
        ? { mode: 'direct' }
        : { mode: 'numeric', catchUp: { value: Number(resolved.scrub) * 1_000, unit: 'ms' } },
    },
    tracks: [{ property: 'transform', from: samples[0]?.transform ?? 'none', to: samples[3]?.transform ?? 'none', keyframes: [], samples }],
    provenance: { status: 'extracted', evidenceRefs: [adapterEvidence] },
    visualEvidenceRefs: visuals,
    unknowns: ['Private or closure-scoped GSAP instances require sampled visual/DOM fallback.'],
  };
}

async function collectElements(page: Page): Promise<ElementRef[]> {
  return page.locator('[data-wbc-id]').evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    const dataWbcId = (element as HTMLElement).dataset.wbcId ?? '';
    return {
      id: `nav-1:main:${dataWbcId}`,
      navigationId: 'nav-1',
      frame: 'main' as const,
      selector: `#${element.id}`,
      dataWbcId,
      bounds: { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height },
    };
  }));
}

async function benchmarkObserver(browser: Browser, url: string, runs = 3): Promise<{ baselineP95: number; capturedP95: number; sampleCount: number }> {
  const baselineP95: number[] = [];
  const capturedP95: number[] = [];
  let sampleCount = 0;
  for (let run = 0; run < runs; run += 1) {
    const baselineContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await baselineContext.addInitScript('globalThis.__name = globalThis.__name || ((target) => target);');
    const baselinePage = await baselineContext.newPage();
    await baselinePage.goto(url);
    await baselinePage.waitForFunction(() => (window as unknown as { __WBC_FIXTURE__?: { ready: boolean } }).__WBC_FIXTURE__?.ready === true);
    const baseline = await measureFrameIntervals(baselinePage);
    baselineP95.push(percentile(baseline, 0.95));
    sampleCount += baseline.length;
    await baselineContext.close();

    const captureContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await installPageObserver(captureContext);
    const capturePage = await captureContext.newPage();
    await capturePage.goto(url);
    await capturePage.waitForFunction(() => (window as unknown as { __WBC_FIXTURE__?: { ready: boolean } }).__WBC_FIXTURE__?.ready === true);
    const captured = await measureFrameIntervals(capturePage);
    capturedP95.push(percentile(captured, 0.95));
    await captureContext.close();
  }
  return { baselineP95: median(baselineP95), capturedP95: median(capturedP95), sampleCount };
}

async function hashFile(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export interface CaptureResult {
  outputDirectory: string;
  contractPath: string;
  eventPath: string;
  sessionIndexPath: string;
  sessionIndexManifestPath: string;
  contract: ContractPackage;
}

export interface CaptureOptions {
  maxPageRecords?: number;
  overheadRuns?: number;
}

export async function captureSession(outputDirectory: string, options: CaptureOptions = {}): Promise<CaptureResult> {
  const absoluteOutput = resolve(outputDirectory);
  const evidenceDirectory = join(absoluteOutput, 'evidence');
  const visualDirectory = join(evidenceDirectory, 'visual');
  await mkdir(visualDirectory, { recursive: true });

  const server = await startFixtureServer();
  const browser = await chromium.launch({ headless: true, args: ['--site-per-process'] });
  const recorder = new EvidenceRecorder();
  try {
    const overhead = await benchmarkObserver(browser, server.url, options.overheadRuns ?? 3);
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      locale: 'en-US',
      timezoneId: 'Asia/Jakarta',
      reducedMotion: 'no-preference',
    });
    await installPageObserver(context, options.maxPageRecords ?? 10_000);
    const page = await context.newPage();
    const targetRegistry = new TargetRegistry(page, options.maxPageRecords ?? 10_000);
    const cdp: CDPSession = await context.newCDPSession(page);
    let cdpAnimationSupported = true;
    try {
      await cdp.send('Animation.enable');
      cdp.on('Animation.animationStarted', (payload) => {
        recorder.record('cdp', 'animation-started', payload as unknown as Record<string, unknown>, undefined, Number(payload.animation.startTime));
      });
      cdp.on('Animation.animationCanceled', (payload) => {
        recorder.record('cdp', 'animation-canceled', payload as unknown as Record<string, unknown>);
      });
    } catch (error) {
      cdpAnimationSupported = false;
      recorder.record('cdp', 'animation-domain-failed', { message: error instanceof Error ? error.message : String(error) });
    }

    await page.goto(server.url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => (window as unknown as { __WBC_FIXTURE__?: { ready: boolean } }).__WBC_FIXTURE__?.ready === true);
    const elements = await collectElements(page);
    const behaviors = [
      await captureHover(page, recorder, visualDirectory),
      await captureCssAnimation(page, recorder, visualDirectory),
      await captureInterruptedTransition(page, recorder, visualDirectory),
      await captureScrollReveal(page, recorder, visualDirectory),
      await captureGsapScrub(page, recorder, visualDirectory),
    ];

    await targetRegistry.checkpoint();
    const lifecycleNavigation = page.waitForEvent('framenavigated', {
      predicate: (frame) => frame.url().includes('/lifecycle-b/'),
    });
    await page.evaluate(() => {
      const fixture = (window as unknown as { __WBC_FIXTURE__: { navigateLifecycleTarget(): void } }).__WBC_FIXTURE__;
      fixture.navigateLifecycleTarget();
    });
    const lifecycleFrame = await lifecycleNavigation;
    await lifecycleFrame.waitForLoadState('domcontentloaded');
    recorder.record('input', 'target-lifecycle-navigation-requested', { to: '/lifecycle-b/' });
    await targetRegistry.checkpoint();
    const lifecycleDetach = page.waitForEvent('framedetached', {
      predicate: (frame) => frame === lifecycleFrame,
    });
    await page.evaluate(() => {
      const fixture = (window as unknown as { __WBC_FIXTURE__: { detachLifecycleTarget(): void } }).__WBC_FIXTURE__;
      fixture.detachLifecycleTarget();
    });
    await lifecycleDetach;
    recorder.record('input', 'target-lifecycle-detach-requested', { from: '/lifecycle-b/' });

    const targets = await targetRegistry.collect();
    for (const { targetId, record } of targets.records) recorder.ingest(record, targetId);
    for (const target of targets.coverage) {
      recorder.record('page', 'target-coverage', { target }, target.targetId);
    }

    const eventPath = join(evidenceDirectory, 'events.jsonl');
    await writeFile(eventPath, `${recorder.records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
    const eventHash = await hashFile(eventPath);
    const evidenceIndex = [
      ...recorder.records.map((record) => ({
        id: record.id,
        path: relative(absoluteOutput, eventPath),
        mediaType: 'application/x-ndjson' as const,
        sha256: eventHash,
      })),
      ...await Promise.all(recorder.files.map(async (file) => ({
        id: file.id,
        path: relative(absoluteOutput, file.absolutePath),
        mediaType: file.mediaType,
        sha256: await hashFile(file.absolutePath),
      }))),
    ];

    const baselineP95 = overhead.baselineP95;
    const captureP95 = overhead.capturedP95;
    const degradation = baselineP95 === 0 ? 0 : ((captureP95 - baselineP95) / baselineP95) * 100;
    const sessionId = randomUUID();
    const browserVersion = browser.version();
    const contract: ContractPackage = {
      schemaVersion: '1.2.0',
      manifest: {
        productVersion: '0.2.0-phase1',
        schemaVersion: '1.2.0',
        sessionId,
        navigationId: 'nav-1',
        generatedAt: new Date().toISOString(),
        source: { url: server.url, fixture: 'phase0' },
        environment: {
          browserName: 'chromium', browserVersion, platform: process.platform,
          viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
          locale: 'en-US', timezone: 'Asia/Jakarta', reducedMotion: 'no-preference',
        },
        captureMode: 'natural',
        capabilities: [
          { name: 'playwright_orchestration', status: 'supported' },
          { name: 'page_world_observer', status: 'supported' },
          { name: 'waapi_keyframes_and_timing', status: 'supported' },
          { name: 'cdp_animation_lifecycle', status: cdpAnimationSupported ? 'supported' : 'failed' },
          { name: 'visual_checkpoints', status: 'supported' },
          { name: 'gsap_scrolltrigger_public_adapter', status: 'supported', detail: 'Source-assisted public adapter on controlled fixture.' },
          { name: 'private_gsap_instance_access', status: 'unavailable', detail: 'Falls back to sampled computed trajectory.' },
          { name: 'target_registry', status: 'supported', detail: 'Main frame, nested frames, cross-origin OOPIF, and dedicated workers are listed per target.' },
          { name: 'navigation_epoch_registry', status: 'supported', detail: 'Frame navigation and detach preserve prior target epochs with explicit end boundaries and gaps.' },
          { name: 'recursive_frame_collector', status: 'supported', detail: 'Context init script installs the page observer at document start in nested and cross-origin frames.' },
          { name: 'dedicated_worker_collector', status: 'supported', detail: 'Installed after the Playwright worker event; pre-install history remains a declared gap.' },
          { name: 'recursive_worker_collector', status: 'unavailable', detail: 'Workers spawned by another worker are not recursively instrumented.' },
          { name: 'sqlite_session_index', status: 'supported', detail: 'Reopenable sidecar index built with node:sqlite; runtime API is still marked experimental.' },
        ],
        targetCoverage: targets.coverage,
        quality: {
          recordCount: recorder.records.length,
          droppedRecords: targets.coverage.reduce((sum, target) => sum + target.collector.droppedRecords, 0),
          knownLoss: targets.coverage.some((target) => target.collector.knownLoss),
          observerCost: {
            baselineP95FrameMs: round(baselineP95),
            captureP95FrameMs: round(captureP95),
            degradationPercent: round(degradation),
            sampleCount: overhead.sampleCount,
          },
        },
        gaps: [
          'Only one deterministic local route is covered.',
          'Dedicated worker capture begins at runtime; work before collector installation is unknown.',
          'Dedicated worker ownership is attributed to the main frame in the current fixture; general worker-to-frame attribution is not implemented.',
          'Workers spawned by workers are not recursively registered.',
          'Archived frame coverage ends at the last successful checkpoint; the interval to navigation or detach is explicitly unknown.',
          'Trigger discovery is scenario-directed rather than autonomous.',
          'Scroll reveal threshold is observed by scanning, not extracted from IntersectionObserver internals.',
          'GSAP semantic extraction requires an accessible public adapter; private instances use sampled fallback.',
          'Observer overhead benchmark includes page-world frame observers but not the host registry or worker collector installation.',
          'The SQLite API is experimental in the pinned Node.js runtime; the sidecar format may require migration before release.',
          'No MCP server or viewer is included in the current slice.',
        ],
      },
      elements,
      behaviors,
      evidenceIndex,
    };

    await validateContract(contract);
    const contractPath = join(absoluteOutput, 'behavior-contract.json');
    await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
    const sessionIndex = await buildSessionIndex(absoluteOutput, contractPath, contract, recorder.records);
    await context.close();
    return {
      outputDirectory: absoluteOutput,
      contractPath,
      eventPath,
      sessionIndexPath: sessionIndex.databasePath,
      sessionIndexManifestPath: sessionIndex.manifestPath,
      contract,
    };
  } finally {
    await browser.close();
    await server.close();
  }
}
