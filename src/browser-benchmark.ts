import { chromium } from 'playwright';
import { installPageObserver, measureFrameIntervals, readPageObserver } from './browser-observer.js';
import { startFixtureServer } from './server.js';

export interface BrowserLoadBenchmark {
  iterations: number;
  nodeCount: number;
  trackCount: number;
  baselineFrameP95Ms: number;
  observedFrameP95Ms: number;
  degradationPercent: number;
  baselineNavigationMs: number;
  observedNavigationMs: number;
  observerDroppedRecords: number;
}

function p95(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return Number((sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0).toFixed(3));
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return Number((sorted[Math.floor(sorted.length / 2)] ?? 0).toFixed(3));
}

export async function benchmarkSyntheticBrowser(iterations = 2): Promise<BrowserLoadBenchmark> {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10) throw new Error('Browser benchmark iterations must be 1 to 10');
  const server = await startFixtureServer();
  const browser = await chromium.launch({ headless: true });
  const baselineFrames: number[] = [];
  const observedFrames: number[] = [];
  const baselineNavigation: number[] = [];
  const observedNavigation: number[] = [];
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
      const baselineInfo = await baselinePage.evaluate(() => (globalThis as unknown as { __WBC_LOAD__: { nodes: number; tracks: number } }).__WBC_LOAD__);
      nodeCount = baselineInfo.nodes;
      trackCount = baselineInfo.tracks;
      baselineFrames.push(p95(await measureFrameIntervals(baselinePage)));
      await baselineContext.close();

      const observedContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await installPageObserver(observedContext, 20_000);
      const observedPage = await observedContext.newPage();
      const observedStart = performance.now();
      await observedPage.goto(`${server.url}/load/`, { waitUntil: 'networkidle' });
      await observedPage.waitForFunction(() => (globalThis as unknown as { __WBC_LOAD__?: { ready: boolean } }).__WBC_LOAD__?.ready === true);
      observedNavigation.push(performance.now() - observedStart);
      observedFrames.push(p95(await measureFrameIntervals(observedPage)));
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
    iterations, nodeCount, trackCount, baselineFrameP95Ms, observedFrameP95Ms,
    degradationPercent: baselineFrameP95Ms === 0 ? 0 : Number((((observedFrameP95Ms - baselineFrameP95Ms) / baselineFrameP95Ms) * 100).toFixed(3)),
    baselineNavigationMs: median(baselineNavigation),
    observedNavigationMs: median(observedNavigation),
    observerDroppedRecords,
  };
}
