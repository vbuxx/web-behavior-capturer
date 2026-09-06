import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectSessionPackage } from './session-index.js';

export type CaptureFailureStage = 'before-contract' | 'before-index';

export interface FailureInjectionResult {
  stage: CaptureFailureStage;
  childExitCode: number | null;
  childExitSignal: string | null;
  finalOutputFileCount: number;
  stagingDirectoryCount: number;
  stagingFileCount: number;
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

async function stagingDirectories(outputDirectory: string): Promise<string[]> {
  const parent = dirname(outputDirectory);
  const prefix = `${basename(outputDirectory)}.staging-`;
  return (await readdir(parent, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => join(parent, entry.name));
}

export async function runFailureInjection(stages: CaptureFailureStage[] = ['before-contract', 'before-index']): Promise<FailureInjectionResult[]> {
  const outputRoot = await mkdtemp('/tmp/wbc-failure-injection-');
  const cliPath = fileURLToPath(new URL('./cli.ts', import.meta.url));
  const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
  const results: FailureInjectionResult[] = [];
  try {
    for (const stage of stages) {
      const outputDirectory = join(outputRoot, stage);
      await mkdir(outputDirectory, { recursive: true });
      const child = spawn(process.execPath, ['--import', 'tsx/esm', cliPath, 'capture', '--out', outputDirectory, '--overhead-runs', '1'], {
        cwd: repoRoot,
        env: { ...process.env, WBC_CAPTURE_FAILURE_STAGE: stage },
        stdio: 'ignore',
      });
      const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
        child.once('exit', (code, signal) => resolveExit({ code, signal }));
      });
      let rejectedByIntegrity = false;
      let rejectionMessage = 'No integrity rejection observed';
      try {
        await inspectSessionPackage(outputDirectory);
      } catch (error) {
        rejectedByIntegrity = true;
        rejectionMessage = error instanceof Error ? error.message : String(error);
      }
      const finalOutputFileCount = await fileCount(outputDirectory);
      const staging = await stagingDirectories(outputDirectory);
      let stagingFileCount = 0;
      for (const directory of staging) stagingFileCount += await fileCount(directory);
      results.push({
        stage,
        childExitCode: exit.code,
        childExitSignal: exit.signal,
        finalOutputFileCount,
        stagingDirectoryCount: staging.length,
        stagingFileCount,
        rejectedByIntegrity,
        rejectionMessage,
      });
      await rm(outputDirectory, { recursive: true, force: true });
      for (const directory of staging) await rm(directory, { recursive: true, force: true });
    }
    return results;
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
}
