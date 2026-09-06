import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectSessionPackage } from './session-index.js';

export interface QuotaBenchmarkResult {
  platform: NodeJS.Platform;
  quotaBlocks: number;
  quotaBytes: number;
  childExitCode: number | null;
  childExitSignal: string | null;
  finalOutputFileCount: number;
  stagingDirectoryCount: number;
  rejectedByIntegrity: boolean;
  rejectionMessage: string;
  stderrTail: string;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
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

export async function benchmarkFileSizeQuota(quotaBlocks = 256): Promise<QuotaBenchmarkResult> {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    throw new Error(`File-size quota benchmark requires macOS or Linux; current platform is ${process.platform}`);
  }
  if (!Number.isInteger(quotaBlocks) || quotaBlocks < 64 || quotaBlocks > 16_384) {
    throw new Error('Quota blocks must be an integer from 64 to 16384');
  }
  const quotaRoot = process.env.WBC_QUOTA_ROOT ? resolve(process.env.WBC_QUOTA_ROOT) : '/tmp';
  await mkdir(quotaRoot, { recursive: true });
  const root = await mkdtemp(join(quotaRoot, 'wbc-quota-benchmark-'));
  const outputDirectory = join(root, 'capture');
  const cliPath = fileURLToPath(new URL('./cli.ts', import.meta.url));
  const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
  const command = `ulimit -f ${quotaBlocks}; exec ${shellQuote(process.execPath)} --import tsx/esm ${shellQuote(cliPath)} capture --out ${shellQuote(outputDirectory)} --overhead-runs 1`;
  const child = spawn('/bin/bash', ['-lc', command], { cwd: repoRoot, stdio: ['ignore', 'ignore', 'pipe'] });
  const stderrChunks: Buffer[] = [];
  child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
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
  // Do not pre-create the destination: capture promotion is an atomic directory
  // rename, and an existing destination would turn a quota failure into a
  // misleading EEXIST path. A failed capture may leave no destination at all.
  let finalOutputFileCount = 0;
  try {
    finalOutputFileCount = await fileCount(outputDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const staging = await stagingDirectories(outputDirectory);
  await rm(root, { recursive: true, force: true });
  return {
    platform: process.platform,
    quotaBlocks,
    quotaBytes: quotaBlocks * 512,
    childExitCode: exit.code,
    childExitSignal: exit.signal,
    finalOutputFileCount,
    stagingDirectoryCount: staging.length,
    rejectedByIntegrity,
    rejectionMessage,
    stderrTail: Buffer.concat(stderrChunks).toString('utf8').slice(-1_000),
  };
}
