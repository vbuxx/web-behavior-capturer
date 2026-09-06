import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { installPageObserver, readPageObserver } from '../src/browser-observer.js';
import { startFixtureServer } from '../src/server.js';

test('captures nested scroller progress and reverse input as explicit container evidence', { timeout: 20_000 }, async () => {
  const server = await startFixtureServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await installPageObserver(context);
    const page = await context.newPage();
    await page.goto(`${server.url}/nested-scroller/`, { waitUntil: 'load' });
    await page.locator('[data-wbc-id="nested-scroller"]').evaluate((node) => {
      (node as HTMLElement).scrollTop = 220;
      node.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await page.waitForTimeout(30);
    await page.locator('[data-wbc-id="nested-scroller"]').evaluate((node) => {
      (node as HTMLElement).scrollTop = 40;
      node.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await page.waitForTimeout(30);
    const state = await readPageObserver(page);
    const scrolls = state.records.filter((record) => record.type === 'scroll');
    assert.ok(scrolls.some((record) => record.payload.containerRef === 'nested-scroller'));
    // Scroll offsets can be quantized differently by the macOS compositor; assert
    // the reverse transition and bounded final position rather than one exact pixel.
    assert.ok(scrolls.some((record) => Number(record.payload.containerScrollTop) >= 180));
    assert.ok(scrolls.some((record) => Number(record.payload.containerScrollTop) >= 0 && Number(record.payload.containerScrollTop) <= 50));
    await context.close();
  } finally {
    await browser.close();
    await server.close();
  }
});
