import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

export interface AgentRunOptions {
  command: string;
  cwd: string;
  prompt: string;
  timeoutMs: number;
  environment?: Record<string, string>;
  maxCapturedOutputBytes?: number;
}

export interface AgentRunResult {
  status: 'completed' | 'failed' | 'timeout';
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  stdoutBytes: number;
  stderrBytes: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

function usageFrom(text: string): { inputTokens: number | null; outputTokens: number | null } {
  const input = text.match(/(?:input[_ ]tokens|prompt_tokens)["\s:=]+(\d+)/i)?.[1];
  const output = text.match(/(?:output[_ ]tokens|completion_tokens)["\s:=]+(\d+)/i)?.[1];
  return { inputTokens: input ? Number(input) : null, outputTokens: output ? Number(output) : null };
}

export async function runAgentCommand(options: AgentRunOptions): Promise<AgentRunResult> {
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000) throw new Error('Agent timeout must be at least 1000 ms');
  const maxCapturedOutputBytes = options.maxCapturedOutputBytes ?? 64 * 1024;
  if (!Number.isInteger(maxCapturedOutputBytes) || maxCapturedOutputBytes < 1) throw new Error('maxCapturedOutputBytes must be positive');
  const started = performance.now();
  const child = spawn('/bin/sh', ['-lc', options.command], {
    cwd: options.cwd,
    env: { ...process.env, ...options.environment },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let stdoutBytes = 0;
  let stderrBytes = 0;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdoutBytes += Buffer.byteLength(chunk);
    if (Buffer.byteLength(stdout) < maxCapturedOutputBytes) {
      const remaining = maxCapturedOutputBytes - Buffer.byteLength(stdout);
      stdout += Buffer.from(chunk).subarray(0, remaining).toString('utf8');
    }
  });
  child.stderr.on('data', (chunk: string) => {
    stderrBytes += Buffer.byteLength(chunk);
    if (Buffer.byteLength(stderr) < maxCapturedOutputBytes) {
      const remaining = maxCapturedOutputBytes - Buffer.byteLength(stderr);
      stderr += Buffer.from(chunk).subarray(0, remaining).toString('utf8');
    }
  });
  child.stdin.end(options.prompt);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, options.timeoutMs);
  const result = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }));
  }).finally(() => clearTimeout(timer));
  const usage = usageFrom(`${stdout}\n${stderr}`);
  return {
    status: timedOut ? 'timeout' : result.exitCode === 0 ? 'completed' : 'failed',
    exitCode: result.exitCode,
    signal: result.signal,
    durationMs: Number((performance.now() - started).toFixed(3)),
    stdoutBytes,
    stderrBytes,
    ...usage,
  };
}
