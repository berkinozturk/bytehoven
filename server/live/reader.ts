import fs from 'node:fs';
import path from 'node:path';
import { TranscriptParser, type ParsedEvent } from './parse.ts';

/**
 * Watches running Claude Code sessions, read-only.
 *
 * `<home>/sessions/<pid>.json` lists the running sessions; each one's transcript
 * lives at `<home>/projects/<project>/<sessionId>.jsonl`, and its sub-agents at
 * `<home>/projects/<project>/<sessionId>/subagents/agent-*.jsonl`. Both formats
 * are internal to Claude Code, so every read is defensive.
 *
 * From a session file we keep only its id, its status and the *name of its
 * folder* (the session's title is never read into an event).
 */

export interface LiveSession {
  id: string;
  folder: string;
  status: string;
}

export type LiveMsg =
  | { type: 'session'; session: LiveSession }
  | { type: 'session_end'; id: string }
  | { type: 'event'; session: string; agent?: string; ev: ParsedEvent };

/** A file we read from where we last stopped. */
class Tail {
  file: string;
  offset: number;
  rest = '';
  parser = new TranscriptParser();
  constructor(file: string, fromEnd: boolean) {
    this.file = file;
    this.offset = fromEnd ? sizeOf(file) : 0;
  }
  read(): ParsedEvent[] {
    const size = sizeOf(this.file);
    if (size < this.offset) this.offset = 0; // rewritten
    if (size === this.offset) return [];
    const buf = Buffer.alloc(size - this.offset);
    const fd = fs.openSync(this.file, 'r');
    try {
      fs.readSync(fd, buf, 0, buf.length, this.offset);
    } finally {
      fs.closeSync(fd);
    }
    this.offset = size;
    const lines = (this.rest + buf.toString('utf8')).split('\n');
    this.rest = lines.pop() ?? '';
    return lines.flatMap((l) => (l ? this.parser.feed(l) : []));
  }
}

interface Watched {
  session: LiveSession;
  /** Full project path: used to start a part there, never sent to the page. */
  cwd?: string;
  dir?: string;
  main?: Tail;
  subs: Map<string, { tail: Tail; agent: string }>;
}

function sizeOf(file: string) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function list(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

export class SessionReader {
  private home: string;
  private emit: (m: LiveMsg) => void;
  private watched = new Map<string, Watched>();
  private timer: NodeJS.Timeout | null = null;

  constructor(home: string, emit: (m: LiveMsg) => void) {
    this.home = home;
    this.emit = emit;
  }

  start(everyMs = 700) {
    this.poll();
    this.timer = setInterval(() => this.poll(), everyMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Sessions currently running, for a newly connected page. */
  sessions(): LiveSession[] {
    return [...this.watched.values()].map((w) => w.session);
  }

  cwdOf(id: string): string | undefined {
    return this.watched.get(id)?.cwd;
  }

  poll() {
    const seen = new Set<string>();
    for (const name of list(path.join(this.home, 'sessions'))) {
      if (!name.endsWith('.json')) continue;
      const s = readJson(path.join(this.home, 'sessions', name));
      if (!s || typeof s.sessionId !== 'string') continue;
      const id = s.sessionId;
      seen.add(id);
      const status = typeof s.status === 'string' ? s.status : 'unknown';
      const folder = (typeof s.cwd === 'string' && path.basename(s.cwd)) || 'session';
      const w = this.watched.get(id);
      if (!w) {
        const fresh: Watched = { session: { id, folder, status }, cwd: typeof s.cwd === 'string' ? s.cwd : undefined, subs: new Map() };
        this.watched.set(id, fresh);
        this.emit({ type: 'session', session: { ...fresh.session } });
        this.attach(fresh, true);
      } else if (w.session.status !== status) {
        w.session.status = status;
        this.emit({ type: 'session', session: { ...w.session } });
      }
    }
    for (const [id, w] of this.watched) {
      if (!seen.has(id)) {
        this.watched.delete(id);
        this.emit({ type: 'session_end', id });
        continue;
      }
      if (!w.main) this.attach(w, false);
      this.drain(w);
    }
  }

  /** Find the session's transcript (once). On the first look, skip history. */
  private attach(w: Watched, first: boolean) {
    const projects = path.join(this.home, 'projects');
    for (const proj of list(projects)) {
      const file = path.join(projects, proj, `${w.session.id}.jsonl`);
      if (fs.existsSync(file)) {
        w.dir = path.join(projects, proj, w.session.id);
        w.main = new Tail(file, first);
        this.scanSubs(w, first);
        return;
      }
    }
  }

  private scanSubs(w: Watched, fromEnd: boolean) {
    if (!w.dir) return;
    const dir = path.join(w.dir, 'subagents');
    for (const name of list(dir)) {
      if (!name.endsWith('.jsonl') || w.subs.has(name)) continue;
      const meta = readJson(path.join(dir, name.replace(/\.jsonl$/, '.meta.json')));
      const agent = typeof meta?.toolUseId === 'string' ? meta.toolUseId : name;
      w.subs.set(name, { tail: new Tail(path.join(dir, name), fromEnd), agent });
    }
  }

  private drain(w: Watched) {
    const session = w.session.id;
    for (const ev of w.main?.read() ?? []) this.emit({ type: 'event', session, ev });
    this.scanSubs(w, false);
    for (const { tail, agent } of w.subs.values()) {
      for (const ev of tail.read()) {
        // nested sub-agents are folded into their parent sub-agent
        if (ev.kind === 'subagent_join' || ev.kind === 'subagent_leave') continue;
        this.emit({ type: 'event', session, agent, ev });
      }
    }
  }
}
