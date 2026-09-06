import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';
import { startFixtureServer } from './server.js';

export interface TechnicalProbeReport {
  schemaVersion: '1.0.0';
  probeId: string;
  generatedAt: string;
  browserVersion: string;
  mode: 'diagnostic';
  shortAnimation: {
    expectedDurationMs: number;
    waapiObserved: boolean;
    waapiDurationMs: number;
    cdpLifecycleObserved: boolean;
    cdpDurationMs: number | null;
    status: 'passed' | 'failed';
  };
  targetCoverage: Array<{
    target: 'main_frame' | 'same_origin_iframe' | 'cross_origin_iframe' | 'dedicated_worker';
    status: 'supported' | 'failed';
    evidence: string;
  }>;
  identity: {
    beforeInstance: string;
    afterInstance: string;
    recreated: boolean;
    stableLogicalRef: string;
    status: 'passed' | 'failed';
  };
  clockMapping: {
    method: string;
    maxAbsoluteErrorMs: number;
    samples: number;
    status: 'passed' | 'failed';
  };
  autoAttach: {
    attachedTargetTypes: string[];
    workerDiscoveredByCdp: boolean;
    oopifDiscoveredByCdp: boolean;
    childCollectorInstalled: boolean;
    status: 'passed' | 'failed';
  };
  lateAttach: {
    attachAtMs: number;
    activeAnimationsAtAttach: number;
    lifecycleEventsBeforeAttach: number;
    gap: string;
    completeness: 'partial';
    status: 'passed' | 'failed';
  };
  navigationRace: {
    observedUrls: string[];
    startObserved: boolean;
    endObserved: boolean;
    oldNodeInvalidated: boolean;
    finalEpoch: string;
    status: 'passed' | 'failed';
  };
  summary: { passed: number; failed: number; total: number };
  probePlan?: NormalizedProbePlan;
  limitations: string[];
}

export interface ProbeRunRequest {
  packagePath?: string;
  baseRevisionId?: string;
  resetRecipeId?: string;
  controlRun?: boolean;
  timingOffsetsMs?: number[];
  directions?: Array<'forward' | 'reverse'>;
  interruptionAtMs?: number[];
  viewports?: Array<{ width: number; height: number }>;
  maxRuns?: number;
  timeoutMs?: number;
  behaviorIds?: string[];
}

export interface NormalizedProbePlan {
  resetRecipeId: string;
  controlRun: boolean;
  timingOffsetsMs: number[];
  directions: Array<'forward' | 'reverse'>;
  interruptionAtMs: number[];
  viewports: Array<{ width: number; height: number }>;
  maxRuns: number;
  timeoutMs: number;
  behaviorIds: string[];
}

export const probeRecipeRegistry = new Set([
  'phase0-hover-interruption', 'phase0-css-waapi', 'nested-scroller-reverse', 'gsap-scrub-modes',
  'overlap-composition', 'navigation-cancellation', 'open-shadow-semantic', 'worker-lifecycle',
  'network-delayed-state', 'visual-redaction', 'ambiguous-structural-locator', 'oopif-target-registry',
]);

export function normalizeProbeRequest(request: ProbeRunRequest = {}): NormalizedProbePlan {
  const resetRecipeId = request.resetRecipeId ?? 'phase0-hover-interruption';
  if (!probeRecipeRegistry.has(resetRecipeId)) throw new Error(`Unknown probe reset recipe: ${resetRecipeId}`);
  const timingOffsetsMs = (request.timingOffsetsMs ?? [0]).map((value) => Number(value));
  const interruptionAtMs = (request.interruptionAtMs ?? []).map((value) => Number(value));
  if (timingOffsetsMs.some((value) => !Number.isFinite(value) || Math.abs(value) > 60_000)) throw new Error('Probe timing offsets must be finite and within +/-60000 ms');
  if (interruptionAtMs.some((value) => !Number.isFinite(value) || value < 0 || value > 60_000)) throw new Error('Probe interruption points must be within 0..60000 ms');
  const directions = request.directions ?? ['forward'];
  if (directions.some((direction) => direction !== 'forward' && direction !== 'reverse')) throw new Error('Probe direction must be forward or reverse');
  const viewports = (request.viewports ?? [{ width: 1100, height: 740 }]).map((viewport) => ({ width: Math.floor(viewport.width), height: Math.floor(viewport.height) }));
  if (viewports.some((viewport) => viewport.width < 320 || viewport.width > 4096 || viewport.height < 240 || viewport.height > 4096)) throw new Error('Probe viewport is outside supported bounds');
  const maxRuns = Math.floor(request.maxRuns ?? Math.max(1, timingOffsetsMs.length * directions.length * Math.max(1, viewports.length)));
  const timeoutMs = Math.floor(request.timeoutMs ?? 120_000);
  if (!Number.isInteger(maxRuns) || maxRuns < 1 || maxRuns > 100) throw new Error('Probe maxRuns must be between 1 and 100');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 20 * 60_000) throw new Error('Probe timeoutMs must be between 1000 and 1200000');
  const behaviorIds = [...new Set((request.behaviorIds ?? []).filter((value) => typeof value === 'string' && value.length > 0))];
  return { resetRecipeId, controlRun: request.controlRun ?? false, timingOffsetsMs, directions, interruptionAtMs, viewports, maxRuns, timeoutMs, behaviorIds };
}

function round(value: number, digits = 3): number {
  return Number(value.toFixed(digits));
}

export async function runTechnicalProbes(outputFile?: string, request: ProbeRunRequest = {}): Promise<TechnicalProbeReport> {
  const probePlan = normalizeProbeRequest(request);
  const server = await startFixtureServer();
  const browser = await chromium.launch({ headless: true, args: ['--site-per-process'] });
  try {
    const context = await browser.newContext({ viewport: probePlan.viewports[0] ?? { width: 1100, height: 740 } });
    await context.addInitScript('globalThis.__name = globalThis.__name || ((target) => target);');
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const animationStarts: Array<Record<string, unknown>> = [];
    const attachedTargetTypes: string[] = [];
    await cdp.send('Animation.enable');
    await cdp.send('Target.setDiscoverTargets', { discover: true });
    await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    cdp.on('Animation.animationStarted', (payload) => animationStarts.push(payload as unknown as Record<string, unknown>));
    cdp.on('Target.attachedToTarget', (payload) => attachedTargetTypes.push(payload.targetInfo.type));

    await page.goto(`${server.url}/probes/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('body[data-wbc-ready="true"]');
    const frame = page.frames().find((candidate) => candidate.url().includes('/probe-frame/'));
    const frameReady = frame
      ? await frame.locator('body[data-frame-ready="true"]').count() === 1
      : false;
    const resolvedCrossFrame = page.frames().find((candidate) => candidate.url().includes('/cross-origin-frame/'));
    if (resolvedCrossFrame) await resolvedCrossFrame.waitForLoadState('domcontentloaded');
    const crossFrameReady = resolvedCrossFrame
      ? await resolvedCrossFrame.locator('body[data-cross-frame-ready="true"]').count() === 1
      : false;
    let childCollectorInstalled = false;
    if (resolvedCrossFrame) {
      const childSession = await context.newCDPSession(resolvedCrossFrame);
      await childSession.send('Runtime.enable');
      const installation = await childSession.send('Runtime.evaluate', {
        expression: `globalThis.__WBC_CHILD_COLLECTOR__ = { installed: true, sourceTime: performance.now(), href: location.href }; globalThis.__WBC_CHILD_COLLECTOR__`,
        returnByValue: true,
      });
      childCollectorInstalled = Boolean((installation.result.value as { installed?: boolean } | undefined)?.installed);
      await childSession.detach();
    }
    await page.waitForFunction(() => document.querySelector('[data-worker-status]')?.textContent === 'worker-ready');
    const workerReady = page.workers().some((worker) => worker.url().includes('/probe-worker.js'));

    await page.locator('[data-wbc-id="short-trigger"]').click();
    await page.waitForTimeout(12);
    const waapi = await page.locator('[data-wbc-id="short-animation"]').evaluate((element) => {
      const animation = element.getAnimations()[0];
      const effect = animation?.effect instanceof KeyframeEffect ? animation.effect : null;
      const duration = effect?.getTiming().duration;
      return {
        observed: Boolean(animation),
        duration: typeof duration === 'number' ? duration : 0,
      };
    });
    await page.waitForTimeout(100);
    const cdpAnimation = animationStarts.map((event) => event.animation as { source?: { duration?: number }; name?: string } | undefined)
      .find((animation) => animation?.source?.duration === 72);

    await page.evaluate(() => {
      (window as unknown as { __WBC_IDENTITY_BEFORE__: Element | null }).__WBC_IDENTITY_BEFORE__ = document.querySelector('[data-wbc-id="identity-probe"]');
    });
    const beforeInstance = await page.locator('[data-wbc-id="identity-probe"]').getAttribute('data-instance') ?? 'missing';
    // Invoke the fixture handler directly: this probe measures node recreation,
    // while pointer hit-testing is already exercised by the behavior verifier.
    await page.locator('[data-wbc-id="recreate-trigger"]').evaluate((element) => (element as HTMLElement).click());
    const afterInstance = await page.locator('[data-wbc-id="identity-probe"]').getAttribute('data-instance') ?? 'missing';
    const recreated = await page.evaluate(() => {
      const before = (window as unknown as { __WBC_IDENTITY_BEFORE__: Element | null }).__WBC_IDENTITY_BEFORE__;
      const after = document.querySelector('[data-wbc-id="identity-probe"]');
      return Boolean(before && after && !before.isSameNode(after));
    });

    const clockErrors: number[] = [];
    for (let index = 0; index < 10; index += 1) {
      const sample = await page.evaluate(() => ({ mappedEpoch: performance.timeOrigin + performance.now(), epoch: Date.now() }));
      clockErrors.push(Math.abs(sample.epoch - sample.mappedEpoch));
    }

    const targets = await cdp.send('Target.getTargets');
    const workerDiscoveredByCdp = targets.targetInfos.some((target) => target.type === 'worker' && target.url.includes('/probe-worker.js'));
    const oopifDiscoveredByCdp = targets.targetInfos.some((target) => target.type === 'iframe' && target.url.includes('/cross-origin-frame/'));

    const latePage = await context.newPage();
    await latePage.goto(`${server.url}/late-attach/`, { waitUntil: 'load' });
    await latePage.waitForTimeout(140);
    const lateAttachState = await latePage.evaluate(() => ({
      attachAtMs: performance.now(),
      activeAnimations: document.querySelector('[data-wbc-id="late-animation"]')?.getAnimations().length ?? 0,
    }));
    const lateSession = await context.newCDPSession(latePage);
    let lateLifecycleEvents = 0;
    lateSession.on('Animation.animationStarted', () => { lateLifecycleEvents += 1; });
    await lateSession.send('Animation.enable');
    await latePage.waitForTimeout(30);
    const lateAttachPassed = lateAttachState.attachAtMs > 64 && lateAttachState.activeAnimations === 0 && lateLifecycleEvents === 0;
    await lateSession.detach();
    await latePage.close();

    const racePage = await context.newPage();
    const observedUrls: string[] = [];
    racePage.on('framenavigated', (navigatedFrame) => {
      if (navigatedFrame === racePage.mainFrame()) observedUrls.push(navigatedFrame.url());
    });
    await racePage.goto(`${server.url}/race-start/`, { waitUntil: 'domcontentloaded' });
    const startUrl = racePage.url();
    const oldNode = await racePage.locator('[data-wbc-id="navigation-target"]').elementHandle();
    await racePage.waitForURL('**/race-end/');
    const endUrl = racePage.url();
    await racePage.waitForSelector('body[data-navigation-epoch="end"]');
    const finalEpoch = await racePage.locator('body').getAttribute('data-navigation-epoch') ?? 'missing';
    let oldNodeInvalidated = false;
    try {
      oldNodeInvalidated = oldNode ? await oldNode.evaluate((node) => !node.isConnected) : false;
    } catch {
      oldNodeInvalidated = true;
    }
    const startObserved = startUrl.includes('/race-start/') || observedUrls.some((url) => url.includes('/race-start/'));
    const endObserved = endUrl.includes('/race-end/') || observedUrls.some((url) => url.includes('/race-end/'));
    const navigationRacePassed = startObserved && endObserved && oldNodeInvalidated && finalEpoch === 'end';
    await racePage.close();
    const shortPassed = waapi.observed && waapi.duration === 72 && Boolean(cdpAnimation);
    const coverage = [
      { target: 'main_frame' as const, status: 'supported' as const, evidence: page.url() },
      { target: 'same_origin_iframe' as const, status: frameReady ? 'supported' as const : 'failed' as const, evidence: frame?.url() ?? 'frame-not-found' },
      { target: 'cross_origin_iframe' as const, status: crossFrameReady && oopifDiscoveredByCdp && childCollectorInstalled ? 'supported' as const : 'failed' as const, evidence: resolvedCrossFrame?.url() ?? 'cross-origin-frame-not-found' },
      { target: 'dedicated_worker' as const, status: workerReady ? 'supported' as const : 'failed' as const, evidence: page.workers().map((worker) => worker.url()).join(',') || 'worker-not-found' },
    ];
    const identityPassed = recreated && beforeInstance === 'first' && afterInstance === 'second';
    const clockMax = Math.max(...clockErrors);
    const clockPassed = clockMax <= 5;
    const autoAttachPassed = workerDiscoveredByCdp && oopifDiscoveredByCdp && childCollectorInstalled;
    const passFlags = [shortPassed, ...coverage.map((item) => item.status === 'supported'), identityPassed, clockPassed, autoAttachPassed, lateAttachPassed, navigationRacePassed];

    const report: TechnicalProbeReport = {
      schemaVersion: '1.0.0',
      probeId: randomUUID(),
      generatedAt: new Date().toISOString(),
      browserVersion: browser.version(),
      mode: 'diagnostic',
      shortAnimation: {
        expectedDurationMs: 72,
        waapiObserved: waapi.observed,
        waapiDurationMs: waapi.duration,
        cdpLifecycleObserved: Boolean(cdpAnimation),
        cdpDurationMs: cdpAnimation?.source?.duration ?? null,
        status: shortPassed ? 'passed' : 'failed',
      },
      targetCoverage: coverage,
      identity: {
        beforeInstance,
        afterInstance,
        recreated,
        stableLogicalRef: 'data-wbc-id=identity-probe',
        status: identityPassed ? 'passed' : 'failed',
      },
      clockMapping: {
        method: 'performance.timeOrigin + performance.now compared with Date.now',
        maxAbsoluteErrorMs: round(clockMax),
        samples: clockErrors.length,
        status: clockPassed ? 'passed' : 'failed',
      },
      autoAttach: {
        attachedTargetTypes: [...new Set(attachedTargetTypes)].sort(),
        workerDiscoveredByCdp,
        oopifDiscoveredByCdp,
        childCollectorInstalled,
        status: autoAttachPassed ? 'passed' : 'failed',
      },
      lateAttach: {
        attachAtMs: round(lateAttachState.attachAtMs),
        activeAnimationsAtAttach: lateAttachState.activeAnimations,
        lifecycleEventsBeforeAttach: lateLifecycleEvents,
        gap: 'page_load_to_attach',
        completeness: 'partial',
        status: lateAttachPassed ? 'passed' : 'failed',
      },
      navigationRace: {
        observedUrls,
        startObserved,
        endObserved,
        oldNodeInvalidated,
        finalEpoch,
        status: navigationRacePassed ? 'passed' : 'failed',
      },
      summary: {
        passed: passFlags.filter(Boolean).length,
        failed: passFlags.filter((value) => !value).length,
        total: passFlags.length,
      },
      probePlan,
      limitations: [
        'Cross-origin OOPIF is forced with site-per-process in a diagnostic browser launch; natural capture still uses default launch flags.',
        'Child collector installation is proven for the OOPIF frame, but not recursively for workers spawned by child targets.',
        'The 72 ms fixture does not establish a minimum supported animation duration.',
        'Clock comparison covers one page realm and does not calibrate OOPIF or worker clocks.',
        'The validated probe plan is recorded with the revision; this diagnostic implementation executes the canonical fixture run and does not synthesize unobserved variations.',
      ],
    };
    if (outputFile) {
      const absoluteOutput = resolve(outputFile);
      await mkdir(dirname(absoluteOutput), { recursive: true });
      await writeFile(absoluteOutput, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    }
    await context.close();
    return report;
  } finally {
    await browser.close();
    await server.close();
  }
}
