import type { IncomingMessage, ServerResponse } from 'node:http';
import type { LiveMsg, LiveSession } from './reader.ts';

/**
 * The local live endpoint, mounted inside the dev server (127.0.0.1 only).
 *
 *   GET  /__live/events    the page's event stream (Server-Sent Events)
 *   POST /__live/hook      from Bytehoven's Claude Code hook (needs the local token)
 *   POST /__live/decision  Approve / Deny from the page (same origin only)
 *
 * Guards: the Host header must be this machine at this port (stops DNS rebinding),
 * the decision endpoint only accepts the page's own origin (stops other websites),
 * and the hook endpoint needs a random token that only this user can read.
 */

export type PageMsg =
  | LiveMsg
  | { type: 'hello'; sessions: LiveSession[]; permissions: Permission[] }
  | ({ type: 'permission' } & Permission)
  | { type: 'permission_end'; id: number; approved?: boolean };

export interface Permission {
  id: number;
  session: string;
  agent?: string;
  tool: string;
  target?: string;
}

interface Waiting {
  permission: Permission;
  res: ServerResponse;
  timer: NodeJS.Timeout;
}

const MAX_BODY = 4096;

const short = (v: unknown, n = 80) => (typeof v === 'string' && v ? v.slice(0, n) : undefined);

export class LiveHub {
  port = 0;
  sessions: () => LiveSession[] = () => [];
  private token: string;
  private timeoutMs: number;
  private pages = new Set<ServerResponse>();
  private waiting = new Map<number, Waiting>();
  private nextId = 1;
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
    this.send(msg);
  }

  handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const url = req.url ?? '';
    if (!url.startsWith('/__live/')) return next();
    const host = req.headers.host ?? '';
    if (host !== `127.0.0.1:${this.port}` && host !== `localhost:${this.port}`) return deny(res);
    const origin = req.headers.origin;
    const self = `http://${host}`;

    if (req.method === 'GET' && url === '/__live/events') {
      if (origin && origin !== self) return deny(res);
      return this.openPage(res);
    }
    if (req.method === 'POST' && url === '/__live/decision') {
      if (origin !== self || !isJson(req)) return deny(res);
      return readBody(req, res, (b) => {
        const w = this.waiting.get(Number(b.id));
        if (w) this.answer(w, b.approved === true ? 'allow' : 'deny');
        res.writeHead(204).end();
      });
    }
    if (req.method === 'POST' && url === '/__live/hook') {
      if (req.headers['x-bytehoven-token'] !== this.token || !isJson(req)) return deny(res);
      return readBody(req, res, (b) => this.onHook(b, req, res));
    }
    res.writeHead(404).end();
  }

  private openPage(res: ServerResponse) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    this.pages.add(res);
    res.on('close', () => this.pages.delete(res));
    const permissions = [...this.waiting.values()].map((w) => w.permission);
    write(res, { type: 'hello', sessions: this.sessions(), permissions });
  }

  private onHook(b: Record<string, unknown>, req: IncomingMessage, res: ServerResponse) {
    const session = short(b.session);
    const tool = short(b.tool, 60);
    if (b.event !== 'PermissionRequest' || !session || !tool) return json(res, { decision: null });
    // Nobody is looking at Bytehoven: let Claude Code ask as usual, right away.
    if (this.pages.size === 0) return json(res, { decision: null });
    const permission: Permission = { id: this.nextId++, session, tool, target: short(b.target, 60), agent: short(b.agent) };
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

  private send(msg: PageMsg) {
    for (const p of this.pages) write(p, msg);
  }
}

function write(res: ServerResponse, msg: PageMsg) {
  res.write(`data: ${JSON.stringify(msg)}\n\n`);
}

function json(res: ServerResponse, body: object) {
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
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
