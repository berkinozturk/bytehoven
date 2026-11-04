import { basename, commandTarget, isTest, type ParsedEvent } from './parse.ts';

/**
 * Turns Google Gemini CLI chat recordings into Bytehoven events.
 *
 * Gemini CLI appends JSON lines to `~/.gemini/tmp/<project>/chats/session-*.jsonl`:
 * a metadata line first (`sessionId`, …), then message records. A later record
 * with the same message `id` replaces the earlier one; that is how a tool
 * call's status moves on (google-gemini/gemini-cli, chatRecordingService).
 *
 * Same privacy contract as the Claude Code parser: only a tool's name, a file's
 * base name, a command's verb and whether it failed are kept. Prompts, answers,
 * thoughts, file contents and full commands are dropped on the spot.
 * The format is internal to Gemini CLI, so everything here is defensive.
 */

const DONE = new Set(['success', 'error', 'cancelled']);

/** Gemini's tool names, as the tool names the rest of Bytehoven routes on. */
const AS: Record<string, string> = {
  read_file: 'Read',
  read_many_files: 'Read',
  write_file: 'Write',
  replace: 'Edit',
  run_shell_command: 'Bash',
  glob: 'Glob',
  grep_search: 'Grep',
  search_file_content: 'Grep',
  list_directory: 'LS',
  web_fetch: 'WebFetch',
  google_web_search: 'WebSearch',
};

type Call = { id?: unknown; name?: unknown; args?: unknown; status?: unknown; result?: unknown };

export class GeminiParser {
  sessionId: string | null = null;
  /** Tool calls we have shown: id → the event (and whether its end was seen). */
  private calls = new Map<string, { ev: ParsedEvent; ended: boolean }>();
  /** Messages whose thoughts were already played. */
  private thought = new Set<string>();

  feed(line: string): ParsedEvent[] {
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line);
    } catch {
      return [];
    }
    if (!o || typeof o !== 'object') return [];
    if (typeof o.sessionId === 'string' && !('type' in o)) {
      this.sessionId = o.sessionId;
      return [];
    }
    if (o.type !== 'gemini' || typeof o.id !== 'string') return [];
    const out: ParsedEvent[] = [];
    if (Array.isArray(o.thoughts) && o.thoughts.length && !this.thought.has(o.id)) {
      this.thought.add(o.id);
      out.push({ kind: 'thinking' });
    }
    for (const c of Array.isArray(o.toolCalls) ? (o.toolCalls as Call[]) : []) out.push(...this.call(c));
    return out;
  }

  private call(c: Call): ParsedEvent[] {
    if (typeof c?.id !== 'string' || typeof c.name !== 'string') return [];
    const out: ParsedEvent[] = [];
    let seen = this.calls.get(c.id);
    if (!seen) {
      seen = { ev: this.start(c.name, (c.args && typeof c.args === 'object' ? c.args : {}) as Record<string, unknown>), ended: false };
      this.calls.set(c.id, seen);
      out.push(seen.ev);
    }
    if (!seen.ended && typeof c.status === 'string' && DONE.has(c.status)) {
      seen.ended = true;
      const end = this.end(seen.ev, c.status, c.result);
      if (end) out.push(end);
    }
    return out;
  }

  private start(name: string, a: Record<string, unknown>): ParsedEvent {
    const tool = AS[name] ?? name.slice(0, 40);
    if (name === 'read_file') return { kind: 'file_read', tool, target: basename(a.file_path) };
    if (name === 'read_many_files') return { kind: 'file_read', tool };
    if (name === 'write_file' || name === 'replace') return { kind: 'file_write', tool, target: basename(a.file_path) };
    if (name === 'run_shell_command') return { kind: 'bash', tool, target: typeof a.command === 'string' ? commandTarget(a.command) : undefined };
    return { kind: 'tool_start', tool };
  }

  /** How a call ended: a test passes or fails (by its exit code when Gemini reports one), a failed tool is an error. */
  private end(ev: ParsedEvent, status: string, result: unknown): ParsedEvent | null {
    if (status === 'cancelled') return null;
    const code = /Exit Code: (-?\d+)/.exec(typeof result === 'string' ? result : JSON.stringify(result ?? ''));
    const failed = status === 'error' || (!!code && Number(code[1]) !== 0);
    if (ev.kind === 'bash' && isTest(ev.target)) return { kind: failed ? 'test_fail' : 'test_pass', tool: ev.tool, target: ev.target };
    return failed ? { kind: 'error', tool: ev.tool, target: ev.target } : null;
  }
}
