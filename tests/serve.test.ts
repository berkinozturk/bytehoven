import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { serve } from '../server/serve.ts';

function site() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytehoven-site-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>B</title>');
  fs.mkdirSync(path.join(dir, 'samples'));
  fs.writeFileSync(path.join(dir, 'samples', 'manifest.json'), '{"groups":{}}');
  fs.writeFileSync(path.join(os.tmpdir(), 'bytehoven-outside.txt'), 'SECRET');
  return dir;
}

function get(port: number, p: string, host = `127.0.0.1:${port}`) {
  return new Promise<{ status: number; type: string; body: string }>((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: p, headers: { host } }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type']), body }));
      })
      .on('error', reject);
  });
}

test('serves the built page and its files, on 127.0.0.1 only, and nothing outside it', async () => {
  const root = site();
  let liveHits = 0;
  const server = serve({ root, port: 0, live: { key: 'k', handle: (req, res, next) => (req.url?.startsWith('/__live/') ? (liveHits++, res.writeHead(204).end()) : next()), close() {} } });
  await new Promise((r) => server.once('listening', r));
  const { address, port } = server.address() as AddressInfo;
  try {
    assert.equal(address, '127.0.0.1');
    const index = await get(port, '/?live');
    assert.equal(index.status, 200);
    assert.match(index.type, /text\/html/);
    const manifest = await get(port, '/samples/manifest.json');
    assert.equal(manifest.status, 200);
    assert.match(manifest.type, /application\/json/);
    assert.equal((await get(port, '/__live/events')).status, 204);
    assert.equal(liveHits, 1);
    for (const p of ['/../bytehoven-outside.txt', '/%2e%2e/bytehoven-outside.txt', '/samples/../../bytehoven-outside.txt']) {
      const r = await get(port, p);
      assert.notEqual(r.status, 200, p);
      assert.ok(!r.body.includes('SECRET'), p);
    }
    assert.equal((await get(port, '/nope.js')).status, 404);
    assert.equal((await get(port, '/', `evil.example:${port}`)).status, 403);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
