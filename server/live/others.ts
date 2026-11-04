import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CodexParser } from './codex.ts';
import { GeminiParser } from './gemini.ts';
import type { ParsedEvent } from './parse.ts';
import type { LiveMsg, LiveSession } from './reader.ts';

/**
 * Live sessions of other coding agents, read-only: OpenAI Codex CLI and Google
 * Gemini CLI. Neither keeps a list of running sessions, so a transcript that
 * changed in the last few minutes counts as a running session; it is busy
 * while it keeps changing, idle when it goes quiet (or Codex says the turn is
 * done), and ends after ten quiet minutes. Their events play in the same
 * orchestra as Claude Code's; the folder tag says which agent it was.
 */

const ACTIVE_MS = 10 * 60_000;
const BUSY_MS = 15_000;

interface Parser {
  feed(line: string): ParsedEvent[];
}

interface Watched<P extends Parser> {
  file: string;
  parser: P;
  offset: number;
  rest: string;
  session: LiveSession;
  cwd?: string;
  /** Last time the file grew. */
  activeAt: number;
}

abstract class AgentReader<P extends Parser> {
  protected home: string;
  private emit: (m: LiveMsg) => void;
  private now: () => number;
  private watched = new Map<string, Watched<P>>();
  private timer: NodeJS.Timeout | null = null;

  constructor(home: string, emit: (m: LiveMsg) => void, now: () => number = Date.now) {
    this.home = home;
    this.emit = emit;
    this.now = now;
  }

  /** Transcript files that may belong to a running session. */
  protected abstract candidates(): string[];
  protected abstract parser(): P;
  /** The session's id, folder tag and project path, once the first lines are read. */
  protected abstract identify(file: string, p: P): { id: string; folder: string; cwd?: string };
  /** Codex can say a turn is finished; otherwise only quiet counts. */
  protected turnDone(_p: P): boolean {
    return false;
  }

  start(everyMs = 1000) {
    this.poll();
    this.timer = setInterval(() => this.poll(), everyMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  sessions(): LiveSession[] {
    return [...this.watched.values()].map((w) => ({ ...w.session }));
  }

  cwdOf(id: string): string | undefined {
    for (const w of this.watched.values()) if (w.session.id === id) return w.cwd;
    return undefined;
  }

  poll() {
    const now = this.now();
    for (const file of this.candidates()) {
      if (this.watched.has(file)) continue;
      const mtime = mtimeOf(file);
      if (now - mtime > ACTIVE_MS) continue;
      // read what is there already without playing it: the parser learns the session and its open calls
      const parser = this.parser();
      const w: Watched<P> = { file, parser, offset: 0, rest: '', session: { id: '', folder: '', status: 'busy' }, activeAt: mtime };
      this.read(w);
      const who = this.identify(file, parser);
      w.session = { id: who.id, folder: who.folder, status: this.status(w, now) };
      w.cwd = who.cwd;
      this.watched.set(file, w);
      this.emit({ type: 'session', session: { ...w.session } });
    }
    for (const [file, w] of this.watched) {
      if (now - Math.max(w.activeAt, mtimeOf(file)) > ACTIVE_MS) {
        this.watched.delete(file);
        this.emit({ type: 'session_end', id: w.session.id });
        continue;
      }
      for (const ev of this.read(w)) this.emit({ type: 'event', session: w.session.id, ev });
      const status = this.status(w, now);
      if (status !== w.session.status) {
        w.session.status = status;
        this.emit({ type: 'session', session: { ...w.session } });
      }
    }
  }

  private status(w: Watched<P>, now: number) {
    return now - w.activeAt < BUSY_MS && !this.turnDone(w.parser) ? 'busy' : 'idle';
  }

  /** New lines since last time, through the parser. */
  private read(w: Watched<P>): ParsedEvent[] {
    let size: number;
    try {
      size = fs.statSync(w.file).size;
    } catch {
      return [];
    }
    if (size < w.offset) Object.assign(w, { offset: 0, rest: '' }); // rewritten
    if (size === w.offset) return [];
    const buf = Buffer.alloc(size - w.offset);
    const fd = fs.openSync(w.file, 'r');
    try {
      fs.readSync(fd, buf, 0, buf.length, w.offset);
    } finally {
      fs.closeSync(fd);
    }
    if (w.offset > 0) w.activeAt = this.now();
    w.offset = size;
    const lines = (w.rest + buf.toString('utf8')).split('\n');
    w.rest = lines.pop() ?? '';
    return lines.flatMap((l) => (l ? w.parser.feed(l) : []));
  }
}

/** OpenAI Codex CLI: `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl` (today's and yesterday's folders). */
export class CodexReader extends AgentReader<CodexParser> {
  protected candidates() {
    const out: string[] = [];
    for (const back of [0, 1]) {
      const d = new Date(Date.now() - back * 86_400_000);
      const dir = path.join(this.home, 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
      for (const name of list(dir)) if (name.startsWith('rollout-') && name.endsWith('.jsonl')) out.push(path.join(dir, name));
    }
    return out;
  }
  protected parser() {
    return new CodexParser();
  }
  protected identify(file: string, p: CodexParser) {
    const id = p.meta?.id ?? path.basename(file, '.jsonl');
    const cwd = p.meta?.cwd;
    return { id: `codex:${id}`, folder: `${(cwd && path.basename(cwd)) || 'codex'} · codex`, cwd };
  }
  protected turnDone(p: CodexParser) {
    return p.turnDone;
  }
}

/** Google Gemini CLI: `~/.gemini/tmp/<project>/chats/session-*.jsonl`. */
export class GeminiReader extends AgentReader<GeminiParser> {
  protected candidates() {
    const out: string[] = [];
    const tmp = path.join(this.home, 'tmp');
    for (const proj of list(tmp)) {
      const chats = path.join(tmp, proj, 'chats');
      for (const name of list(chats)) if (name.startsWith('session-') && name.endsWith('.jsonl')) out.push(path.join(chats, name));
    }
    return out;
  }
  protected parser() {
    return new GeminiParser();
  }
  protected identify(file: string, p: GeminiParser) {
    const slug = path.basename(path.dirname(path.dirname(file)));
    return { id: `gemini:${p.sessionId ?? path.basename(file, '.jsonl')}`, folder: `${slug} · gemini`, cwd: this.rootOf(slug) };
  }
  /** `projects.json` maps project folders to their slug; the full path stays on the server. */
  private rootOf(slug: string): string | undefined {
    try {
      const projects = JSON.parse(fs.readFileSync(path.join(this.home, 'projects.json'), 'utf8'))?.projects ?? {};
      return Object.keys(projects).find((root) => projects[root] === slug);
    } catch {
      return undefined;
    }
  }
}

/** Where each agent keeps its files, honouring their own environment variables. */
export const codexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
export const geminiHome = () => path.join(process.env.GEMINI_CLI_HOME || os.homedir(), '.gemini');

function list(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function mtimeOf(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}
