import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fixtureRoot, loadFixtureRoot, probesRoot, replicaRoot, repoRoot } from './paths.js';

const routes: Record<string, string> = {
  '/': resolve(fixtureRoot, 'index.html'),
  '/reference/': resolve(fixtureRoot, 'index.html'),
  '/fixture.css': resolve(fixtureRoot, 'fixture.css'),
  '/fixture.js': resolve(fixtureRoot, 'fixture.js'),
  '/vendor/gsap.min.js': resolve(repoRoot, 'node_modules/gsap/dist/gsap.min.js'),
  '/vendor/ScrollTrigger.min.js': resolve(repoRoot, 'node_modules/gsap/dist/ScrollTrigger.min.js'),
  '/replica/': resolve(replicaRoot, 'index.html'),
  '/replica.css': resolve(replicaRoot, 'replica.css'),
  '/replica.js': resolve(replicaRoot, 'replica.js'),
  '/probes/': resolve(probesRoot, 'index.html'),
  '/probes.css': resolve(probesRoot, 'probes.css'),
  '/probes.js': resolve(probesRoot, 'probes.js'),
  '/probe-frame/': resolve(probesRoot, 'frame.html'),
  '/probe-frame-nested/': resolve(probesRoot, 'nested-frame.html'),
  '/probe-worker.js': resolve(probesRoot, 'worker.js'),
  '/late-attach/': resolve(probesRoot, 'late-attach.html'),
  '/lifecycle-a/': resolve(probesRoot, 'lifecycle-a.html'),
  '/lifecycle-b/': resolve(probesRoot, 'lifecycle-b.html'),
  '/race-start/': resolve(probesRoot, 'race-start.html'),
  '/race-end/': resolve(probesRoot, 'race-end.html'),
  '/load/': resolve(loadFixtureRoot, 'index.html'),
  '/load.js': resolve(loadFixtureRoot, 'load.js'),
  '/load.css': resolve(loadFixtureRoot, 'load.css'),
};

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

export interface FixtureServer {
  url: string;
  crossOriginUrl: string;
  close(): Promise<void>;
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const crossOriginServer: Server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== '/cross-origin-frame/') {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(await readFile(resolve(probesRoot, 'cross-origin-frame.html')));
  });
  await new Promise<void>((resolveListen, reject) => {
    crossOriginServer.once('error', reject);
    crossOriginServer.listen(0, '127.0.0.1', () => resolveListen());
  });
  const crossAddress = crossOriginServer.address();
  if (!crossAddress || typeof crossAddress === 'string') throw new Error('Cross-origin server did not expose a TCP port');
  const crossOriginUrl = `http://localhost:${crossAddress.port}`;

  const server: Server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/probe-config.json') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      const redactionProbe = url.searchParams.get('redaction') === '1' ? '?access_token=fixture-secret' : '';
      response.end(JSON.stringify({ crossOriginFrameUrl: `${crossOriginUrl}/cross-origin-frame/${redactionProbe}` }));
      return;
    }
    if (url.pathname === '/load-config.json') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ crossOriginFrameUrl: `${crossOriginUrl}/cross-origin-frame/` }));
      return;
    }
    const file = routes[url.pathname];
    if (!file) {
      response.writeHead(404).end('Not found');
      return;
    }

    try {
      response.writeHead(200, {
        'content-type': contentTypes[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      response.end(await readFile(file));
    } catch (error) {
      response.writeHead(500).end(error instanceof Error ? error.message : 'Server error');
    }
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveListen());
  });

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not expose a TCP port');

  return {
    url: `http://127.0.0.1:${address.port}`,
    crossOriginUrl,
    close: () => new Promise<void>((resolveClose, reject) => {
      server.close((error) => {
        if (error) { reject(error); return; }
        crossOriginServer.close((crossError) => crossError ? reject(crossError) : resolveClose());
      });
    }),
  };
}
