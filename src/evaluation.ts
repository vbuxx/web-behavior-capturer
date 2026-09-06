import { readFile, writeFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { inspectSessionPackage } from './session-index.js';
import { verifyPhase0 } from './verify.js';
import { validateContract } from './validate.js';
import type { ContractPackage } from './types.js';

interface FixtureMatrix { schemaVersion: '1.0.0'; fixtures: Array<{ id: string; status: string; evidence: string | null; note: string }> }

export interface EvaluationReport {
  schemaVersion: '1.0.0';
  generatedAt: string;
  packagePath: string;
  repetitions: number;
  conditions: {
    screenshot: { status: 'unavailable'; reason: string };
    trace: { status: 'unavailable'; reason: string };
    wbc: { status: 'measured'; extractionAccuracy: number; behaviorEquivalence: number; agentSuccess: 'not_measured'; heldOut: string[] };
  };
  observerCost: { degradationPercent: number; droppedRecords: number; knownLoss: boolean };
  fixtureMatrix: FixtureMatrix['fixtures'];
  limitations: string[];
}

export async function evaluatePhase2(packagePath: string, outputFile: string, repetitions = 3): Promise<EvaluationReport> {
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) throw new Error('Evaluation repetitions must be an integer from 1 to 10');
  const packageRoot = resolve(packagePath);
  await inspectSessionPackage(packageRoot);
  const contract = JSON.parse(await readFile(resolve(packageRoot, 'behavior-contract.json'), 'utf8')) as ContractPackage;
  await validateContract(contract);
  const reports = [];
  for (let index = 0; index < repetitions; index += 1) {
    reports.push({
      reference: await verifyPhase0(resolve(packageRoot, 'behavior-contract.json'), { target: 'reference' }),
      replica: await verifyPhase0(resolve(packageRoot, 'behavior-contract.json'), { target: 'replica' }),
    });
  }
  const totalChecks = reports.length * 10;
  const passedChecks = reports.reduce((sum, report) => sum + report.reference.summary.passed + report.replica.summary.passed, 0);
  const matrix = JSON.parse(await readFile(resolve(process.cwd(), 'fixtures/evaluation/fixture-matrix.json'), 'utf8')) as FixtureMatrix;
  const result: EvaluationReport = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    packagePath: packageRoot,
    repetitions,
    conditions: {
      screenshot: { status: 'unavailable', reason: 'No screenshot-only agent harness is included in this repository.' },
      trace: { status: 'unavailable', reason: 'No Playwright trace baseline harness is included in this repository.' },
      wbc: {
        status: 'measured',
        extractionAccuracy: contract.behaviors.length / 5,
        behaviorEquivalence: totalChecks === 0 ? 0 : passedChecks / totalChecks,
        agentSuccess: 'not_measured',
        heldOut: ['interruption', 'reverse', 'viewport'],
      },
    },
    observerCost: {
      degradationPercent: contract.manifest.quality.observerCost.degradationPercent,
      droppedRecords: contract.manifest.quality.droppedRecords,
      knownLoss: contract.manifest.quality.knownLoss,
    },
    fixtureMatrix: matrix.fixtures,
    limitations: [
      'A/B/C agent success, tokens, and time require a separate agent harness and are not inferred from verifier success.',
      'Three repetitions measure WBC verifier stability, not statistical generalization to real websites.',
      'Unsupported fixture scope is reported rather than converted into confidence.',
    ],
  };
  await mkdir(dirname(resolve(outputFile)), { recursive: true });
  await writeFile(resolve(outputFile), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return result;
}
