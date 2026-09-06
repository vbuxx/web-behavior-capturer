import { randomUUID } from 'node:crypto';
import type { Page } from 'playwright';
import type { ContractPackage, ElementRef } from './types.js';

export interface LocatorResolution {
  ref: string;
  selector: string;
  score: number;
  margin: number;
  strategy: 'captured_identity' | 'structural_fingerprint';
  candidateCount: number;
  runnerUpScore: number;
  matchedTagName: string;
  matchedRole: string | null;
}

interface ScoredCandidate {
  index: number;
  score: number;
  identityMatched: boolean;
  tagName: string;
  role: string | null;
}

const MINIMUM_SCORE = 0.5;
const MINIMUM_MARGIN = 0.02;

function round(value: number): number {
  return Number(value.toFixed(4));
}

export async function resolveContractElement(
  page: Page,
  contract: ContractPackage,
  ref: string,
): Promise<LocatorResolution> {
  const source = contract.elements.find((candidate) => candidate.id === ref);
  if (!source) throw new Error(`Cannot resolve missing contract element ${ref}`);
  if (source.frame !== 'main') throw new Error(`Cross-frame locator resolution is not implemented for ${ref}`);
  await page.evaluate('globalThis.__name = globalThis.__name || ((target) => target);');

  if (source.scope?.kind === 'open_shadow') {
    const token = `wbc-${randomUUID()}`;
    const resolved = await page.evaluate(({ captured, value }) => {
      const hostName = captured.scope?.hostRef?.split(':').at(-1);
      const host = hostName ? document.querySelector(`[data-wbc-id="${CSS.escape(hostName)}"]`) : null;
      let root: Document | ShadowRoot | null = host?.shadowRoot ?? null;
      for (const selector of captured.scope?.shadowPath ?? []) {
        const nested: Element | null = root?.querySelector(selector) ?? null;
        root = nested?.shadowRoot ?? null;
      }
      const element = root?.querySelector(captured.selector);
      if (!(element instanceof HTMLElement)) return false;
      element.setAttribute('data-wbc-resolved', value);
      return true;
    }, { captured: source, value: token });
    if (!resolved) throw new Error(`Open shadow locator could not resolve ${ref}`);
    return {
      ref,
      selector: `[data-wbc-resolved="${token}"]`,
      score: 1,
      margin: 1,
      strategy: 'captured_identity',
      candidateCount: 1,
      runnerUpScore: 0,
      matchedTagName: 'unknown',
      matchedRole: null,
    };
  }

  const candidates = await page.locator('body *').evaluateAll((elements, captured: ElementRef) => {
    const inferRole = (element: Element): string | null => {
      const explicit = element.getAttribute('role');
      if (explicit) return explicit;
      if (element instanceof HTMLButtonElement) return 'button';
      if (element instanceof HTMLAnchorElement && element.hasAttribute('href')) return 'link';
      if (element instanceof HTMLInputElement) return element.type === 'checkbox' ? 'checkbox' : 'textbox';
      return null;
    };
    const similarity = (difference: number, scale: number): number => 1 - Math.min(1, Math.abs(difference) / Math.max(scale, 0.0001));
    const source = captured.structuralFingerprint;
    const allElements = [...document.body.querySelectorAll('*')];
    const documentHeight = Math.max(document.documentElement.scrollHeight, 1);
    const viewportWidth = Math.max(document.documentElement.clientWidth, 1);
    return elements.flatMap((element, index): ScoredCandidate[] => {
      if (['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT'].includes(element.tagName)) return [];
      const rect = element.getBoundingClientRect();
      if (rect.width < 12 || rect.height < 8) return [];
      const computed = getComputedStyle(element);
      if (computed.visibility === 'hidden' || computed.display === 'none') return [];
      const transitionDurations = computed.transitionDuration.split(',').map((value) => {
        const trimmed = value.trim();
        return trimmed.endsWith('ms') ? Number.parseFloat(trimmed) : Number.parseFloat(trimmed) * 1000;
      });
      const transitionDurationMs = Math.max(0, ...transitionDurations.filter(Number.isFinite));
      const role = inferRole(element);
      let depth = 0;
      for (let current = element.parentElement; current; current = current.parentElement) depth += 1;
      const tagName = element.tagName.toLowerCase();
      const documentProgress = (rect.top + scrollY) / documentHeight;
      const widthRatio = rect.width / viewportWidth;
      const identityMatched = (element as HTMLElement).dataset.wbcId === captured.dataWbcId
        || captured.locatorCandidates.some((locator) => locator.strategy === 'id' && element.id && locator.value === `#${CSS.escape(element.id)}`);

      let score = 0;
      score += similarity(documentProgress - source.documentProgress, 0.3) * 0.32;
      score += similarity(widthRatio - source.widthRatio, 0.5) * 0.12;
      score += similarity(rect.height - source.heightPx, Math.max(source.heightPx, 80)) * 0.08;
      score += tagName === source.tagName ? 0.16 : 0;
      score += role === source.role ? 0.12 : (source.role && role ? -0.05 : 0);
      score += (transitionDurationMs > 0) === source.hasTransition ? 0.08 : 0;
      if (source.hasTransition && transitionDurationMs > 0) {
        score += similarity(transitionDurationMs - source.transitionDurationMs, Math.max(source.transitionDurationMs, 100)) * 0.05;
      }
      score += similarity(element.childElementCount - source.childElementCount, 4) * 0.04;
      score += similarity(depth - source.depth, 8) * 0.03;
      if (identityMatched) score += 2;

      return [{ index, score, identityMatched, tagName, role }];
    }).sort((left, right) => right.score - left.score);
  }, source);

  const best = candidates[0];
  if (!best) throw new Error(`No visible locator candidates for ${ref}`);
  const runnerUpScore = candidates[1]?.score ?? 0;
  const margin = best.score - runnerUpScore;
  if (!best.identityMatched && (best.score < MINIMUM_SCORE || margin < MINIMUM_MARGIN)) {
    throw new Error(
      `Ambiguous structural locator for ${ref}: score=${round(best.score)}, margin=${round(margin)}, candidates=${candidates.length}`,
    );
  }

  const token = `wbc-${randomUUID()}`;
  await page.locator('body *').nth(best.index).evaluate((element, value) => element.setAttribute('data-wbc-resolved', value), token);
  return {
    ref,
    selector: `[data-wbc-resolved="${token}"]`,
    score: round(best.score),
    margin: round(margin),
    strategy: best.identityMatched ? 'captured_identity' : 'structural_fingerprint',
    candidateCount: candidates.length,
    runnerUpScore: round(runnerUpScore),
    matchedTagName: best.tagName,
    matchedRole: best.role,
  };
}
