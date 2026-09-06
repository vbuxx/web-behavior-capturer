import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { captureSession } from '../src/capture.js';
import { resolveContractElement } from '../src/locator-resolver.js';
import { runTechnicalProbes } from '../src/probes.js';
import { inspectSessionPackage, querySessionBehaviors, querySessionRecords } from '../src/session-index.js';
import { validateContract } from '../src/validate.js';
import { verifyPhase0 } from '../src/verify.js';

test('captures and verifies all Phase 0 behaviors with traceable evidence', { timeout: 90_000 }, async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'wbc-phase0-'));
  try {
    const capture = await captureSession(temporaryDirectory);
    const contract = await validateContract(JSON.parse(await readFile(capture.contractPath, 'utf8')));
    assert.equal(contract.schemaVersion, '1.5.0');
    assert.equal(contract.manifest.redaction.policyVersion, '1.0.0');
    assert.ok(contract.manifest.redaction.redactedValues > 0);
    assert.ok(contract.manifest.redaction.categories.includes('token'));
    assert.doesNotMatch(JSON.stringify(contract), /fixture-secret/);
    assert.deepEqual(
      new Set(contract.behaviors.map((behavior) => behavior.kind)),
      new Set(['hover', 'css_animation', 'interrupted_transition', 'scroll_reveal', 'gsap_scrub']),
    );
    assert.equal(contract.manifest.captureMode, 'natural');
    assert.equal(contract.manifest.quality.droppedRecords, 0);
    assert.equal(contract.manifest.quality.knownLoss, false);
    assert.ok(contract.manifest.quality.observerCost.sampleCount >= 200);

    const targets = contract.manifest.targetCoverage;
    assert.equal(targets.length, 7);
    assert.ok(targets.every((target) => target.collector.status === 'installed'));
    assert.ok(targets.every((target) => (target.clockMapping?.estimatedError.value ?? Infinity) <= 5));
    const mainTarget = targets.find((target) => target.kind === 'main_frame');
    assert.equal(mainTarget?.coverageStart, 'document_start');
    assert.equal(mainTarget?.completeness, 'full');
    const crossOriginTarget = targets.find((target) => target.kind === 'cross_origin_iframe');
    assert.equal(crossOriginTarget?.coverageStart, 'document_start');
    assert.equal(crossOriginTarget?.completeness, 'full');
    assert.ok((crossOriginTarget?.collector.recordCount ?? 0) > 0);
    const nestedTarget = targets.find((target) => target.parentTargetId?.startsWith('nav-1:frame-'));
    assert.equal(nestedTarget?.kind, 'same_origin_iframe');
    assert.ok((nestedTarget?.collector.recordCount ?? 0) > 0);
    const workerTarget = targets.find((target) => target.kind === 'dedicated_worker');
    assert.equal(workerTarget?.coverageStart, 'runtime');
    assert.equal(workerTarget?.completeness, 'partial');
    assert.ok(workerTarget?.gaps.includes('worker_start_to_collector_install'));
    const lifecycleA = targets.find((target) => target.url.includes('/lifecycle-a/'));
    const lifecycleB = targets.find((target) => target.url.includes('/lifecycle-b/'));
    assert.equal(lifecycleA?.lifecycleStatus, 'navigated');
    assert.equal(lifecycleA?.epoch, 1);
    assert.equal(lifecycleA?.completeness, 'partial');
    assert.ok(lifecycleA?.gaps.includes('checkpoint_to_navigation_unobserved'));
    assert.equal(lifecycleB?.lifecycleStatus, 'detached');
    assert.equal(lifecycleB?.epoch, 2);
    assert.equal(lifecycleB?.completeness, 'partial');
    assert.ok(lifecycleB?.gaps.includes('checkpoint_to_detach_unobserved'));
    assert.notEqual(lifecycleA?.targetId, lifecycleB?.targetId);
    assert.notEqual(lifecycleA?.navigationId, lifecycleB?.navigationId);
    assert.ok((lifecycleA?.coverageEnd?.value ?? Infinity) <= (lifecycleA?.detachedAt?.value ?? 0));
    assert.ok((lifecycleB?.coverageEnd?.value ?? Infinity) <= (lifecycleB?.detachedAt?.value ?? 0));

    assert.ok(contract.elements.length > 5);
    assert.ok(contract.elements.every((element) => targets.some((target) => target.targetId === element.targetId)));
    assert.ok(contract.elements.every((element) => (
      targets.find((target) => target.targetId === element.targetId)?.navigationId === element.navigationId
    )));
    assert.ok(contract.elements.some((element) => element.targetId === lifecycleA?.targetId));
    assert.ok(contract.elements.some((element) => element.targetId === lifecycleB?.targetId));
    assert.ok(contract.elements.every((element) => element.structuralFingerprint.tagName.length > 0));
    assert.ok(contract.elements.every((element) => element.structuralFingerprint.documentProgress >= 0));
    const ambiguousElements = contract.elements.filter((element) => element.dataWbcId === 'ambiguous-action');
    assert.equal(ambiguousElements.length, 2);
    assert.ok(ambiguousElements.every((element) => element.ambiguity.status === 'ambiguous'));
    assert.ok(ambiguousElements.every((element) => element.ambiguity.matchCount === 2));
    assert.deepEqual(ambiguousElements.map((element) => element.instanceOrdinal), [1, 2]);

    const evidenceIds = new Set(contract.evidenceIndex.map((entry) => entry.id));
    for (const behavior of contract.behaviors) {
      assert.ok(behavior.provenance.evidenceRefs.length > 0);
      assert.ok(behavior.visualEvidenceRefs.length > 0);
      assert.ok(behavior.provenance.evidenceRefs.every((ref) => evidenceIds.has(ref)));
      assert.ok(behavior.visualEvidenceRefs.every((ref) => evidenceIds.has(ref)));
    }

    const cssAnimation = contract.behaviors.find((behavior) => behavior.kind === 'css_animation');
    assert.equal(cssAnimation?.timeline.domain, 'time');
    assert.equal(cssAnimation?.timeline.domain === 'time' ? cssAnimation.timeline.duration.value : 0, 600);
    assert.ok(cssAnimation?.tracks[0]?.keyframes.length === 3);

    const interrupted = contract.behaviors.find((behavior) => behavior.kind === 'interrupted_transition');
    assert.ok(interrupted?.interruption);
    assert.deepEqual(interrupted?.interruption?.phases.map((phase) => phase.name), ['entry', 'recovery']);
    assert.ok((interrupted?.interruption?.observedState.opacity ?? 0) > 0.58);
    assert.ok((interrupted?.interruption?.observedState.opacity ?? 1) < 1);

    const gsap = contract.behaviors.find((behavior) => behavior.kind === 'gsap_scrub');
    assert.equal(gsap?.timeline.domain, 'scroll');
    assert.equal(gsap?.timeline.domain === 'scroll' ? gsap.timeline.scrub.mode : '', 'direct');
    assert.deepEqual(gsap?.tracks[0]?.samples.map((sample) => sample.progress), [0, 0.25, 0.75, 1, 0.5]);

    const events = await readFile(capture.eventPath, 'utf8');
    assert.match(events, /"type":"animation-started"/);
    assert.match(events, /"type":"interruption-leave"/);
    assert.match(events, /"type":"gsap-scrub-sample"/);
    assert.match(events, /"type":"target-coverage"/);
    assert.match(events, /"sourceTargetId":"nav-1:frame-/);
    assert.doesNotMatch(events, /fixture-secret/);
    assert.equal((await readFile(capture.sessionIndexPath)).includes(Buffer.from('fixture-secret')), false);

    const inspection = await inspectSessionPackage(temporaryDirectory);
    assert.equal(inspection.integrity, 'verified');
    assert.deepEqual(inspection.counts, {
      targets: contract.manifest.targetCoverage.length,
      elements: contract.elements.length,
      behaviors: contract.behaviors.length,
      evidence: contract.evidenceIndex.length,
      records: contract.manifest.quality.recordCount,
    });
    const queriedGsap = await querySessionBehaviors(temporaryDirectory, { kind: 'gsap_scrub', limit: 1 });
    assert.deepEqual(queriedGsap.map((behavior) => behavior.behaviorId), ['gsap-scrolltrigger-scrub']);
    const firstEvidencePage = await querySessionRecords(temporaryDirectory, { limit: 2, byteBudget: 32_000 });
    assert.equal(firstEvidencePage.records.length, 2);
    assert.ok(firstEvidencePage.nextCursor);
    assert.equal(firstEvidencePage.truncatedBy, 'records');
    assert.ok(firstEvidencePage.returnedBytes <= 32_000);
    const secondEvidencePage = await querySessionRecords(temporaryDirectory, {
      limit: 2,
      byteBudget: 32_000,
      cursor: firstEvidencePage.nextCursor!,
    });
    assert.equal(secondEvidencePage.records.length, 2);
    assert.notEqual(firstEvidencePage.records[0]?.recordId, secondEvidencePage.records[0]?.recordId);
    await assert.rejects(
      querySessionRecords(temporaryDirectory, { type: 'mutation', cursor: firstEvidencePage.nextCursor! }),
      /cursor does not match filters/,
    );
    const crossFrameEvidence = await querySessionRecords(temporaryDirectory, {
      sourceTargetId: crossOriginTarget!.targetId,
      type: 'mutation',
      limit: 5,
    });
    assert.ok(crossFrameEvidence.records.length > 0);
    assert.ok(crossFrameEvidence.records.every((record) => record.sourceTargetId === crossOriginTarget!.targetId));
    await assert.rejects(querySessionRecords(temporaryDirectory, { byteBudget: 1 }), /exceeds byte budget/);

    const referenceReport = await verifyPhase0(capture.contractPath, { target: 'reference' });
    assert.deepEqual(referenceReport.summary, { passed: 5, failed: 0, total: 5 });
    assert.equal(referenceReport.scenarioSuiteId, 'phase0-held-out-v1');
    assert.ok(referenceReport.checks.every((check) => check.mismatches.length === 0));

    const replicaReport = await verifyPhase0(capture.contractPath, { target: 'replica' });
    assert.deepEqual(replicaReport.summary, { passed: 5, failed: 0, total: 5 });
    assert.equal(replicaReport.targetLabel, 'replica');
    assert.ok(replicaReport.heldOutConditions.includes('Independent markup, no shared capture IDs, and no GSAP runtime'));
    assert.ok(replicaReport.checks.every((check) => check.mismatches.length === 0));
    assert.ok(replicaReport.checks.every((check) => check.metrics.locatorStrategy === 'structural_fingerprint'));
    assert.doesNotMatch(await readFile(join(process.cwd(), 'fixtures/replica/index.html'), 'utf8'), /data-wbc-id/);
    assert.doesNotMatch(await readFile(join(process.cwd(), 'fixtures/replica/replica.js'), 'utf8'), /data-wbc-id/);

    const ambiguityBrowser = await chromium.launch({ headless: true });
    try {
      const ambiguityPage = await ambiguityBrowser.newPage({ viewport: { width: 1100, height: 740 } });
      await ambiguityPage.addInitScript('globalThis.__name = globalThis.__name || ((target) => target);');
      await ambiguityPage.setContent(`
        <style>button { position: absolute; inset: 120px auto auto 120px; width: 280px; height: 92px; transition: transform 240ms; }</style>
        <button type="button">Candidate A</button><button type="button">Candidate B</button>
      `);
      const hoverBehavior = contract.behaviors.find((behavior) => behavior.kind === 'hover')!;
      await assert.rejects(
        resolveContractElement(ambiguityPage, contract, hoverBehavior.targetRef),
        /Ambiguous structural locator/,
      );
    } finally {
      await ambiguityBrowser.close();
    }

    await appendFile(capture.sessionIndexPath, 'tampered', 'utf8');
    await assert.rejects(inspectSessionPackage(temporaryDirectory), /Session index checksum mismatch/);

    await appendFile(capture.eventPath, '{"tampered":true}\n', 'utf8');
    await assert.rejects(verifyPhase0(capture.contractPath), /Evidence checksum mismatch/);

    const invalid = structuredClone(contract) as unknown as Record<string, unknown>;
    const behaviors = invalid.behaviors as Array<Record<string, unknown>>;
    const timeline = behaviors[0]?.timeline as Record<string, unknown>;
    const duration = timeline.duration as Record<string, unknown>;
    duration.unit = 'px';
    await assert.rejects(validateContract(invalid), /schema validation failed/);

    const invalidTargets = structuredClone(contract);
    invalidTargets.manifest.targetCoverage[1]!.targetId = invalidTargets.manifest.targetCoverage[0]!.targetId;
    await assert.rejects(validateContract(invalidTargets), /duplicate target IDs/);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('surfaces bounded-buffer loss instead of silently dropping records', { timeout: 60_000 }, async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'wbc-loss-'));
  try {
    const capture = await captureSession(temporaryDirectory, { maxPageRecords: 8, overheadRuns: 1 });
    assert.equal(capture.contract.manifest.quality.knownLoss, true);
    assert.ok(capture.contract.manifest.quality.droppedRecords > 0);
    assert.equal(
      capture.contract.manifest.quality.droppedRecords,
      capture.contract.manifest.targetCoverage.reduce((sum, target) => sum + target.collector.droppedRecords, 0),
    );
    assert.ok(capture.contract.manifest.targetCoverage.some((target) => target.collector.knownLoss));
    assert.ok(capture.contract.behaviors.length === 5, 'export remains valid after non-critical observer loss');
    const inspection = await inspectSessionPackage(temporaryDirectory);
    assert.equal(inspection.counts.records, capture.contract.manifest.quality.recordCount);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('observes short animation lifecycle, target coverage, clock mapping, and node recreation', { timeout: 30_000 }, async () => {
  let report = await runTechnicalProbes();
  // Diagnostic timing probes can miss a 72 ms lifecycle under a noisy CI scheduler; retry once without hiding a persistent failure.
  if (report.summary.failed > 0) report = await runTechnicalProbes();
  assert.equal(report.shortAnimation.status, 'passed');
  assert.equal(report.shortAnimation.waapiDurationMs, 72);
  assert.equal(report.shortAnimation.cdpDurationMs, 72);
  assert.ok(report.targetCoverage.every((target) => target.status === 'supported'));
  assert.equal(report.identity.status, 'passed');
  assert.equal(report.clockMapping.status, 'passed');
  assert.equal(report.autoAttach.status, 'passed');
  assert.equal(report.autoAttach.oopifDiscoveredByCdp, true);
  assert.equal(report.autoAttach.childCollectorInstalled, true);
  assert.equal(report.lateAttach.status, 'passed');
  assert.equal(report.lateAttach.completeness, 'partial');
  assert.equal(report.navigationRace.status, 'passed');
  assert.equal(report.summary.failed, 0);
});
