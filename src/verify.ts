import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import {
  loadScenarioSuite,
  numberArrayParameter,
  numberParameter,
  type VerificationScenario,
} from './scenarios.js';
import { startFixtureServer } from './server.js';
import { resolveContractElement, type LocatorResolution } from './locator-resolver.js';
import { validateContract } from './validate.js';
import type { Behavior, ContractPackage, VerificationCheck, VerificationReport } from './types.js';

type VerificationTarget = 'reference' | 'replica';

export interface VerifyOptions {
  outputFile?: string;
  target?: VerificationTarget;
  scenarioFile?: string;
  targetRoot?: string;
  scenarioIds?: string[];
}
interface ObservedStyle {
  opacity: number;
  x: number;
  y: number;
  transform: string;
  translationX: number;
  translationY: number;
  activeAnimations: number;
  duration: number;
}

function round(value: number, digits = 3): number {
  return Number(value.toFixed(digits));
}

function near(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

function behaviorForScenario(contract: ContractPackage, scenario: VerificationScenario): Behavior {
  const behavior = contract.behaviors.find((item) => item.behaviorId === scenario.behaviorId);
  if (!behavior) throw new Error(`Scenario ${scenario.scenarioId} references missing behavior ${scenario.behaviorId}`);
  if (behavior.kind !== scenario.kind) {
    throw new Error(`Scenario ${scenario.scenarioId} expects ${scenario.kind}, contract has ${behavior.kind}`);
  }
  return behavior;
}

async function style(page: Page, selector: string): Promise<ObservedStyle> {
  return page.locator(selector).evaluate((element) => {
    const computed = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const animations = element.getAnimations();
    const effect = animations[0]?.effect instanceof KeyframeEffect ? animations[0].effect : null;
    const timing = effect?.getTiming();
    const matrix = computed.transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(computed.transform);
    return {
      opacity: Number(computed.opacity), x: rect.x, y: rect.y, transform: computed.transform,
      translationX: matrix.m41, translationY: matrix.m42,
      activeAnimations: animations.filter((animation) => animation.playState === 'running').length,
      duration: typeof timing?.duration === 'number' ? timing.duration : 0,
    };
  });
}

async function settleScroll(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))));
}

async function scrollToAndSample(page: Page, selector: string, y: number): Promise<ObservedStyle> {
  await page.evaluate((nextY) => scrollTo(0, nextY), y);
  await settleScroll(page);
  return style(page, selector);
}

async function verifyHover(page: Page, selector: string, behavior: Behavior, scenario: VerificationScenario): Promise<VerificationCheck> {
  await page.locator(selector).scrollIntoViewIfNeeded();
  await settleScroll(page);
  await page.mouse.move(2, 2);
  const before = await style(page, selector);
  await page.locator(selector).hover();
  const duration = behavior.timeline.domain === 'time' ? behavior.timeline.duration.value : 0;
  await page.waitForTimeout(duration + numberParameter(scenario, 'settleBufferMs'));
  const after = await style(page, selector);
  const samples = behavior.tracks[0]?.samples ?? [];
  const expectedYDelta = (samples.at(-1)?.y ?? before.y) - (samples[0]?.y ?? before.y);
  const observedYDelta = after.y - before.y;
  const positionOk = near(observedYDelta, expectedYDelta, numberParameter(scenario, 'positionTolerancePx'));
  const opacityDelta = after.opacity - before.opacity;
  const opacityOk = opacityDelta >= numberParameter(scenario, 'minimumOpacityDelta');
  const passed = positionOk && opacityOk;
  return {
    scenarioId: scenario.scenarioId,
    behaviorId: behavior.behaviorId,
    status: passed ? 'passed' : 'failed',
    scenario: 'Complete hover entry resolved through stable element identity.',
    metrics: { expectedYDelta: round(expectedYDelta), observedYDelta: round(observedYDelta), opacityDelta: round(opacityDelta) },
    mismatches: passed ? [] : ['Hover trajectory or opacity direction differs from the captured contract.'],
  };
}

async function verifyCssAnimation(page: Page, targetSelector: string, triggerSelector: string, behavior: Behavior, scenario: VerificationScenario): Promise<VerificationCheck> {
  await page.locator(triggerSelector).scrollIntoViewIfNeeded();
  await page.locator(triggerSelector).click();
  await page.waitForTimeout(numberParameter(scenario, 'sampleAtMs'));
  const active = await style(page, targetSelector);
  const expectedDuration = behavior.timeline.domain === 'time' ? behavior.timeline.duration.value : 0;
  const passed = active.activeAnimations > 0 && near(active.duration, expectedDuration, numberParameter(scenario, 'durationToleranceMs'));
  return {
    scenarioId: scenario.scenarioId,
    behaviorId: behavior.behaviorId,
    status: passed ? 'passed' : 'failed',
    scenario: 'Trigger target and animation target resolved independently from the contract.',
    metrics: { activeAnimations: active.activeAnimations, expectedDurationMs: expectedDuration, observedDurationMs: active.duration },
    mismatches: passed ? [] : ['Animation lifecycle or declared duration differs from the contract.'],
  };
}

async function verifyInterruption(page: Page, selector: string, behavior: Behavior, scenario: VerificationScenario): Promise<VerificationCheck> {
  const duration = behavior.timeline.domain === 'time' ? behavior.timeline.duration.value : 0;
  await page.locator(selector).scrollIntoViewIfNeeded();
  await settleScroll(page);
  await page.mouse.move(2, 2);
  const idle = await style(page, selector);
  await page.locator(selector).hover();
  const heldOutExitMs = Math.max(
    numberParameter(scenario, 'minimumExitMs'),
    Math.round(duration * numberParameter(scenario, 'exitFraction')),
  );
  await page.waitForTimeout(heldOutExitMs);
  const atExit = await style(page, selector);
  await page.mouse.move(2, 2);
  await page.waitForTimeout(duration + numberParameter(scenario, 'recoveryBufferMs'));
  const recovered = await style(page, selector);
  const changedBeforeExit = Math.abs(atExit.translationX - idle.translationX) > 1 || Math.abs(atExit.opacity - idle.opacity) > 0.01;
  const recoveredToIdle = near(recovered.translationX, idle.translationX, numberParameter(scenario, 'positionTolerancePx'))
    && near(recovered.opacity, idle.opacity, numberParameter(scenario, 'opacityTolerance'));
  const passed = changedBeforeExit && recoveredToIdle;
  return {
    scenarioId: scenario.scenarioId,
    behaviorId: behavior.behaviorId,
    status: passed ? 'passed' : 'failed',
    scenario: `Exit at ${round(numberParameter(scenario, 'exitFraction') * 100)}% duration, then recover to idle.`,
    metrics: {
      heldOutExitMs, changedBeforeExit,
      interruptionTranslationX: round(atExit.translationX), idleTranslationX: round(idle.translationX), recoveredTranslationX: round(recovered.translationX),
      idleOpacity: idle.opacity, recoveredOpacity: recovered.opacity,
    },
    mismatches: passed ? [] : ['The transition did not expose a partial state or did not recover to idle.'],
  };
}

async function verifyScrollReveal(page: Page, selector: string, behavior: Behavior, scenario: VerificationScenario): Promise<VerificationCheck> {
  await page.evaluate(() => scrollTo(0, 0));
  await settleScroll(page);
  const idle = await style(page, selector);
  const absoluteTop = await page.locator(selector).evaluate((element) => element.getBoundingClientRect().top + scrollY);
  const scanWindow = numberParameter(scenario, 'scanWindowPx');
  const scanStep = numberParameter(scenario, 'scanStepPx');
  const minimumOpacityDelta = numberParameter(scenario, 'minimumOpacityDelta');
  let onset = 0;
  for (let y = Math.max(0, absoluteTop - scanWindow); y <= absoluteTop; y += scanStep) {
    const current = await scrollToAndSample(page, selector, y);
    if (current.opacity - idle.opacity >= minimumOpacityDelta) {
      onset = y;
      break;
    }
  }
  const revealed = onset > 0;
  const reverseY = Math.max(0, onset - numberParameter(scenario, 'reverseOffsetPx'));
  await page.evaluate((y) => scrollTo(0, y), reverseY);
  await settleScroll(page);
  const duration = behavior.timeline.domain === 'time' ? behavior.timeline.duration.value : 0;
  await page.waitForTimeout(duration + 50);
  const reversed = await style(page, selector);
  const hiddenAfterReverse = near(reversed.opacity, idle.opacity, numberParameter(scenario, 'opacityTolerance'));
  const passed = revealed && hiddenAfterReverse;
  return {
    scenarioId: scenario.scenarioId,
    behaviorId: behavior.behaviorId,
    status: passed ? 'passed' : 'failed',
    scenario: 'Observe a visual threshold crossing, then reverse until the target returns to idle.',
    metrics: { resolvedOnsetScrollY: onset, revealed, hiddenAfterReverse, reverseOpacity: reversed.opacity },
    mismatches: passed ? [] : ['Reveal did not return to its captured idle state after reverse scrolling.'],
  };
}

function transformTranslationX(transform: string): number {
  if (transform === 'none') return 0;
  const matrix3d = transform.match(/^matrix3d\((.+)\)$/);
  if (matrix3d?.[1]) return Number(matrix3d[1].split(',')[12]?.trim() ?? 0);
  const matrix = transform.match(/^matrix\((.+)\)$/);
  if (matrix?.[1]) return Number(matrix[1].split(',')[4]?.trim() ?? 0);
  return 0;
}

async function refineBoundary(
  page: Page,
  selector: string,
  low: number,
  high: number,
  predicate: (translation: number) => boolean,
): Promise<number> {
  let lower = low;
  let upper = high;
  for (let index = 0; index < 9; index += 1) {
    const middle = (lower + upper) / 2;
    const current = await scrollToAndSample(page, selector, middle);
    if (predicate(current.translationX)) upper = middle;
    else lower = middle;
  }
  return upper;
}

async function verifyScrub(page: Page, selector: string, behavior: Behavior, scenario: VerificationScenario): Promise<VerificationCheck> {
  await page.evaluate(() => scrollTo(0, 0));
  await settleScroll(page);
  const idle = await style(page, selector);
  const track = behavior.tracks.find((candidate) => candidate.property === 'transform') ?? behavior.tracks[0];
  const progressZero = track?.samples.find((sample) => sample.progress === 0);
  const progressOne = track?.samples.find((sample) => sample.progress === 1);
  const expectedTravel = transformTranslationX(progressOne?.transform ?? 'none') - transformTranslationX(progressZero?.transform ?? 'none');
  if (expectedTravel === 0) throw new Error(`Behavior ${behavior.behaviorId} has no measurable scrub travel`);

  const scanStep = numberParameter(scenario, 'scanStepPx');
  const motionThreshold = numberParameter(scenario, 'boundaryMotionPx');
  const maxScroll = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  let startBracket: [number, number] | undefined;
  let endBracket: [number, number] | undefined;
  let previousY = 0;
  for (let y = 0; y <= maxScroll; y += scanStep) {
    const current = await scrollToAndSample(page, selector, y);
    const travel = current.translationX - idle.translationX;
    if (!startBracket && travel > motionThreshold) startBracket = [previousY, y];
    if (!endBracket && travel >= expectedTravel - motionThreshold) {
      endBracket = [previousY, y];
      break;
    }
    previousY = y;
  }
  if (!startBracket || !endBracket) throw new Error(`Could not resolve observed scrub range for ${behavior.behaviorId}`);

  const start = await refineBoundary(page, selector, startBracket[0], startBracket[1], (translation) => translation - idle.translationX > motionThreshold);
  const end = await refineBoundary(page, selector, endBracket[0], endBracket[1], (translation) => translation - idle.translationX >= expectedTravel - motionThreshold);
  const requestedPoints = numberArrayParameter(scenario, 'progressPoints');
  const results: Array<{ requested: number; actual: number; translationX: number }> = [];
  for (const requested of requestedPoints) {
    const y = start + (end - start) * requested;
    const current = await scrollToAndSample(page, selector, y);
    results.push({
      requested,
      actual: (current.translationX - idle.translationX) / expectedTravel,
      translationX: current.translationX,
    });
  }
  const progressTolerance = numberParameter(scenario, 'progressTolerance');
  const progressOk = results.every((result) => near(result.actual, result.requested, progressTolerance));
  const reverseOk = results.length >= 3
    && (results[2]?.translationX ?? 0) < (results[1]?.translationX ?? 0)
    && (results[2]?.translationX ?? 0) > (results[0]?.translationX ?? 0);
  const passed = progressOk && reverseOk;
  return {
    scenarioId: scenario.scenarioId,
    behaviorId: behavior.behaviorId,
    status: passed ? 'passed' : 'failed',
    scenario: `Resolve motion boundaries from computed output, sample ${requestedPoints.join(', ')}, and verify reverse.`,
    metrics: {
      maxProgressError: round(Math.max(...results.map((result) => Math.abs(result.actual - result.requested)))),
      reverseMonotonic: reverseOk,
      observedStartPx: round(start), observedEndPx: round(end), expectedTravelPx: round(expectedTravel),
    },
    mismatches: passed ? [] : ['Scroll-linked progress mapping or reverse trajectory differs from the contract.'],
  };
}

async function runScenario(page: Page, contract: ContractPackage, scenario: VerificationScenario): Promise<VerificationCheck> {
  const behavior = behaviorForScenario(contract, scenario);
  const refs = [...new Set([
    behavior.targetRef,
    ...(behavior.trigger.targetRef === 'viewport' ? [] : [behavior.trigger.targetRef]),
  ])];
  let resolutions: LocatorResolution[];
  try {
    resolutions = await Promise.all(refs.map((ref) => resolveContractElement(page, contract, ref)));
  } catch (error) {
    return {
      scenarioId: scenario.scenarioId,
      behaviorId: behavior.behaviorId,
      status: 'failed',
      scenario: 'Resolve contract targets independently and reject ambiguous candidates.',
      metrics: { locatorRejected: true },
      mismatches: [error instanceof Error ? error.message : String(error)],
    };
  }
  const selectors = new Map(resolutions.map((resolution) => [resolution.ref, resolution.selector]));
  const targetSelector = selectors.get(behavior.targetRef)!;
  let check: VerificationCheck;
  switch (scenario.kind) {
    case 'hover': check = await verifyHover(page, targetSelector, behavior, scenario); break;
    case 'css_animation': check = await verifyCssAnimation(page, targetSelector, selectors.get(behavior.trigger.targetRef)!, behavior, scenario); break;
    case 'interrupted_transition': check = await verifyInterruption(page, targetSelector, behavior, scenario); break;
    case 'scroll_reveal': check = await verifyScrollReveal(page, targetSelector, behavior, scenario); break;
    case 'gsap_scrub': check = await verifyScrub(page, targetSelector, behavior, scenario); break;
  }
  check.metrics.locatorStrategy = resolutions.every((resolution) => resolution.strategy === 'structural_fingerprint')
    ? 'structural_fingerprint'
    : 'captured_identity';
  check.metrics.locatorMinimumScore = Math.min(...resolutions.map((resolution) => resolution.score));
  check.metrics.locatorMinimumMargin = Math.min(...resolutions.map((resolution) => resolution.margin));
  check.metrics.locatorCandidateCount = Math.max(...resolutions.map((resolution) => resolution.candidateCount));
  return check;
}

async function validateEvidenceFiles(contract: ContractPackage, contractPath: string): Promise<void> {
  const root = dirname(contractPath);
  const unique = new Map(contract.evidenceIndex.map((entry) => [entry.path, entry.sha256]));
  for (const [path, expected] of unique) {
    const actual = createHash('sha256').update(await readFile(resolve(root, path))).digest('hex');
    if (actual !== expected) throw new Error(`Evidence checksum mismatch for ${path}`);
  }
}

export async function verifyPhase0(contractFile: string, options: VerifyOptions = {}): Promise<VerificationReport> {
  const contractPath = resolve(contractFile);
  const contract = await validateContract(JSON.parse(await readFile(contractPath, 'utf8')));
  await validateEvidenceFiles(contract, contractPath);
  const suite = await loadScenarioSuite(options.scenarioFile);
  const target = options.target ?? 'reference';
  const server = await startFixtureServer(options.targetRoot ? { replicaRoot: resolve(options.targetRoot) } : {});
  const browser = await chromium.launch({ headless: true });
  const targetUrl = `${server.url}/${target}/`;
  try {
    const context = await browser.newContext({ viewport: suite.viewport, reducedMotion: 'no-preference' });
    await context.addInitScript('globalThis.__name = globalThis.__name || ((target) => target);');
    const checks: VerificationCheck[] = [];
    const scenarios = options.scenarioIds ? suite.scenarios.filter((scenario) => options.scenarioIds?.includes(scenario.scenarioId)) : suite.scenarios;
    for (const scenario of scenarios) {
      const page = await context.newPage();
      await page.goto(targetUrl, { waitUntil: 'networkidle' });
      await page.waitForSelector('body[data-wbc-ready="true"]');
      checks.push(await runScenario(page, contract, scenario));
      await page.close();
    }
    const passed = checks.filter((check) => check.status === 'passed').length;
    const report: VerificationReport = {
      schemaVersion: '1.0.0',
      verifiedAt: new Date().toISOString(),
      referenceSessionId: contract.manifest.sessionId,
      scenarioSuiteId: suite.suiteId,
      targetLabel: target,
      targetUrl,
      heldOutConditions: [
        `Viewport ${suite.viewport.width}x${suite.viewport.height}`,
        'Scenario parameters loaded from versioned JSON',
        'Elements resolved by scored identity and structural evidence, not source selectors',
        ...(target === 'replica' ? ['Independent markup, no shared capture IDs, and no GSAP runtime'] : []),
      ],
      checks,
      summary: { passed, failed: checks.length - passed, total: checks.length },
    };
    if (options.outputFile) await writeFile(resolve(options.outputFile), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await context.close();
    return report;
  } finally {
    await browser.close();
    await server.close();
  }
}
