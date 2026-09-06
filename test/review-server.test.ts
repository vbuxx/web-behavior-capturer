import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { chromium } from 'playwright';
import { startReviewServer } from '../src/review-server.js';

test('serves a verified session through a read-only loopback review UI', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'wbc-review-'));
  const packageRoot = join(root, 'package');
  await cp(join(process.cwd(), 'artifacts/phase1/latest'), packageRoot, { recursive: true });
  const server = await startReviewServer(packageRoot);
  try {
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);

    const headers = { cookie: `wbc_session=${server.authToken}` };
    const sessionResponse = await fetch(`${server.url}/api/session`, { headers });
    assert.equal(sessionResponse.status, 200);
    assert.equal(sessionResponse.headers.get('cache-control'), 'no-store');
    const session = await sessionResponse.json() as { integrity: string; counts: { behaviors: number } };
    assert.equal(session.integrity, 'verified');
    assert.equal(session.counts.behaviors, 5);

    const behaviorsResponse = await fetch(`${server.url}/api/behaviors?kind=gsap_scrub&limit=1`, { headers });
    const behaviors = await behaviorsResponse.json() as { count: number; behaviors: Array<{ kind: string }> };
    assert.equal(behaviors.count, 1);
    assert.equal(behaviors.behaviors[0]?.kind, 'gsap_scrub');

    const evidenceResponse = await fetch(`${server.url}/api/evidence?type=mutation&limit=2&byteBudget=32768`, { headers });
    const evidence = await evidenceResponse.json() as { records: unknown[]; returnedBytes: number };
    assert.equal(evidence.records.length, 2);
    assert.ok(evidence.returnedBytes <= 32_768);

    const visualsResponse = await fetch(`${server.url}/api/visuals`, { headers });
    const visuals = await visualsResponse.json() as { count: number; visuals: Array<{ id: string; mediaType: string }> };
    assert.ok(visuals.count > 0);
    assert.equal(visuals.visuals[0]?.mediaType, 'image/png');
    const imageResponse = await fetch(`${server.url}/api/visual/${encodeURIComponent(visuals.visuals[0]!.id)}`, { headers });
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get('content-type'), 'image/png');
    assert.ok((await imageResponse.arrayBuffer()).byteLength > 100);
    const traversalResponse = await fetch(`${server.url}/api/visual/${encodeURIComponent('../behavior-contract.json')}`, { headers });
    assert.equal(traversalResponse.status, 404);

    const invalidResponse = await fetch(`${server.url}/api/behaviors?kind=unknown`, { headers });
    assert.equal(invalidResponse.status, 400);
    const annotationResponse = await fetch(`${server.url}/api/annotations`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ note: 'reviewed fixture provenance' }) });
    assert.equal(annotationResponse.status, 201);
    const annotation = await annotationResponse.json() as { revisionId: string };
    assert.match(annotation.revisionId, /^revision-/);
    const annotationPage = await fetch(`${server.url}/api/annotations`, { headers });
    assert.equal((await annotationPage.json() as { count: number }).count, 1);
    const revisionsResponse = await fetch(`${server.url}/api/revisions`, { headers });
    assert.equal(revisionsResponse.status, 200);
    const revisions = await revisionsResponse.json() as { activeRevisionId: string; revisions: Array<{ revisionId: string }> };
    assert.equal(revisions.activeRevisionId, annotation.revisionId);
    assert.ok(revisions.revisions.some((revision) => revision.revisionId === annotation.revisionId));
    const graphRevisionResponse = await fetch(`${server.url}/api/graph?revisionId=${encodeURIComponent(annotation.revisionId)}`, { headers });
    assert.equal(graphRevisionResponse.status, 200);
    const methodResponse = await fetch(`${server.url}/api/session`, { method: 'POST', headers });
    assert.equal(methodResponse.status, 405);

    const pageResponse = await fetch(server.url);
    assert.match(pageResponse.headers.get('content-security-policy') ?? '', /default-src 'self'/);
    assert.match(pageResponse.headers.get('set-cookie') ?? '', /HttpOnly/);
    assert.equal((await fetch(`${server.url}/api/session`)).status, 401);

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(server.url, { waitUntil: 'networkidle' });
      await page.locator('#metrics .metric').first().waitFor();
      assert.equal(await page.locator('#metrics .metric').count(), 4);
      assert.equal(await page.locator('#behaviors .card').count(), 5);
      assert.equal(await page.locator('#visuals figure').count(), visuals.count);
      assert.equal(await page.locator('#error').textContent(), '');
    } finally {
      await browser.close();
    }
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
