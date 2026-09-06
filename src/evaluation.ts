import { readFile, writeFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { inspectSessionPackage } from './session-index.js';
import { verifyPhase0 } from './verify.js';
import { validateContract } from './validate.js';
import type { ContractPackage } from './types.js';
import { runAgentCommand } from './agent-adapter.js';

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
  agentHarness?: {
    configured: boolean;
    commandLabel: string | null;
    timeoutMs: number;
    runs: Array<{ condition: 'screenshot' | 'trace' | 'wbc'; taskId: string; repetition: number; status: string; durationMs: number; inputTokens: number | null; outputTokens: number | null }>;
    note: string;
  };
}

export async function evaluatePhase2(packagePath: string, outputFile: string, repetitions = 3, options: { agentCommand?: string; taskId?: string; condition?: 'screenshot' | 'trace' | 'wbc'; timeoutMs?: number; evidenceByteBudget?: number } = {}): Promise<EvaluationReport> {
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
  const agentRuns: NonNullable<EvaluationReport['agentHarness']>['runs'] = [];
  if (options.agentCommand) {
    const tasks = matrix.fixtures.filter((fixture) => !options.taskId || fixture.id === options.taskId);
    const conditions = options.condition ? [options.condition] : ['screenshot', 'trace', 'wbc'] as const;
    for (const task of tasks) {
      for (const condition of conditions) {
        for (let repetition = 1; repetition <= repetitions; repetition += 1) {
          const prompt = [
            `WBC evaluation task ${task.id}.`,
            `Condition: ${condition}.`,
            'Use only the evidence exposed for this condition and implement or verify the requested behavior in the provided workspace.',
            `Evidence byte budget: ${options.evidenceByteBudget ?? 65_536}.`,
            'Return a concise final summary; do not read raw event logs.',
          ].join('\n');
          const run = await runAgentCommand({ command: options.agentCommand, cwd: process.cwd(), prompt, timeoutMs: options.timeoutMs ?? 20 * 60_000 });
          agentRuns.push({ condition, taskId: task.id, repetition, status: run.status, durationMs: run.durationMs, inputTokens: run.inputTokens, outputTokens: run.outputTokens });
        }
      }
    }
  }
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
    agentHarness: {
      configured: Boolean(options.agentCommand),
      commandLabel: options.agentCommand ? 'configured process command' : null,
      timeoutMs: options.timeoutMs ?? 20 * 60_000,
      runs: agentRuns,
      note: options.agentCommand
        ? 'Process completion is recorded separately from behavior equivalence; agent success requires a task-specific verifier and is not inferred from exit code.'
        : 'No agent command configured. Screenshot/trace baselines and agent success remain unavailable.',
    },
  };
  await mkdir(dirname(resolve(outputFile)), { recursive: true });
  await writeFile(resolve(outputFile), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return result;
}
