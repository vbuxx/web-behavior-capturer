import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectSessionPackage } from './session-index.js';

export interface CrashInjectionResult {
  killAfterMs: number;
  childExitSignal: string | null;
  childExitCode: number | null;
  partialOutputExists: boolean;
  partialFileCount: number;
  rejectedByIntegrity: boolean;
  rejectionMessage: string;
}

async function fileCount(directory: string): Promise<number> {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    count += entry.isDirectory() ? await fileCount(join(directory, entry.name)) : 1;
  }
  return count;
}

export async function runCrashInjection(killAfterMs = 1_000): Promise<CrashInjectionResult> {
  if (!Number.isInteger(killAfterMs) || killAfterMs < 100 || killAfterMs > 30_000) {
    throw new Error('Crash injection delay must be 100 to 30000 ms');
  }
  const outputDirectory = await mkdtemp('/tmp/wbc-crash-injection-');
  const cliPath = fileURLToPath(new URL('./cli.ts', import.meta.url));
  const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
  const child = spawn(process.execPath, ['--import', 'tsx/esm', cliPath, 'capture', '--out', outputDirectory, '--overhead-runs', '1'], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
  let killed = false;
  const kill = (): void => {
    if (killed) return;
    killed = true;
    child.kill('SIGKILL');
  };
  const timer = setTimeout(kill, killAfterMs);
  const partialPoll = setInterval(async () => {
    if (killed) return;
    try {
      if (await fileCount(outputDirectory) > 0) kill();
    } catch {
      // The child may have exited while the temporary directory is being cleaned up.
    }
  }, 50);
  const result = await exit;
  clearTimeout(timer);
  clearInterval(partialPoll);
  let rejectedByIntegrity = false;
  let rejectionMessage = 'No integrity rejection observed';
  try {
    await inspectSessionPackage(outputDirectory);
  } catch (error) {
    rejectedByIntegrity = true;
    rejectionMessage = error instanceof Error ? error.message : String(error);
  }
  const partialFileCount = await fileCount(outputDirectory);
  const partialOutputExists = (await stat(outputDirectory)).isDirectory() && partialFileCount > 0;
  await rm(outputDirectory, { recursive: true, force: true });
  return {
    killAfterMs,
    childExitSignal: result.signal,
    childExitCode: result.code,
    partialOutputExists,
    partialFileCount,
    rejectedByIntegrity,
    rejectionMessage,
  };
}
