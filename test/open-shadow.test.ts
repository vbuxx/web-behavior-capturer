import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';
import { installPageObserver, readPageObserver } from '../src/browser-observer.js';
import { startFixtureServer } from '../src/server.js';

test('captures open shadow DOM mutation and interaction evidence', { timeout: 20_000 }, async () => {
  const server = await startFixtureServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await installPageObserver(context);
    const page = await context.newPage();
    await page.goto(`${server.url}/open-shadow/`, { waitUntil: 'load' });
    await page.locator('#shadow-host').evaluate((host) => {
      const button = host.shadowRoot?.querySelector('[data-wbc-id="shadow-button"]') as HTMLElement | null;
      button?.click();
    });
    await page.waitForFunction(() => document.querySelector('#shadow-state')?.textContent === 'clicked');
    const state = await readPageObserver(page);
    assert.ok(state.records.some((record) => record.type === 'click'));
    assert.ok(state.records.some((record) => record.type === 'mutation'));
    await context.close();
  } finally {
    await browser.close();
    await server.close();
  }
});
