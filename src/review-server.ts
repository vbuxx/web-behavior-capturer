import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { extname, isAbsolute, resolve, sep } from 'node:path';
import { reviewRoot } from './paths.js';
import { inspectSessionPackage, querySessionBehaviors, querySessionRecords, type SessionRecordQuery } from './session-index.js';
import { validateContract, validateSessionIndexManifest } from './validate.js';
import type { BehaviorKind, ContractPackage } from './types.js';
import { validateEvidenceGraph } from './evidence-graph-validate.js';
import type { EvidenceGraph } from './evidence-graph.js';
import { readRevisionIndex, validateRevision } from './revisions.js';
import { createAnnotationRevision } from './annotation-revision.js';
import { SessionService } from './session-service.js';

const behaviorKinds: BehaviorKind[] = ['hover', 'css_animation', 'interrupted_transition', 'scroll_reveal', 'gsap_scrub'];
const assets = new Map([
  ['/', 'index.html'],
  ['/review.css', 'review.css'],
  ['/review.js', 'review.js'],
]);

export interface ReviewServer {
  url: string;
  authToken: string;
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

function hasSessionCookie(request: IncomingMessage, token: string): boolean {
  const cookie = request.headers.cookie ?? '';
  return cookie.split(';').some((part) => part.trim() === `wbc_session=${token}`);
}

async function readBody(request: IncomingMessage, maxBytes = 32_768): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > maxBytes) throw new Error('Request body exceeds limit');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function optionalNumber(url: URL, key: string): number | undefined {
  const value = url.searchParams.get(key);
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${key} must be a finite number`);
  return parsed;
}

function resolveInside(packageRoot: string, relativePath: string): string {
  if (isAbsolute(relativePath)) throw new Error('Evidence path must be relative');
  const resolved = resolve(packageRoot, relativePath);
  if (resolved !== packageRoot && !resolved.startsWith(`${packageRoot}${sep}`)) {
    throw new Error('Evidence path escapes the session package');
  }
  return resolved;
}

async function loadVerifiedContract(packageRoot: string): Promise<ContractPackage> {
  await inspectSessionPackage(packageRoot);
  const manifest = await validateSessionIndexManifest(JSON.parse(await readFile(resolve(packageRoot, 'session-index.json'), 'utf8')));
  const contractPath = resolveInside(packageRoot, manifest.contract.path);
  return validateContract(JSON.parse(await readFile(contractPath, 'utf8')));
}

async function loadSelectedContract(packageRoot: string, revisionId: string | null): Promise<ContractPackage> {
  if (!revisionId) return loadVerifiedContract(packageRoot);
  const base = await loadVerifiedContract(packageRoot);
  const revisions = await readRevisionIndex(packageRoot, base.manifest.sessionId);
  const entry = revisions.revisions.find((candidate) => candidate.revisionId === revisionId);
  if (!entry) throw new Error(`Unknown revision: ${revisionId}`);
  return (await validateRevision(packageRoot, entry)).contract;
}

export async function startReviewServer(packageDirectory: string, port = 0): Promise<ReviewServer> {
  const packageRoot = resolve(packageDirectory);
  await inspectSessionPackage(packageRoot);
  const authToken = randomBytes(32).toString('base64url');
  const service = new SessionService({ workspaceRoot: packageRoot, jobStorePath: resolve(packageRoot, '.wbc/review-jobs.sqlite') });
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error('Review port must be an integer from 0 to 65535');

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const isApi = url.pathname.startsWith('/api/');
      if (isApi && !hasSessionCookie(request, authToken)) {
        writeJson(response, 401, { error: 'session_auth_required' });
        return;
      }
      if (request.method !== 'GET' && url.pathname !== '/api/annotations' && url.pathname !== '/api/probe') {
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
        const revisionId = url.searchParams.get('revisionId');
        const selectedContract = await loadSelectedContract(packageRoot, revisionId);
        const behaviors = revisionId
          ? selectedContract.behaviors.filter((behavior) => !kind || behavior.kind === kind).slice(Number(url.searchParams.get('offset') ?? 0), Number(url.searchParams.get('offset') ?? 0) + Number(url.searchParams.get('limit') ?? 100)).map(({ behaviorId, kind: behaviorKind, targetRef }) => ({ behaviorId, kind: behaviorKind, targetRef }))
          : await querySessionBehaviors(packageRoot, {
          ...(kind ? { kind: kind as BehaviorKind } : {}),
          ...(limit !== undefined ? { limit } : {}),
          ...(offset !== undefined ? { offset } : {}),
        });
        writeJson(response, 200, { behaviors, count: behaviors.length });
        return;
      }
      if (url.pathname.startsWith('/api/behavior/')) {
        const behaviorId = decodeURIComponent(url.pathname.slice('/api/behavior/'.length));
        const contract = await loadSelectedContract(packageRoot, url.searchParams.get('revisionId'));
        const behavior = contract.behaviors.find((candidate) => candidate.behaviorId === behaviorId);
        if (!behavior) {
          writeJson(response, 404, { error: 'behavior_not_found' });
          return;
        }
        writeJson(response, 200, behavior);
        return;
      }
      if (url.pathname === '/api/revisions') {
        const session = await loadVerifiedContract(packageRoot);
        const revisions = await readRevisionIndex(packageRoot, session.manifest.sessionId);
        for (const revision of revisions.revisions) await validateRevision(packageRoot, revision);
        writeJson(response, 200, revisions);
        return;
      }
      if (url.pathname === '/api/evidence') {
        const query: SessionRecordQuery = {};
        const revisionId = url.searchParams.get('revisionId');
        if (revisionId) {
          await loadSelectedContract(packageRoot, revisionId);
          query.revisionId = revisionId;
        }
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
      if (url.pathname === '/api/timeline') {
        const query: SessionRecordQuery = { limit: Math.min(optionalNumber(url, 'limit') ?? 100, 100), byteBudget: Math.min(optionalNumber(url, 'byteBudget') ?? 65_536, 65_536) };
        const mode = url.searchParams.get('mode') ?? 'time';
        if (mode !== 'time' && mode !== 'scroll') throw new Error('Timeline mode must be time or scroll');
        const revisionId = url.searchParams.get('revisionId');
        if (revisionId) { await loadSelectedContract(packageRoot, revisionId); query.revisionId = revisionId; }
        const page = await querySessionRecords(packageRoot, query);
        writeJson(response, 200, { mode, points: page.records.map((record) => ({ time: record.sourceTime, progress: typeof record.payload.containerProgress === 'number' ? record.payload.containerProgress : typeof record.payload.progress === 'number' ? record.payload.progress : null, type: record.type, targetRef: record.targetRef, source: record.source })), revision: page.revision, nextCursor: page.nextCursor });
        return;
      }
      if (url.pathname === '/api/verification') {
        const readReport = async (name: string): Promise<unknown | null> => {
          try { return JSON.parse(await readFile(resolve(packageRoot, name), 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
        };
        writeJson(response, 200, { reference: await readReport('verification-reference.json'), replica: await readReport('verification-replica.json') });
        return;
      }
      if (url.pathname === '/api/probe' && request.method === 'POST') {
        const body = request.headers['content-length'] || request.headers['transfer-encoding'] ? JSON.parse(await readBody(request)) as Record<string, unknown> : {};
        const job = await service.runProbe('.', {
          ...(typeof body.baseRevisionId === 'string' ? { baseRevisionId: body.baseRevisionId } : {}),
          ...(typeof body.resetRecipeId === 'string' ? { resetRecipeId: body.resetRecipeId } : {}),
          ...(typeof body.maxRuns === 'number' ? { maxRuns: body.maxRuns } : {}),
          ...(typeof body.timeoutMs === 'number' ? { timeoutMs: body.timeoutMs } : {}),
          ...(typeof body.controlRun === 'boolean' ? { controlRun: body.controlRun } : {}),
        });
        writeJson(response, 202, job);
        return;
      }
      if (url.pathname.startsWith('/api/probe/')) {
        writeJson(response, 200, await service.status(decodeURIComponent(url.pathname.slice('/api/probe/'.length))));
        return;
      }
      if (url.pathname === '/api/visuals') {
        const contract = await loadSelectedContract(packageRoot, url.searchParams.get('revisionId'));
        const visuals = contract.evidenceIndex
          .filter((entry) => entry.mediaType === 'image/png')
          .map(({ id, path, mediaType, sha256 }) => ({ id, path, mediaType, sha256 }));
        writeJson(response, 200, { visuals, count: visuals.length });
        return;
      }
      if (url.pathname === '/api/graph') {
        const manifest = await validateSessionIndexManifest(JSON.parse(await readFile(resolve(packageRoot, 'session-index.json'), 'utf8')));
        const revisionId = url.searchParams.get('revisionId');
        if (revisionId) {
          const base = await loadVerifiedContract(packageRoot);
          const revisions = await readRevisionIndex(packageRoot, base.manifest.sessionId);
          const entry = revisions.revisions.find((candidate) => candidate.revisionId === revisionId);
          if (!entry) throw new Error(`Unknown revision: ${revisionId}`);
          writeJson(response, 200, (await validateRevision(packageRoot, entry)).graph);
          return;
        }
        if (!manifest.evidenceGraph) {
          writeJson(response, 404, { error: 'graph_not_available' });
          return;
        }
        const graphPath = resolveInside(packageRoot, manifest.evidenceGraph.path);
        const graph = await validateEvidenceGraph(JSON.parse(await readFile(graphPath, 'utf8')));
        writeJson(response, 200, graph);
        return;
      }
      if (url.pathname === '/api/annotations') {
        const annotationPath = resolve(packageRoot, 'annotations.jsonl');
        if (request.method === 'GET') {
          let text = '';
          try { text = await readFile(annotationPath, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
          const annotations = text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
          writeJson(response, 200, { annotations, count: annotations.length });
          return;
        }
        const body = JSON.parse(await readBody(request)) as Record<string, unknown>;
        if (typeof body.note !== 'string' || body.note.trim().length === 0 || body.note.length > 2_000) throw new Error('Annotation note must be 1-2000 characters');
        const manifest = await validateSessionIndexManifest(JSON.parse(await readFile(resolve(packageRoot, 'session-index.json'), 'utf8')));
        const rawCorrection = typeof body.edgeCorrection === 'object' && body.edgeCorrection !== null ? body.edgeCorrection as Record<string, unknown> : null;
        const edgeClass = rawCorrection && ['direct', 'experiment_supported', 'correlated', 'unknown'].includes(String(rawCorrection.class)) ? String(rawCorrection.class) as 'direct' | 'experiment_supported' | 'correlated' | 'unknown' : undefined;
        const edgeCorrection = rawCorrection && typeof rawCorrection.edgeId === 'string' && rawCorrection.edgeId.length > 0
          ? { edgeId: rawCorrection.edgeId, ...(edgeClass ? { class: edgeClass } : {}), ...(typeof rawCorrection.limitation === 'string' && rawCorrection.limitation.length <= 2_000 ? { limitation: rawCorrection.limitation } : {}) }
          : undefined;
        const annotation = {
          annotationId: randomUUID(),
          createdAt: new Date().toISOString(),
          baseRevision: manifest.evidenceGraph ? manifest.evidenceGraph.sha256 : manifest.contract.sha256,
          note: body.note,
          ...(typeof body.targetRef === 'string' ? { targetRef: body.targetRef } : {}),
          ...(Array.isArray(body.evidenceRefs) ? { evidenceRefs: body.evidenceRefs.filter((ref): ref is string => typeof ref === 'string').slice(0, 50) } : {}),
          ...(edgeCorrection ? { edgeCorrection } : {}),
        };
        await mkdir(packageRoot, { recursive: true });
        await appendFile(annotationPath, `${JSON.stringify(annotation)}\n`, 'utf8');
        const revision = await createAnnotationRevision(packageRoot, annotation);
        writeJson(response, 201, { ...annotation, revisionId: revision.revisionId });
        return;
      }
      if (url.pathname.startsWith('/api/visual/')) {
        const evidenceId = decodeURIComponent(url.pathname.slice('/api/visual/'.length));
        const contract = await loadVerifiedContract(packageRoot);
        const evidence = contract.evidenceIndex.find((entry) => entry.id === evidenceId && entry.mediaType === 'image/png');
        if (!evidence) {
          writeJson(response, 404, { error: 'visual_not_found' });
          return;
        }
        const filePath = resolveInside(packageRoot, evidence.path);
        const bytes = await readFile(filePath);
        const actualHash = createHash('sha256').update(bytes).digest('hex');
        if (actualHash !== evidence.sha256) throw new Error('Visual evidence checksum mismatch');
        response.writeHead(200, {
          'content-type': 'image/png',
          'cache-control': 'no-store',
          'content-security-policy': "default-src 'none'; img-src 'self'",
          'cross-origin-resource-policy': 'same-origin',
          'x-content-type-options': 'nosniff',
          'x-frame-options': 'DENY',
        });
        response.end(bytes);
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
        ...(url.pathname === '/' ? { 'set-cookie': `wbc_session=${authToken}; HttpOnly; SameSite=Strict; Path=/` } : {}),
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
    authToken,
    close: () => new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())),
  };
}
