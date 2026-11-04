import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { LiveHub } from '../server/live/hub.ts';

const TOKEN = 'test-token';

async function start() {
  const hub = new LiveHub({ token: TOKEN, decisionTimeoutMs: 2000 });
  const server = http.createServer((req, res) => hub.handle(req, res, () => res.writeHead(404).end()));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  hub.port = port;
  const host = `127.0.0.1:${port}`;
  const close = () => new Promise<void>((r) => { hub.close(); server.closeAllConnections(); server.close(() => r()); });
  return { hub, port, host, close };
}

function request(port: number, method: string, p: string, headers: Record<string, string> = {}, body?: object) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/** Open the event stream and collect parsed messages. */
function listen(port: number, host: string) {
  const msgs: Array<Record<string, unknown>> = [];
  let req!: http.ClientRequest;
  const ready = new Promise<void>((resolve) => {
    req = http.get({ host: '127.0.0.1', port, path: '/__live/events', headers: { host } }, (res) => {
      let buf = '';
      res.on('data', (c) => {
        buf += c;
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const p of parts) if (p.startsWith('data: ')) msgs.push(JSON.parse(p.slice(6)));
        resolve();
      });
    });
  });
  const waitFor = async (type: string) => {
    for (let i = 0; i < 100; i++) {
      const m = msgs.find((x) => x.type === type);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`no ${type}`);
  };
  return { msgs, ready, waitFor, close: () => req.destroy() };
}

test('rejects requests for another host name (DNS rebinding)', async () => {
  const s = await start();
  const r = await request(s.port, 'GET', '/__live/events', { host: `evil.example:${s.port}` });
  assert.equal(r.status, 403);
  await s.close();
});

test('the hook endpoint needs the local token', async () => {
  const s = await start();
  const r = await request(s.port, 'POST', '/__live/hook', { host: s.host }, { event: 'PermissionRequest', session: 'x', tool: 'Bash' });
  assert.equal(r.status, 403);
  await s.close();
});

test('with no page open, a permission request returns at once with no decision', async () => {
  const s = await start();
  const r = await request(s.port, 'POST', '/__live/hook', { host: s.host, 'x-bytehoven-token': TOKEN }, { event: 'PermissionRequest', session: 'x', tool: 'Bash', target: 'git' });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { decision: null });
  await s.close();
});

test('another website cannot answer a permission request', async () => {
  const s = await start();
  const r = await request(s.port, 'POST', '/__live/decision', { host: s.host, origin: 'https://evil.example' }, { id: 1, approved: true });
  assert.equal(r.status, 403);
  await s.close();
});

test('approving on the page answers the waiting hook', async () => {
  const s = await start();
  const page = listen(s.port, s.host);
  await page.ready;
  const hook = request(s.port, 'POST', '/__live/hook', { host: s.host, 'x-bytehoven-token': TOKEN }, { event: 'PermissionRequest', session: 'sess-1', folder: 'shop', tool: 'Bash', target: 'git' });
  const ask = await page.waitFor('permission');
  assert.equal(ask.session, 'sess-1');
  assert.equal(ask.folder, 'shop', 'so a session Bytehoven has not seen yet can still take a chair');
  assert.equal(ask.tool, 'Bash');
  const d = await request(s.port, 'POST', '/__live/decision', { host: s.host, origin: `http://${s.host}` }, { id: ask.id, approved: true });
  assert.equal(d.status, 204);
  assert.deepEqual(JSON.parse((await hook).body), { decision: 'allow' });
  const end = await page.waitFor('permission_end');
  assert.equal(end.approved, true);
  page.close();
  await s.close();
});

test('an unanswered request times out with no decision, so Claude Code asks as usual', async () => {
  const s = await start();
  const page = listen(s.port, s.host);
  await page.ready;
  const t0 = Date.now();
  const r = await request(s.port, 'POST', '/__live/hook', { host: s.host, 'x-bytehoven-token': TOKEN }, { event: 'PermissionRequest', session: 's', tool: 'Bash' });
  assert.deepEqual(JSON.parse(r.body), { decision: null });
  assert.ok(Date.now() - t0 >= 1900);
  page.close();
  await s.close();
});

test('another website cannot hand out a task', async () => {
  const s = await start();
  let called = false;
  s.hub.onTask = () => ((called = true), { id: 'x' });
  const r = await request(s.port, 'POST', '/__live/task', { host: s.host, origin: 'https://evil.example' }, { session: 's', task: 'rm -rf' });
  assert.equal(r.status, 403);
  assert.equal(called, false);
  await s.close();
});

test('the page can hand a session a new part', async () => {
  const s = await start();
  const got: string[] = [];
  s.hub.onTask = (session, task) => (got.push(session, task), { id: 'part-1' });
  const r = await request(s.port, 'POST', '/__live/task', { host: s.host, origin: `http://${s.host}` }, { session: 'sess-1', task: 'add a line' });
  assert.equal(r.status, 202);
  assert.deepEqual(JSON.parse(r.body), { id: 'part-1' });
  assert.deepEqual(got, ['sess-1', 'add a line']);
  s.hub.onTask = () => ({ error: 'busy' });
  const busy = await request(s.port, 'POST', '/__live/task', { host: s.host, origin: `http://${s.host}` }, { session: 'sess-1', task: 'again' });
  assert.equal(busy.status, 409);
  await s.close();
});

test('a page that opens late gets the last 20 events with their time, newest last', async () => {
  const s = await start();
  for (let i = 0; i < 25; i++) s.hub.publish({ type: 'event', session: 'abc', ev: { kind: 'file_read', tool: 'Read', target: `f${i}.ts` } });
  s.hub.publish({ type: 'session', session: { id: 'abc', folder: 'fermata', status: 'busy' } });
  const page = listen(s.port, s.host);
  try {
    await page.ready;
    const hello = (await page.waitFor('hello')) as { recent?: Array<{ at: number; session: string; ev: { target: string } }> };
    assert.equal(hello.recent?.length, 20);
    assert.equal(hello.recent[0].ev.target, 'f5.ts');
    assert.equal(hello.recent[19].ev.target, 'f24.ts');
    assert.ok(hello.recent.every((m) => typeof m.at === 'number' && Math.abs(Date.now() - m.at) < 5000));
  } finally {
    page.close();
    await s.close();
  }
});

test("the box office endpoint answers the page with today's takings, and no other site", async () => {
  const s = await start();
  try {
    s.hub.takings = () => ({ date: '2026-11-04', messages: 1, total: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, chairs: {} });
    const ok = await request(s.port, 'GET', '/__live/box-office', { host: s.host });
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(ok.body).total.cacheRead, 3);
    const other = await request(s.port, 'GET', '/__live/box-office', { host: s.host, origin: 'https://evil.example' });
    assert.equal(other.status, 403);
  } finally {
    await s.close();
  }
});

test('a plan is asked for and run only from the page itself', async () => {
  const s = await start();
  try {
    const seen: unknown[] = [];
    s.hub.onPlan = async (session, task) => (seen.push([session, task]), { parts: [{ role: 'code', task: 'do it' }] });
    s.hub.onPlanRun = (session, parts) => (seen.push([session, parts]), { ok: true });
    const self = `http://${s.host}`;
    const plan = await request(s.port, 'POST', '/__live/plan', { host: s.host, origin: self }, { session: 'abc', task: 'make it dark' });
    assert.equal(plan.status, 200);
    assert.deepEqual(JSON.parse(plan.body), { parts: [{ role: 'code', task: 'do it' }] });
    const run = await request(s.port, 'POST', '/__live/plan/run', { host: s.host, origin: self }, { session: 'abc', parts: [{ role: 'code', task: 'do it' }] });
    assert.equal(run.status, 202);
    assert.deepEqual(seen, [['abc', 'make it dark'], ['abc', [{ role: 'code', task: 'do it' }]]]);
    const evil = await request(s.port, 'POST', '/__live/plan', { host: s.host, origin: 'https://evil.example' }, { session: 'abc', task: 'x' });
    assert.equal(evil.status, 403);
  } finally {
    await s.close();
  }
});
