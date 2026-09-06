import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { chromium } from 'playwright';
import { loadVisualRedactionPolicy, screenshotWithVisualMask } from '../src/visual-redaction.js';

test('visual policy masks sensitive selectors before screenshot persistence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wbc-visual-redaction-'));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
    await page.setContent('<div id="target" style="width:300px;height:160px;background:#eee"><div data-wbc-sensitive style="width:120px;height:80px;background:#123456;color:white">secret</div></div>');
    const clip = await page.locator('#target').boundingBox();
    assert.ok(clip);
    const policyPath = join(root, 'policy.json');
    const unmaskedPath = join(root, 'unmasked.png');
    const maskedPath = join(root, 'masked.png');
    await writeFile(policyPath, JSON.stringify({ schemaVersion: '1.0.0', selectors: ['[data-wbc-sensitive]'], maskColor: '#FF00FF' }));
    const policy = await loadVisualRedactionPolicy(policyPath);
    await page.screenshot({ path: unmaskedPath, clip });
    const masked = await screenshotWithVisualMask(page, maskedPath, clip, policy);
    assert.deepEqual(masked, ['[data-wbc-sensitive]']);
    assert.notDeepEqual(await readFile(unmaskedPath), await readFile(maskedPath));
  } finally {
    await browser.close();
    await rm(root, { recursive: true, force: true });
  }
});
