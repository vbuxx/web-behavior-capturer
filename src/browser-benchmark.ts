import { chromium } from 'playwright';
import { installPageObserver, measureFrameIntervals, readPageObserver } from './browser-observer.js';
import { startFixtureServer } from './server.js';

export interface BrowserLoadBenchmark {
  iterations: number;
  sustainedDurationMs: number;
  nodeCount: number;
  trackCount: number;
  baselineFrameP95Ms: number;
  observedFrameP95Ms: number;
  degradationPercent: number;
  baselineNavigationMs: number;
  observedNavigationMs: number;
  observerDroppedRecords: number;
  baselinePeakPrivateMemoryBytes: number;
  observedPeakPrivateMemoryBytes: number;
  privateMemorySupported: boolean;
  baselineWorkerMessages: number;
  observedWorkerMessages: number;
  baselineCrossOriginReady: boolean;
  observedCrossOriginReady: boolean;
  baselinePeakJsHeapBytes: number;
  observedPeakJsHeapBytes: number;
  baselinePeakDomNodes: number;
  observedPeakDomNodes: number;
  baselineScrollEvents: number;
  observedScrollEvents: number;
  baselinePointerBursts: number;
  observedPointerBursts: number;
}

function p95(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return Number((sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0).toFixed(3));
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return Number((sorted[Math.floor(sorted.length / 2)] ?? 0).toFixed(3));
}

interface RuntimeLoadSample {
  peakJsHeapBytes: number;
  peakDomNodes: number;
  scrollEvents: number;
  pointerBursts: number;
}

async function runRuntimeBurst(page: import('playwright').Page, cdp: import('playwright').CDPSession, durationMs = 2_000): Promise<RuntimeLoadSample> {
  await cdp.send('Performance.enable');
  await page.evaluate(() => {
    const state = { scrollEvents: 0, pointerBursts: 0 };
    addEventListener('scroll', () => { state.scrollEvents += 1; }, { passive: true });
    (globalThis as unknown as { __WBC_BURST__: typeof state }).__WBC_BURST__ = state;
  });
  let peakJsHeapBytes = 0;
  let peakDomNodes = 0;
  const start = performance.now();
  let step = 0;
  while (performance.now() - start < durationMs) {
    await page.evaluate((nextStep) => {
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      scrollTo(0, (nextStep % 20) * (maxScroll / 19));
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: nextStep % innerWidth, clientY: nextStep % innerHeight }));
      const state = (globalThis as unknown as { __WBC_BURST__: { pointerBursts: number } }).__WBC_BURST__;
      state.pointerBursts += 1;
    }, step);
    step += 1;
    const metrics = await cdp.send('Performance.getMetrics');
    const values = new Map(metrics.metrics.map((metric) => [metric.name, metric.value]));
    peakJsHeapBytes = Math.max(peakJsHeapBytes, values.get('JSHeapUsedSize') ?? 0);
    peakDomNodes = Math.max(peakDomNodes, values.get('Nodes') ?? 0);
    await page.waitForTimeout(100);
  }
  const burst = await page.evaluate(() => (globalThis as unknown as { __WBC_BURST__: { scrollEvents: number; pointerBursts: number } }).__WBC_BURST__);
  return { peakJsHeapBytes, peakDomNodes, ...burst };
}

async function processPrivateMemory(cdp: import('playwright').CDPSession): Promise<number> {
  try {
    const result = await cdp.send('SystemInfo.getProcessInfo') as { processInfo?: Array<{ privateMemory?: number }> };
    return Math.max(0, ...(result.processInfo ?? []).map((process) => process.privateMemory ?? 0));
  } catch {
    return 0;
  }
}

export async function benchmarkSyntheticBrowser(iterations = 2): Promise<BrowserLoadBenchmark> {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10) throw new Error('Browser benchmark iterations must be 1 to 10');
  const server = await startFixtureServer();
  const browser = await chromium.launch({ headless: true });
  const browserCdp = await browser.newBrowserCDPSession();
  const baselineFrames: number[] = [];
  const observedFrames: number[] = [];
  const baselineNavigation: number[] = [];
  const observedNavigation: number[] = [];
  const baselineHeap: number[] = [];
  const observedHeap: number[] = [];
  const baselineNodes: number[] = [];
  const observedNodes: number[] = [];
  const baselineScroll: number[] = [];
  const observedScroll: number[] = [];
  const baselinePointer: number[] = [];
  const observedPointer: number[] = [];
  const baselinePrivateMemory: number[] = [];
  const observedPrivateMemory: number[] = [];
  const baselineWorkers: number[] = [];
  const observedWorkers: number[] = [];
  const baselineCrossOrigin: boolean[] = [];
  const observedCrossOrigin: boolean[] = [];
  let nodeCount = 0;
  let trackCount = 0;
  let observerDroppedRecords = 0;
  try {
    for (let index = 0; index < iterations; index += 1) {
      const baselineContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await baselineContext.addInitScript('globalThis.__name = globalThis.__name || ((target) => target);');
      const baselinePage = await baselineContext.newPage();
      const baselineStart = performance.now();
      await baselinePage.goto(`${server.url}/load/`, { waitUntil: 'networkidle' });
      await baselinePage.waitForFunction(() => (globalThis as unknown as { __WBC_LOAD__?: { ready: boolean } }).__WBC_LOAD__?.ready === true);
      baselineNavigation.push(performance.now() - baselineStart);
      await baselinePage.waitForFunction(() => (globalThis as unknown as { __WBC_LOAD__: { crossOriginReady: boolean } }).__WBC_LOAD__.crossOriginReady === true);
      const baselineInfo = await baselinePage.evaluate(() => (globalThis as unknown as { __WBC_LOAD__: { nodes: number; tracks: number; workerMessages: number; crossOriginReady: boolean } }).__WBC_LOAD__);
      nodeCount = baselineInfo.nodes;
      trackCount = baselineInfo.tracks;
      baselineWorkers.push(baselineInfo.workerMessages);
      baselineCrossOrigin.push(baselineInfo.crossOriginReady);
      baselineFrames.push(p95(await measureFrameIntervals(baselinePage)));
      const baselineCdp = await baselineContext.newCDPSession(baselinePage);
      const baselineRuntime = await runRuntimeBurst(baselinePage, baselineCdp);
      baselineHeap.push(baselineRuntime.peakJsHeapBytes);
      baselineNodes.push(baselineRuntime.peakDomNodes);
      baselineScroll.push(baselineRuntime.scrollEvents);
      baselinePointer.push(baselineRuntime.pointerBursts);
      baselinePrivateMemory.push(await processPrivateMemory(browserCdp));
      await baselineContext.close();

      const observedContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await installPageObserver(observedContext, 20_000);
      const observedPage = await observedContext.newPage();
      const observedStart = performance.now();
      await observedPage.goto(`${server.url}/load/`, { waitUntil: 'networkidle' });
      await observedPage.waitForFunction(() => (globalThis as unknown as { __WBC_LOAD__?: { ready: boolean; crossOriginReady: boolean } }).__WBC_LOAD__?.ready === true);
      await observedPage.waitForFunction(() => (globalThis as unknown as { __WBC_LOAD__: { crossOriginReady: boolean } }).__WBC_LOAD__.crossOriginReady === true);
      observedNavigation.push(performance.now() - observedStart);
      const observedInfo = await observedPage.evaluate(() => (globalThis as unknown as { __WBC_LOAD__: { workerMessages: number; crossOriginReady: boolean } }).__WBC_LOAD__);
      observedWorkers.push(observedInfo.workerMessages);
      observedCrossOrigin.push(observedInfo.crossOriginReady);
      observedFrames.push(p95(await measureFrameIntervals(observedPage)));
      const observedCdp = await observedContext.newCDPSession(observedPage);
      const observedRuntime = await runRuntimeBurst(observedPage, observedCdp);
      observedHeap.push(observedRuntime.peakJsHeapBytes);
      observedNodes.push(observedRuntime.peakDomNodes);
      observedScroll.push(observedRuntime.scrollEvents);
      observedPointer.push(observedRuntime.pointerBursts);
      observedPrivateMemory.push(await processPrivateMemory(browserCdp));
      observerDroppedRecords += (await readPageObserver(observedPage)).droppedRecords;
      await observedContext.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
  const baselineFrameP95Ms = median(baselineFrames);
  const observedFrameP95Ms = median(observedFrames);
  return {
    iterations, sustainedDurationMs: 2_000, nodeCount, trackCount, baselineFrameP95Ms, observedFrameP95Ms,
    degradationPercent: baselineFrameP95Ms === 0 ? 0 : Number((((observedFrameP95Ms - baselineFrameP95Ms) / baselineFrameP95Ms) * 100).toFixed(3)),
    baselineNavigationMs: median(baselineNavigation),
    observedNavigationMs: median(observedNavigation),
    observerDroppedRecords,
    baselinePeakJsHeapBytes: Math.round(Math.max(...baselineHeap)),
    observedPeakJsHeapBytes: Math.round(Math.max(...observedHeap)),
    baselinePeakDomNodes: Math.round(Math.max(...baselineNodes)),
    observedPeakDomNodes: Math.round(Math.max(...observedNodes)),
    baselineScrollEvents: Math.round(median(baselineScroll)),
    observedScrollEvents: Math.round(median(observedScroll)),
    baselinePointerBursts: Math.round(median(baselinePointer)),
    observedPointerBursts: Math.round(median(observedPointer)),
    baselinePeakPrivateMemoryBytes: Math.round(Math.max(...baselinePrivateMemory)),
    observedPeakPrivateMemoryBytes: Math.round(Math.max(...observedPrivateMemory)),
    privateMemorySupported: baselinePrivateMemory.some((value) => value > 0) || observedPrivateMemory.some((value) => value > 0),
    baselineWorkerMessages: Math.round(median(baselineWorkers)),
    observedWorkerMessages: Math.round(median(observedWorkers)),
    baselineCrossOriginReady: baselineCrossOrigin.every(Boolean),
    observedCrossOriginReady: observedCrossOrigin.every(Boolean),
  };
}
