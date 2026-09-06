import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { startReviewServer } from '../src/review-server.js';

test('serves a verified session through a read-only loopback review UI', { timeout: 30_000 }, async () => {
  const server = await startReviewServer(join(process.cwd(), 'artifacts/phase1/latest'));
  try {
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);

    const sessionResponse = await fetch(`${server.url}/api/session`);
    assert.equal(sessionResponse.status, 200);
    assert.equal(sessionResponse.headers.get('cache-control'), 'no-store');
    const session = await sessionResponse.json() as { integrity: string; counts: { behaviors: number } };
    assert.equal(session.integrity, 'verified');
    assert.equal(session.counts.behaviors, 5);

    const behaviorsResponse = await fetch(`${server.url}/api/behaviors?kind=gsap_scrub&limit=1`);
    const behaviors = await behaviorsResponse.json() as { count: number; behaviors: Array<{ kind: string }> };
    assert.equal(behaviors.count, 1);
    assert.equal(behaviors.behaviors[0]?.kind, 'gsap_scrub');

    const evidenceResponse = await fetch(`${server.url}/api/evidence?type=mutation&limit=2&byteBudget=32768`);
    const evidence = await evidenceResponse.json() as { records: unknown[]; returnedBytes: number };
    assert.equal(evidence.records.length, 2);
    assert.ok(evidence.returnedBytes <= 32_768);

    const invalidResponse = await fetch(`${server.url}/api/behaviors?kind=unknown`);
    assert.equal(invalidResponse.status, 400);
    const methodResponse = await fetch(`${server.url}/api/session`, { method: 'POST' });
    assert.equal(methodResponse.status, 405);

    const pageResponse = await fetch(server.url);
    assert.match(pageResponse.headers.get('content-security-policy') ?? '', /default-src 'self'/);

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(server.url, { waitUntil: 'networkidle' });
      await page.locator('#metrics .metric').first().waitFor();
      assert.equal(await page.locator('#metrics .metric').count(), 4);
      assert.equal(await page.locator('#behaviors .card').count(), 5);
      assert.equal(await page.locator('#error').textContent(), '');
    } finally {
      await browser.close();
    }
  } finally {
    await server.close();
  }
});
