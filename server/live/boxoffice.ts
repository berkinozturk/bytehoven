import fs from 'node:fs';
import path from 'node:path';
import { chairFor, type ChairId } from '../../src/core/route.ts';
import { TranscriptParser } from './parse.ts';

/**
 * The box office: today's tokens per musician, from the same transcripts the
 * live reader follows (read only).
 *
 * Privacy: besides what the parser keeps (tool name, file base name, command
 * verb), this reads only a message's id, its time and its four token counts.
 *
 * Claude Code writes one line per content block, and every line of a message
 * repeats that message's usage, so tokens are counted once per message id. A
 * message goes to the musician of its first tool call; a message without one
 * (an answer, thinking) stays with whoever that transcript played last.
 * Cache reads are kept apart: they are context read again, not new work.
 */

export interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface Takings {
  /** Local date, YYYY-MM-DD. */
  date: string;
  messages: number;
  total: Tokens;
  chairs: Partial<Record<ChairId, Tokens>>;
}

interface Msg {
  chair: ChairId;
  routed: boolean;
  tokens: Tokens;
}

interface FileState {
  offset: number;
  rest: string;
  parser: TranscriptParser;
  last: ChairId | null;
}

const zero = (): Tokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export class BoxOffice {
  private home: string;
  private now: () => Date;
  private date = '';
  private files = new Map<string, FileState>();
  private msgs = new Map<string, Msg>();

  constructor(home: string, now: () => Date = () => new Date()) {
    this.home = home;
    this.now = now;
  }

  /** Read whatever was added since the last call, and add it up. */
  today(): Takings {
    const now = this.now();
    if (day(now) !== this.date) {
      this.date = day(now);
      this.files.clear();
      this.msgs.clear();
    }
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    for (const file of this.transcripts(midnight)) this.read(file, midnight);

    const total = zero();
    const chairs: Takings['chairs'] = {};
    for (const m of this.msgs.values()) {
      const c = (chairs[m.chair] ??= zero());
      for (const k of Object.keys(total) as Array<keyof Tokens>) {
        c[k] += m.tokens[k];
        total[k] += m.tokens[k];
      }
    }
    return { date: this.date, messages: this.msgs.size, total, chairs };
  }

  /** Main transcripts and sub-agent transcripts changed since midnight. */
  private transcripts(since: number): string[] {
    const out: string[] = [];
    const projects = path.join(this.home, 'projects');
    for (const proj of list(projects)) {
      const dir = path.join(projects, proj);
      for (const name of list(dir)) {
        const p = path.join(dir, name);
        if (name.endsWith('.jsonl')) {
          if (mtime(p) >= since) out.push(p);
        } else {
          const subs = path.join(p, 'subagents');
          for (const s of list(subs)) if (s.endsWith('.jsonl') && mtime(path.join(subs, s)) >= since) out.push(path.join(subs, s));
        }
      }
    }
    return out;
  }

  private read(file: string, midnight: number) {
    let st = this.files.get(file);
    if (!st) this.files.set(file, (st = { offset: 0, rest: '', parser: new TranscriptParser(), last: null }));
    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      return;
    }
    if (size < st.offset) Object.assign(st, { offset: 0, rest: '', parser: new TranscriptParser() }); // rewritten
    if (size === st.offset) return;
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(size - st.offset);
      fs.readSync(fd, buf, 0, buf.length, st.offset);
      st.offset = size;
      const lines = (st.rest + buf.toString('utf8')).split('\n');
      st.rest = lines.pop() ?? '';
      for (const line of lines) this.line(st, line, midnight);
    } finally {
      fs.closeSync(fd);
    }
  }

  private line(st: FileState, line: string, midnight: number) {
    const events = st.parser.feed(line); // every line, so the parser keeps track of tool calls
    if (!line.includes('"usage"')) return;
    let o: { type?: unknown; timestamp?: unknown; message?: { id?: unknown; usage?: Record<string, unknown> } };
    try {
      o = JSON.parse(line);
    } catch {
      return;
    }
    const id = o.message?.id;
    const u = o.message?.usage;
    if (o.type !== 'assistant' || typeof id !== 'string' || !u) return;
    const at = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN;
    const routed = events.map((e) => chairFor(e, null)).find((c): c is ChairId => c !== null) ?? null;
    if (routed) st.last = routed;
    if (!(at >= midnight)) return;
    let m = this.msgs.get(id);
    if (!m) this.msgs.set(id, (m = { chair: routed ?? st.last ?? 'clara', routed: !!routed, tokens: zero() }));
    else if (routed && !m.routed) Object.assign(m, { chair: routed, routed: true });
    // the same usage repeats on every line of a message: keep the largest seen
    const t = m.tokens;
    t.input = Math.max(t.input, num(u.input_tokens));
    t.output = Math.max(t.output, num(u.output_tokens));
    t.cacheRead = Math.max(t.cacheRead, num(u.cache_read_input_tokens));
    t.cacheWrite = Math.max(t.cacheWrite, num(u.cache_creation_input_tokens));
  }
}

function list(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function mtime(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}
