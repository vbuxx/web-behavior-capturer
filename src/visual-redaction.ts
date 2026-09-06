import { readFile } from 'node:fs/promises';
import type { Page } from 'playwright';

export interface VisualScreenshotClip {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualRedactionPolicy {
  schemaVersion: '1.0.0';
  selectors: string[];
  maskColor: string;
}

export const DEFAULT_VISUAL_REDACTION_POLICY: VisualRedactionPolicy = {
  schemaVersion: '1.0.0',
  selectors: [
    'input[type="password"]',
    'input[autocomplete="current-password"]',
    'input[autocomplete="new-password"]',
    'input[autocomplete="cc-number"]',
    '[data-wbc-sensitive]',
  ],
  maskColor: '#FF00FF',
};

function assertPolicy(value: unknown): VisualRedactionPolicy {
  if (!value || typeof value !== 'object') throw new Error('Visual redaction policy must be an object');
  const candidate = value as Partial<VisualRedactionPolicy>;
  if (candidate.schemaVersion !== '1.0.0'
    || !Array.isArray(candidate.selectors)
    || candidate.selectors.length > 100
    || candidate.selectors.some((selector) => typeof selector !== 'string' || selector.trim().length === 0)
    || typeof candidate.maskColor !== 'string'
    || !/^#[0-9a-f]{6}$/i.test(candidate.maskColor)) {
    throw new Error('Visual redaction policy schema validation failed');
  }
  return {
    schemaVersion: '1.0.0',
    selectors: [...new Set(candidate.selectors.map((selector) => selector.trim()))],
    maskColor: candidate.maskColor,
  };
}

export async function loadVisualRedactionPolicy(path?: string): Promise<VisualRedactionPolicy> {
  if (!path) return DEFAULT_VISUAL_REDACTION_POLICY;
  return assertPolicy(JSON.parse(await readFile(path, 'utf8')));
}

export async function screenshotWithVisualMask(
  page: Page,
  path: string,
  clip: VisualScreenshotClip,
  policy: VisualRedactionPolicy,
): Promise<string[]> {
  const activeSelectors: string[] = [];
  for (const selector of policy.selectors) {
    const locator = page.locator(selector);
    if (await locator.count() > 0) activeSelectors.push(selector);
  }
  await page.screenshot({
    path,
    animations: 'allow',
    clip,
    mask: activeSelectors.map((selector) => page.locator(selector)),
    maskColor: policy.maskColor,
  });
  return activeSelectors;
}
