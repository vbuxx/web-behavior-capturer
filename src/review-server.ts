import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { reviewRoot } from './paths.js';
import { inspectSessionPackage, querySessionBehaviors, querySessionRecords, type SessionRecordQuery } from './session-index.js';
import type { BehaviorKind } from './types.js';

const behaviorKinds: BehaviorKind[] = ['hover', 'css_animation', 'interrupted_transition', 'scroll_reveal', 'gsap_scrub'];
const assets = new Map([
  ['/', 'index.html'],
  ['/review.css', 'review.css'],
  ['/review.js', 'review.js'],
]);

export interface ReviewServer {
  url: string;
  close(): Promise<void>;
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

function optionalNumber(url: URL, key: string): number | undefined {
  const value = url.searchParams.get(key);
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${key} must be a finite number`);
  return parsed;
}

export async function startReviewServer(packageDirectory: string, port = 0): Promise<ReviewServer> {
  const packageRoot = resolve(packageDirectory);
  await inspectSessionPackage(packageRoot);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error('Review port must be an integer from 0 to 65535');

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method !== 'GET') {
        writeJson(response, 405, { error: 'method_not_allowed' });
        return;
      }
      if (url.pathname === '/api/session') {
        writeJson(response, 200, await inspectSessionPackage(packageRoot));
        return;
      }
      if (url.pathname === '/api/behaviors') {
        const kind = url.searchParams.get('kind');
        if (kind && !behaviorKinds.includes(kind as BehaviorKind)) throw new Error(`Unsupported behavior kind: ${kind}`);
        const limit = optionalNumber(url, 'limit');
        const offset = optionalNumber(url, 'offset');
        const behaviors = await querySessionBehaviors(packageRoot, {
          ...(kind ? { kind: kind as BehaviorKind } : {}),
          ...(limit !== undefined ? { limit } : {}),
          ...(offset !== undefined ? { offset } : {}),
        });
        writeJson(response, 200, { behaviors, count: behaviors.length });
        return;
      }
      if (url.pathname === '/api/evidence') {
        const query: SessionRecordQuery = {};
        for (const [parameter, field] of [
          ['sourceTargetId', 'sourceTargetId'], ['type', 'type'], ['targetRef', 'targetRef'], ['cursor', 'cursor'],
        ] as const) {
          const value = url.searchParams.get(parameter);
          if (value) query[field] = value;
        }
        for (const [parameter, field] of [
          ['fromSourceTime', 'fromSourceTime'], ['toSourceTime', 'toSourceTime'], ['limit', 'limit'], ['byteBudget', 'byteBudget'],
        ] as const) {
          const value = optionalNumber(url, parameter);
          if (value !== undefined) query[field] = value;
        }
        writeJson(response, 200, await querySessionRecords(packageRoot, query));
        return;
      }

      const asset = assets.get(url.pathname);
      if (!asset) {
        writeJson(response, 404, { error: 'not_found' });
        return;
      }
      const contentType = extname(asset) === '.html' ? 'text/html; charset=utf-8'
        : extname(asset) === '.css' ? 'text/css; charset=utf-8'
          : 'text/javascript; charset=utf-8';
      response.writeHead(200, {
        'content-type': contentType,
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
      });
      response.end(await readFile(resolve(reviewRoot, asset)));
    })().catch((error) => writeJson(response, 400, { error: error instanceof Error ? error.message : 'request_failed' }));
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Review server did not expose a TCP port');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())),
  };
}
