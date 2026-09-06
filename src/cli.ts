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

  console.error('Usage: tsx src/cli.ts <capture|verify|probe|inspect|query> [--out PATH] [--contract PATH] [--package PATH] [--kind KIND] [--limit N] [--offset N] [--target reference|replica] [--scenarios PATH] [--max-records N] [--overhead-runs N]');
  process.exitCode = 2;
}

await main();
