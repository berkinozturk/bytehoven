import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LiveMsg, LiveSession } from './reader.ts';

/**
 * The local live endpoint, mounted inside the dev server (127.0.0.1 only).
 *
 *   GET  /__live/events    the page's event stream (Server-Sent Events)
 *   POST /__live/hook      from Bytehoven's Claude Code hook (needs the local token)
 *   POST /__live/decision  Approve / Deny from the page (same origin only)
 *   POST /__live/task      the conductor hands a session a new part (same origin only)
 *   GET  /__live/box-office today's tokens per musician (same origin only)
 *   POST /__live/plan      the conductor asks for a plan first; starts nothing (same origin only)
 *   POST /__live/plan/run  runs a plan the page showed you, part by part (same origin only)
 *
 * Guards:
 *   - the Host header must be this machine at this port (stops DNS rebinding);
 *   - the page's endpoints only accept the page's own origin (stops other websites);
 *   - every endpoint needs the key, a random secret only this user can read
 *     (`~/.bytehoven/key`). The hook sends it as x-bytehoven-token; the page got it
 *     from the link printed in your terminal and sends it as x-bytehoven-key (or
 *     `?k=` for the event stream, which can't set headers). 127.0.0.1 is open to
 *     every account on this machine, and a program can fake an Origin header, so
 *     the key is what keeps other people on a shared machine out.
 */

export type PageMsg =
  | LiveMsg
  | { type: 'hello'; sessions: LiveSession[]; permissions: Permission[]; recent: Recent[] }
  | ({ type: 'permission' } & Permission)
  | { type: 'permission_end'; id: number; approved?: boolean }
  /** A part handed out from the page: `child` is the new run's session id; `role` when it is part of a plan. */
  | { type: 'part'; session: string; child: string; role?: string }
  | { type: 'part_end'; child: string };

export interface Permission {
  id: number;
  session: string;
  /** The session's project folder name, so a session not seen yet can take a chair. */
  folder?: string;
  agent?: string;
  tool: string;
  target?: string;
}

/** A past event, kept so a page that opens late doesn't start empty. `at` is wall-clock ms. */
export type Recent = Extract<LiveMsg, { type: 'event' }> & { at: number };

const RECENT = 20;

interface Waiting {
  permission: Permission;
  res: ServerResponse;
  timer: NodeJS.Timeout;
}

const MAX_BODY = 16_384; // a 4000-character task in any script, plus JSON

const short = (v: unknown, n = 80) => (typeof v === 'string' && v ? v.slice(0, n) : undefined);

export class LiveHub {
  port = 0;
  sessions: () => LiveSession[] = () => [];
  /** Starts a part for a session; set by the plugin. */
  onTask: ((session: string, task: string) => { id: string } | { error: string }) | null = null;
  /** Planning first; set by the plugin. */
  onPlan: ((session: string, task: string) => Promise<object>) | null = null;
  onPlanRun: ((session: string, parts: unknown) => { ok: true } | { error: string }) | null = null;
  /** Today's tokens per musician; set by the plugin. */
  takings: (() => object) | null = null;
  private token: string;
  private timeoutMs: number;
  private pages = new Set<ServerResponse>();
  private waiting = new Map<number, Waiting>();
  private nextId = 1;
  private recent: Recent[] = [];
  private heartbeat: NodeJS.Timeout;

  constructor(opts: { token: string; decisionTimeoutMs?: number }) {
    this.token = opts.token;
    this.timeoutMs = opts.decisionTimeoutMs ?? 50_000;
    this.heartbeat = setInterval(() => {
      for (const p of this.pages) p.write(': ping\n\n');
    }, 15_000);
    this.heartbeat.unref();
  }

  close() {
    clearInterval(this.heartbeat);
    for (const w of this.waiting.values()) this.answer(w, null);
    for (const p of this.pages) p.end();
    this.pages.clear();
  }

  /** From the session reader. */
  publish(msg: LiveMsg) {
    if (msg.type === 'event') {
      this.recent.push({ ...msg, at: Date.now() });
      if (this.recent.length > RECENT) this.recent.shift();
    }
    this.send(msg);
  }

  handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const full = req.url ?? '';
    if (!full.startsWith('/__live/')) return next();
    const host = req.headers.host ?? '';
    if (host !== `127.0.0.1:${this.port}` && host !== `localhost:${this.port}`) return deny(res);
    const origin = req.headers.origin;
    const self = `http://${host}`;
    const [url, query = ''] = full.split('?', 2);
    if (url !== '/__live/hook') {
      const key = req.headers['x-bytehoven-key'] ?? new URLSearchParams(query).get('k') ?? '';
      if (!same(String(key), this.token)) return deny(res);
    }

    if (req.method === 'GET' && url === '/__live/events') {
      if (origin && origin !== self) return deny(res);
      return this.openPage(res);
    }
    if (req.method === 'GET' && url === '/__live/box-office') {
      if ((origin && origin !== self) || !this.takings) return deny(res);
      return json(res, this.takings());
    }
    if (req.method === 'POST' && url === '/__live/decision') {
      if (origin !== self || !isJson(req)) return deny(res);
      return readBody(req, res, (b) => {
        const w = this.waiting.get(Number(b.id));
        if (w) this.answer(w, b.approved === true ? 'allow' : 'deny');
        res.writeHead(204).end();
      });
    }
    if (req.method === 'POST' && url === '/__live/task') {
      if (origin !== self || !isJson(req) || !this.onTask) return deny(res);
      return readBody(req, res, (b) => {
        const session = short(b.session);
        if (!session || typeof b.task !== 'string') return void res.writeHead(400).end();
        const r = this.onTask!(session, b.task);
        if ('id' in r) this.send({ type: 'part', session, child: r.id });
        res.writeHead('id' in r ? 202 : r.error === 'busy' ? 409 : 400, { 'content-type': 'application/json' }).end(JSON.stringify(r));
      });
    }
    if (req.method === 'POST' && url === '/__live/plan') {
      if (origin !== self || !isJson(req) || !this.onPlan) return deny(res);
      return readBody(req, res, async (b) => {
        const session = short(b.session);
        if (!session || typeof b.task !== 'string') return void res.writeHead(400).end();
        const r = await this.onPlan!(session, b.task);
        res.writeHead('parts' in r ? 200 : 400, { 'content-type': 'application/json' }).end(JSON.stringify(r));
      });
    }
    if (req.method === 'POST' && url === '/__live/plan/run') {
      if (origin !== self || !isJson(req) || !this.onPlanRun) return deny(res);
      return readBody(req, res, (b) => {
        const session = short(b.session);
        if (!session) return void res.writeHead(400).end();
        const r = this.onPlanRun!(session, b.parts);
        res.writeHead('ok' in r ? 202 : 'error' in r && r.error === 'busy' ? 409 : 400, { 'content-type': 'application/json' }).end(JSON.stringify(r));
      });
    }
    if (req.method === 'POST' && url === '/__live/hook') {
      if (!same(String(req.headers['x-bytehoven-token'] ?? ''), this.token) || !isJson(req)) return deny(res);
      return readBody(req, res, (b) => this.onHook(b, req, res));
    }
    res.writeHead(404).end();
  }

  private openPage(res: ServerResponse) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    this.pages.add(res);
    res.on('close', () => this.pages.delete(res));
    const permissions = [...this.waiting.values()].map((w) => w.permission);
    write(res, { type: 'hello', sessions: this.sessions(), permissions, recent: this.recent });
  }

  private onHook(b: Record<string, unknown>, req: IncomingMessage, res: ServerResponse) {
    const session = short(b.session);
    const tool = short(b.tool, 60);
    if (b.event !== 'PermissionRequest' || !session || !tool) return json(res, { decision: null });
    // Nobody is looking at Bytehoven: let Claude Code ask as usual, right away.
    if (this.pages.size === 0) return json(res, { decision: null });
    const permission: Permission = { id: this.nextId++, session, folder: short(b.folder, 60), tool, target: short(b.target, 60), agent: short(b.agent) };
    const timer = setTimeout(() => this.answer(w, null), this.timeoutMs);
    const w: Waiting = { permission, res, timer };
    this.waiting.set(permission.id, w);
    // If Claude Code gives up on the hook (answered in its own dialog), the fermata ends too.
    req.socket.once('close', () => this.waiting.has(permission.id) && this.answer(w, null));
    this.send({ type: 'permission', ...permission });
  }

  private answer(w: Waiting, decision: 'allow' | 'deny' | null) {
    if (!this.waiting.delete(w.permission.id)) return;
    clearTimeout(w.timer);
    if (!w.res.writableEnded) json(w.res, { decision });
    this.send({ type: 'permission_end', id: w.permission.id, approved: decision === null ? undefined : decision === 'allow' });
  }

  /** Tell every open page (e.g. a part has ended). */
  send(msg: PageMsg) {
    for (const p of this.pages) write(p, msg);
  }
}

function write(res: ServerResponse, msg: PageMsg) {
  res.write(`data: ${JSON.stringify(msg)}\n\n`);
}

function json(res: ServerResponse, body: object) {
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

/** Compare secrets in constant time. */
function same(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function deny(res: ServerResponse) {
  res.writeHead(403).end();
}

const isJson = (req: IncomingMessage) => (req.headers['content-type'] ?? '').startsWith('application/json');

function readBody(req: IncomingMessage, res: ServerResponse, done: (b: Record<string, unknown>) => void) {
  let size = 0;
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => {
    size += c.length;
    if (size > MAX_BODY) {
      res.writeHead(413).end();
      req.destroy();
    } else chunks.push(c);
  });
  req.on('end', () => {
    if (res.writableEnded) return;
    try {
      const b = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      done(b && typeof b === 'object' ? b : {});
    } catch {
      res.writeHead(400).end();
    }
  });
}
