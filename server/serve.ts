import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { startLive } from './live/start.ts';

/**
 * The server behind `npx bytehoven`: the built page (dist/) plus live mode, on
 * the loopback interface only. No dependencies, no directory listings, nothing
 * outside `root` is ever served.
 */

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export function serve(o: { root: string; port: number; live: ReturnType<typeof startLive> }): http.Server {
  const root = path.resolve(o.root);
  const server = http.createServer((req, res) => {
    // only this machine, by name: stops DNS rebinding for the page too
    const port = (server.address() as { port: number } | null)?.port;
    const host = req.headers.host ?? '';
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return void res.writeHead(403).end();
    o.live.handle(req, res, () => file(root, req, res));
  });
  server.listen(o.port, '127.0.0.1');
  server.on('close', () => o.live.close());
  return server;
}

function file(root: string, req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405).end();
  let rel: string;
  try {
    rel = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  } catch {
    return void res.writeHead(400).end();
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const full = path.resolve(root, '.' + rel);
  if (full !== root && !full.startsWith(root + path.sep)) return void res.writeHead(403).end();
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) return void res.writeHead(404).end();
    res.writeHead(200, {
      'content-type': TYPES[path.extname(full).toLowerCase()] ?? 'application/octet-stream',
      'content-length': st.size,
      'cache-control': rel === '/index.html' ? 'no-cache' : 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    });
    if (req.method === 'HEAD') return void res.end();
    fs.createReadStream(full).pipe(res);
  });
}
