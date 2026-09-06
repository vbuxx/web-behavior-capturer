import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { BehaviorKind } from './types.js';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === 'capture') {
    const { captureSession } = await import('./capture.js');
    const output = resolve(option('--out') ?? '.wbc/phase1');
    const maxRecords = option('--max-records');
    const overheadRuns = option('--overhead-runs');
    const result = await captureSession(output, {
      ...(maxRecords ? { maxPageRecords: Number(maxRecords) } : {}),
      ...(overheadRuns ? { overheadRuns: Number(overheadRuns) } : {}),
    });
    console.log(JSON.stringify({
      status: 'captured',
      contract: result.contractPath,
      sessionIndex: result.sessionIndexPath,
      behaviors: result.contract.behaviors.map((behavior) => behavior.kind),
      quality: result.contract.manifest.quality,
      gaps: result.contract.manifest.gaps,
    }, null, 2));
    return;
  }

  if (command === 'inspect') {
    const { inspectSessionPackage } = await import('./session-index.js');
    const packageDirectory = resolve(option('--package') ?? '.wbc/phase1');
    const result = await inspectSessionPackage(packageDirectory);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'query') {
    const { querySessionBehaviors } = await import('./session-index.js');
    const packageDirectory = resolve(option('--package') ?? '.wbc/phase1');
    const kind = option('--kind');
    const limit = option('--limit');
    const offset = option('--offset');
    const supportedKinds: BehaviorKind[] = ['hover', 'css_animation', 'interrupted_transition', 'scroll_reveal', 'gsap_scrub'];
    if (kind && !supportedKinds.includes(kind as BehaviorKind)) throw new Error(`Unsupported behavior kind: ${kind}`);
    const result = await querySessionBehaviors(packageDirectory, {
      ...(kind ? { kind: kind as BehaviorKind } : {}),
      ...(limit ? { limit: Number(limit) } : {}),
      ...(offset ? { offset: Number(offset) } : {}),
    });
    console.log(JSON.stringify({ behaviors: result, count: result.length }, null, 2));
    return;
  }

  if (command === 'evidence') {
    const { querySessionRecords } = await import('./session-index.js');
    const packageDirectory = resolve(option('--package') ?? '.wbc/phase1');
    const limit = option('--limit');
    const byteBudget = option('--byte-budget');
    const fromSourceTime = option('--from-source-time');
    const toSourceTime = option('--to-source-time');
    const sourceTargetId = option('--source-target');
    const type = option('--type');
    const targetRef = option('--target-ref');
    const cursor = option('--cursor');
    const result = await querySessionRecords(packageDirectory, {
      ...(sourceTargetId ? { sourceTargetId } : {}),
      ...(type ? { type } : {}),
      ...(targetRef ? { targetRef } : {}),
      ...(fromSourceTime ? { fromSourceTime: Number(fromSourceTime) } : {}),
      ...(toSourceTime ? { toSourceTime: Number(toSourceTime) } : {}),
      ...(limit ? { limit: Number(limit) } : {}),
      ...(byteBudget ? { byteBudget: Number(byteBudget) } : {}),
      ...(cursor ? { cursor } : {}),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'verify') {
    const { verifyPhase0 } = await import('./verify.js');
    const contract = resolve(option('--contract') ?? '.wbc/phase1/behavior-contract.json');
    const target = option('--target') ?? 'reference';
    if (target !== 'reference' && target !== 'replica') throw new Error('--target must be reference or replica');
    const report = resolve(option('--out') ?? `${dirname(contract)}/verification-${target}.json`);
    await mkdir(dirname(report), { recursive: true });
    const scenarioFile = option('--scenarios');
    const result = await verifyPhase0(contract, {
      outputFile: report,
      target,
      ...(scenarioFile ? { scenarioFile: resolve(scenarioFile) } : {}),
    });
    console.log(JSON.stringify({ status: result.summary.failed === 0 ? 'passed' : 'failed', target, report, summary: result.summary }, null, 2));
    if (result.summary.failed > 0) process.exitCode = 1;
    return;
  }

  if (command === 'probe') {
    const { runTechnicalProbes } = await import('./probes.js');
    const report = resolve(option('--out') ?? '.wbc/phase1/technical-probe-report.json');
    const result = await runTechnicalProbes(report);
    console.log(JSON.stringify({ status: result.summary.failed === 0 ? 'passed' : 'failed', report, summary: result.summary }, null, 2));
    if (result.summary.failed > 0) process.exitCode = 1;
    return;
  }

  if (command === 'review') {
    const { startReviewServer } = await import('./review-server.js');
    const packageDirectory = resolve(option('--package') ?? 'artifacts/phase1/latest');
    const requestedPort = option('--port');
    const server = await startReviewServer(packageDirectory, requestedPort ? Number(requestedPort) : 0);
    console.log(JSON.stringify({ status: 'ready', url: server.url, package: packageDirectory }, null, 2));
    await new Promise<void>((resolveStop) => {
      const stop = (): void => { void server.close().then(resolveStop); };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
    return;
  }

  if (command === 'benchmark') {
    const { benchmarkSessionPackage, benchmarkSyntheticSessionPackage } = await import('./benchmark.js');
    const packageDirectory = resolve(option('--package') ?? 'artifacts/phase1/latest');
    const iterations = option('--iterations');
    const synthetic = process.argv.includes('--synthetic');
    const result = synthetic
      ? await benchmarkSyntheticSessionPackage({
          sourcePackage: packageDirectory,
          records: Number(option('--records') ?? 10_000),
          evidenceMb: Number(option('--evidence-mb') ?? 10),
          ...(iterations ? { iterations: Number(iterations) } : {}),
        })
      : await benchmarkSessionPackage(packageDirectory, iterations ? Number(iterations) : 3);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'browser-benchmark') {
    const { benchmarkSyntheticBrowser } = await import('./browser-benchmark.js');
    console.log(JSON.stringify(await benchmarkSyntheticBrowser(Number(option('--iterations') ?? 2)), null, 2));
    return;
  }

  if (command === 'capture-benchmark') {
    const { benchmarkCaptureFinalization } = await import('./capture-benchmark.js');
    console.log(JSON.stringify(await benchmarkCaptureFinalization(Number(option('--overhead-runs') ?? 1)), null, 2));
    return;
  }

  if (command === 'reliability-benchmark') {
    const { benchmarkParallelCapture } = await import('./reliability-benchmark.js');
    console.log(JSON.stringify(await benchmarkParallelCapture(Number(option('--parallel') ?? 2), Number(option('--cycles') ?? 1)), null, 2));
    return;
  }

  if (command === 'crash-benchmark') {
    const { runCrashInjection } = await import('./crash-benchmark.js');
    console.log(JSON.stringify(await runCrashInjection(Number(option('--kill-after-ms') ?? 1_000)), null, 2));
    return;
  }

  if (command === 'cleanup-staging') {
    const { cleanupStagingOrphans } = await import('./staging.js');
    const output = resolve(option('--out') ?? '.wbc/phase1');
    console.log(JSON.stringify(await cleanupStagingOrphans(output, Number(option('--max-age-ms') ?? 86_400_000)), null, 2));
    return;
  }

  if (command === 'failure-benchmark') {
    const { runFailureInjection } = await import('./failure-benchmark.js');
    console.log(JSON.stringify(await runFailureInjection(), null, 2));
    return;
  }

  if (command === 'corruption-benchmark') {
    const { benchmarkPackageCorruption } = await import('./corruption-benchmark.js');
    console.log(JSON.stringify(await benchmarkPackageCorruption(resolve(option('--package') ?? 'artifacts/phase1/latest')), null, 2));
    return;
  }

  if (command === 'rotate-package') {
    const { rotateSessionPackage } = await import('./package-rotation.js');
    const packageDirectory = resolve(option('--package') ?? 'artifacts/phase1/latest');
    const archiveDirectory = resolve(option('--archive-dir') ?? `${packageDirectory}.archive`);
    console.log(JSON.stringify(await rotateSessionPackage(packageDirectory, archiveDirectory), null, 2));
    return;
  }

  if (command === 'quota-benchmark') {
    const { benchmarkFileSizeQuota } = await import('./quota-benchmark.js');
    console.log(JSON.stringify(await benchmarkFileSizeQuota(Number(option('--quota-blocks') ?? 128)), null, 2));
    return;
  }

  console.error('Usage: tsx src/cli.ts <capture|verify|probe|inspect|query|evidence|review|benchmark|browser-benchmark|capture-benchmark|reliability-benchmark|crash-benchmark|cleanup-staging|failure-benchmark|corruption-benchmark|rotate-package|quota-benchmark> [--out PATH] [--package PATH] [--archive-dir PATH] [--quota-blocks N] [--port N] [--parallel N] [--cycles N] [--kill-after-ms N] [--max-age-ms N] [--iterations N] [--synthetic] [--records N] [--evidence-mb N] [--kind KIND] [--source-target ID] [--type TYPE] [--target-ref REF] [--from-source-time MS] [--to-source-time MS] [--limit N] [--offset N] [--byte-budget N] [--cursor CURSOR] [--target reference|replica] [--scenarios PATH] [--max-records N] [--overhead-runs N]');
  process.exitCode = 2;
}

await main();
