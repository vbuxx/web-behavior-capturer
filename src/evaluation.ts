import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { inspectSessionPackage } from './session-index.js';
import { verifyPhase0 } from './verify.js';
import { validateContract } from './validate.js';
import type { ContractPackage, VerificationReport } from './types.js';
import { runAgentCommand } from './agent-adapter.js';
import { loadEvaluationTaskSpec, taskPath, type EvaluationCondition, type EvaluationTask } from './evaluation-tasks.js';

const execFileAsync = promisify(execFile);
type AgentSuccess = number | 'not_measured';

interface ConditionSummary {
  status: 'measured' | 'unavailable';
  agentSuccess: AgentSuccess;
  verifierSuccess?: number;
  reason?: string;
}

export interface EvaluationReport {
  schemaVersion: '1.2.0';
  generatedAt: string;
  packagePath: string;
  repetitions: number;
  conditions: {
    screenshot: ConditionSummary;
    trace: ConditionSummary;
    wbc: ConditionSummary & { extractionAccuracy: number; behaviorEquivalence: number; heldOut: string[] };
  };
  observerCost: { degradationPercent: number; droppedRecords: number; knownLoss: boolean };
  fixtureMatrix: Array<{ id: string; status: EvaluationTask['status']; evidence: string; note: string }>;
  limitations: string[];
  agentHarness?: {
    configured: boolean;
    commandLabel: string | null;
    model: string;
    reasoning: string;
    seed: number;
    timeoutMs: number;
    evidenceByteBudget: number;
    startingRef: string;
    runs: Array<{
      condition: EvaluationCondition;
      taskId: string;
      repetition: number;
      status: string;
      durationMs: number;
      inputTokens: number | null;
      outputTokens: number | null;
      evidenceBytes: number;
      bundleSha256: string;
      verifierStatus: 'passed' | 'failed' | 'unsupported' | 'not_run';
      verifierPassed: number | null;
      verifierFailed: number | null;
      errorProvenance?: string;
    }>;
    note: string;
  };
}

const taskScenarioIds: Record<string, string[]> = {
  'hover-focus-interruption': ['hover-complete', 'interrupt-quarter-duration'],
  'css-waapi': ['css-animation-lifecycle'],
  'gsap-boolean-numeric-scrub': ['scrub-held-out-reverse'],
};

async function resolveStartingRef(): Promise<string> {
  try {
    const result = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd() });
    return result.stdout.trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Default local adapter command. Model/reasoning are forwarded to the process, not merely recorded. */
export function defaultCodexCommand(model: string, reasoning: string): string {
  return `codex exec --ephemeral --skip-git-repo-check --sandbox workspace-write --model ${JSON.stringify(model)} -c ${JSON.stringify(`model_reasoning_effort=${reasoning}`)} -`;
}

async function directorySize(root: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    total += entry.isDirectory() ? await directorySize(path) : (await stat(path)).size;
  }
  return total;
}

async function directorySha256(root: string): Promise<string> {
  const files: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files.push(path);
    }
  };
  await walk(root);
  const hash = createHash('sha256');
  for (const path of files.sort()) {
    hash.update(path.slice(root.length));
    hash.update(await readFile(path));
  }
  return hash.digest('hex');
}

async function preflightBundle(root: string, condition: EvaluationCondition, task: EvaluationTask, evidenceByteBudget: number): Promise<{ bytes: number; sha256: string }> {
  const forbiddenName = /(events\.jsonl|headers?|bodies?|cookie|authorization|credential|secret|token)/i;
  const forbiddenContent = /(authorization\s*[:=]|cookie\s*[:=]|set-cookie|bearer\s+[a-z0-9._-]+|WBC_EVAL_CANARY_[A-Z0-9]+)/i;
  const textExtensions = new Set(['.json', '.jsonl', '.txt', '.html', '.js', '.css', '.md']);
  const files: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const relativePath = path.slice(root.length + 1);
      if (entry.isSymbolicLink()) throw new Error(`Evaluation bundle contains symlink: ${relativePath}`);
      if (forbiddenName.test(relativePath)) throw new Error(`Evaluation bundle contains forbidden path: ${relativePath}`);
      if (entry.isDirectory()) await walk(path);
      else files.push(path);
    }
  };
  await walk(root);
  const allowlist = task.evidenceAllowlist[condition];
  const allowed = (relativePath: string): boolean => allowlist.some((pattern) => {
    const expression = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    return expression.test(relativePath);
  });
  for (const path of files) {
    const relativePath = path.slice(root.length + 1);
    if (!allowed(relativePath)) throw new Error(`Evidence file is not allowlisted for ${task.id}/${condition}: ${relativePath}`);
  }
  for (const path of files) {
    const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
    if (textExtensions.has(extension) && forbiddenContent.test(await readFile(path, 'utf8'))) {
      throw new Error(`Evaluation bundle contains forbidden credential-like content: ${path.slice(root.length + 1)}`);
    }
  }
  const bytes = await directorySize(root);
  if (bytes > evidenceByteBudget) throw new Error(`Evidence byte budget exceeded for ${task.id}/${condition}: ${bytes} > ${evidenceByteBudget}`);
  const sha256 = await directorySha256(root);
  return { bytes, sha256 };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function buildConditionWorkspace(packageRoot: string, contract: ContractPackage, task: EvaluationTask, condition: EvaluationCondition, evidenceByteBudget: number): Promise<{ root: string; evidenceBytes: number; bundleSha256: string }> {
  const root = await mkdtemp(join(tmpdir(), 'wbc-agent-eval-'));
  await cp(taskPath(task, 'starterPath'), join(root, 'app'), { recursive: true });
  const evidenceRoot = join(root, '.wbc', 'evidence');
  await mkdir(evidenceRoot, { recursive: true });
  const behaviorId = task.behaviorId;
  if (condition === 'screenshot') {
    const visualEntries = contract.evidenceIndex.filter((entry) => entry.mediaType === 'image/png');
    for (const entry of visualEntries) await cp(resolve(packageRoot, entry.path), join(evidenceRoot, 'visual', entry.path.split('/').pop()!));
  } else if (condition === 'trace') {
    const eventsEntry = contract.evidenceIndex.find((entry) => entry.mediaType === 'application/x-ndjson');
    const records = eventsEntry
      ? (await readFile(resolve(packageRoot, eventsEntry.path), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as { type: string; source: string; targetRef?: string; payload: Record<string, unknown> })
      : [];
    await writeJson(join(evidenceRoot, 'trace-summary.json'), records.filter((record) => ['input', 'mutation', 'animation-started', 'animation-canceled', 'network-response'].includes(record.type)).map(({ type, source, targetRef, payload }) => ({ type, source, targetRef: targetRef ?? null, payload })));
    await writeJson(join(evidenceRoot, 'dom-action-evidence.json'), records.filter((record) => ['input', 'mutation', 'observable-state-fingerprint'].includes(record.type)));
  } else {
    const graphPath = contract.manifest.evidenceGraph?.path;
    const graph = graphPath ? JSON.parse(await readFile(resolve(packageRoot, graphPath), 'utf8')) : { nodes: [], edges: [], limitations: [] };
    await writeJson(join(evidenceRoot, 'behavior-contract-subset.json'), contract.behaviors.filter((behavior) => !behaviorId || behavior.behaviorId === behaviorId));
    await writeJson(join(evidenceRoot, 'evidence-graph-subset.json'), {
      ...graph,
      nodes: graph.nodes.filter((node: { payload?: { behaviorId?: string }; id: string }) => !behaviorId || node.payload?.behaviorId === behaviorId || node.id.includes(behaviorId)),
      edges: graph.edges.filter((edge: { from: string; to: string }) => !behaviorId || edge.from.includes(behaviorId) || edge.to.includes(behaviorId)),
    });
    await writeJson(join(evidenceRoot, 'gap-summary.json'), { limitations: graph.limitations ?? [], unknowns: contract.behaviors.flatMap((behavior) => behavior.unknowns) });
  }
  try {
    const preflight = await preflightBundle(evidenceRoot, condition, task, evidenceByteBudget);
    return { root, evidenceBytes: preflight.bytes, bundleSha256: preflight.sha256 };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

async function verifyAgentWorkspace(contractPath: string, workspaceRoot: string, task: EvaluationTask): Promise<{ status: 'passed' | 'failed' | 'unsupported'; passed: number | null; failed: number | null; error?: string }> {
  const scenarioIds = taskScenarioIds[task.id];
  if (!scenarioIds) return { status: 'unsupported', passed: null, failed: null, error: `No task-specific held-out verifier for ${task.id}` };
  try {
    const report: VerificationReport = await verifyPhase0(contractPath, { target: 'replica', targetRoot: join(workspaceRoot, 'app'), scenarioIds });
    return { status: report.summary.failed === 0 ? 'passed' : 'failed', passed: report.summary.passed, failed: report.summary.failed };
  } catch (error) {
    return { status: 'failed', passed: 0, failed: scenarioIds.length, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function evaluatePhase2(
  packagePath: string,
  outputFile: string,
  repetitions = 3,
  options: { agentCommand?: string; taskId?: string; condition?: EvaluationCondition; timeoutMs?: number; evidenceByteBudget?: number; model?: string; reasoning?: string; seed?: number; startingRef?: string } = {},
): Promise<EvaluationReport> {
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) throw new Error('Evaluation repetitions must be an integer from 1 to 10');
  const packageRoot = resolve(packagePath);
  await inspectSessionPackage(packageRoot);
  const contract = JSON.parse(await readFile(resolve(packageRoot, 'behavior-contract.json'), 'utf8')) as ContractPackage;
  await validateContract(contract);
  const reports = [];
  for (let index = 0; index < repetitions; index += 1) reports.push({ reference: await verifyPhase0(resolve(packageRoot, 'behavior-contract.json'), { target: 'reference' }), replica: await verifyPhase0(resolve(packageRoot, 'behavior-contract.json'), { target: 'replica' }) });
  const totalChecks = reports.length * 10;
  const passedChecks = reports.reduce((sum, report) => sum + report.reference.summary.passed + report.replica.summary.passed, 0);
  const taskSpec = await loadEvaluationTaskSpec();
  const agentRuns: NonNullable<EvaluationReport['agentHarness']>['runs'] = [];
  const timeoutMs = options.timeoutMs ?? 20 * 60_000;
  const evidenceByteBudget = options.evidenceByteBudget ?? 65_536;
  const model = options.model ?? 'gpt-5.6-sol';
  const reasoning = options.reasoning ?? 'high';
  const seed = options.seed ?? 1;
  const startingRef = options.startingRef ?? await resolveStartingRef();
  if (options.agentCommand) {
    const tasks = taskSpec.tasks.filter((task) => !options.taskId || task.id === options.taskId);
    if (tasks.length === 0) throw new Error(`Unknown evaluation task: ${options.taskId}`);
    const conditions: EvaluationCondition[] = options.condition ? [options.condition] : ['screenshot', 'trace', 'wbc'];
    const ordered = tasks.flatMap((task) => conditions.map((condition) => ({ task, condition }))).sort((left, right) => {
      const leftHash = createHash('sha256').update(`${seed}:${left.task.id}:${left.condition}`).digest('hex');
      const rightHash = createHash('sha256').update(`${seed}:${right.task.id}:${right.condition}`).digest('hex');
      return leftHash.localeCompare(rightHash);
    });
    for (const { task, condition } of ordered) {
      for (let repetition = 1; repetition <= repetitions; repetition += 1) {
        let workspace: string | undefined;
        let bundleSha256 = '';
        try {
          const bundle = await buildConditionWorkspace(packageRoot, contract, task, condition, evidenceByteBudget);
          workspace = bundle.root;
          bundleSha256 = bundle.bundleSha256;
          const prompt = [`WBC evaluation task ${task.id}.`, `Condition: ${condition}.`, 'Work only in the provided workspace and use only .wbc/evidence for observation.', 'Do not search for, open, or recreate raw event logs, credentials, cookies, headers, or response bodies.', `Evidence byte budget: ${evidenceByteBudget}.`, 'Implement the requested behavior in app/ and leave the workspace ready for the held-out verifier.', 'Return a concise final summary without copying evidence contents into the response.'].join('\n');
          const run = await runAgentCommand({ command: options.agentCommand, cwd: workspace, prompt, timeoutMs });
          const verifier = run.status === 'completed' ? await verifyAgentWorkspace(resolve(packageRoot, 'behavior-contract.json'), workspace, task) : { status: 'not_run' as const, passed: null, failed: null, error: `agent_${run.status}` };
          agentRuns.push({ condition, taskId: task.id, repetition, status: run.status, durationMs: run.durationMs, inputTokens: run.inputTokens, outputTokens: run.outputTokens, evidenceBytes: bundle.evidenceBytes, bundleSha256, verifierStatus: verifier.status, verifierPassed: verifier.passed, verifierFailed: verifier.failed, ...(verifier.error ? { errorProvenance: verifier.error } : {}) });
        } catch (error) {
          agentRuns.push({ condition, taskId: task.id, repetition, status: 'failed', durationMs: 0, inputTokens: null, outputTokens: null, evidenceBytes: 0, bundleSha256, verifierStatus: 'not_run', verifierPassed: null, verifierFailed: null, errorProvenance: error instanceof Error ? error.message : String(error) });
        } finally {
          if (workspace) await rm(workspace, { recursive: true, force: true });
        }
      }
    }
  }
  const summaryFor = (condition: EvaluationCondition): ConditionSummary => {
    if (!options.agentCommand) return { status: 'unavailable', agentSuccess: 'not_measured', reason: 'No agent command configured.' };
    const runs = agentRuns.filter((run) => run.condition === condition);
    if (runs.length === 0) return { status: 'unavailable', agentSuccess: 'not_measured', reason: `Condition ${condition} was not selected for this run.` };
    const success = runs.filter((run) => run.status === 'completed' && run.verifierStatus === 'passed').length;
    const verifier = runs.filter((run) => run.verifierStatus === 'passed').length;
    return { status: 'measured', agentSuccess: runs.length === 0 ? 'not_measured' : success / runs.length, ...(runs.length > 0 ? { verifierSuccess: verifier / runs.length } : {}) };
  };
  const result: EvaluationReport = {
    schemaVersion: '1.2.0', generatedAt: new Date().toISOString(), packagePath: packageRoot, repetitions,
    conditions: { screenshot: summaryFor('screenshot'), trace: summaryFor('trace'), wbc: { ...summaryFor('wbc'), extractionAccuracy: contract.behaviors.length / 5, behaviorEquivalence: totalChecks === 0 ? 0 : passedChecks / totalChecks, heldOut: ['interruption', 'reverse', 'viewport'] } },
    observerCost: { degradationPercent: contract.manifest.quality.observerCost.degradationPercent, droppedRecords: contract.manifest.quality.droppedRecords, knownLoss: contract.manifest.quality.knownLoss },
    fixtureMatrix: taskSpec.tasks.map((task) => ({ id: task.id, status: task.status, evidence: task.referencePath, note: task.captureRecipeId })),
    limitations: ['Full 12-fixture task-specific verifier coverage is not yet available; unsupported tasks remain explicit and cannot count as success.', 'A/B/C agent success is measured only when an isolated workspace and held-out verifier are available.', 'The report does not persist agent prompt/output text or credentials.'],
    agentHarness: { configured: Boolean(options.agentCommand), commandLabel: options.agentCommand ? 'configured process command' : null, model, reasoning, seed, timeoutMs, evidenceByteBudget, startingRef, runs: agentRuns, note: options.agentCommand ? 'Runs use isolated starter workspaces and condition-specific evidence bundles; verifier success is separate from process completion.' : 'No agent command configured; A/B/C agent success remains unavailable.' },
  };
  await mkdir(dirname(resolve(outputFile)), { recursive: true });
  await writeFile(resolve(outputFile), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return result;
}
