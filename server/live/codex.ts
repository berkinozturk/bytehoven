import { basename, commandTarget, isTest, type ParsedEvent } from './parse.ts';

/**
 * Turns OpenAI Codex CLI rollout lines into Bytehoven events.
 *
 * Codex appends one JSON line per item to
 * `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<time>-<thread id>.jsonl`:
 * `{timestamp, type, payload}`, where `type` is `session_meta`, `response_item`,
 * `event_msg`, `turn_context`, … (openai/codex, codex-rs/protocol).
 *
 * Newer versions run tools from a code cell (`exec`) and also record every
 * finished item as `event_msg` / `item_completed` (CommandExecution with its
 * exit code, FileChange, McpToolCall, …). Once those appear they are the source,
 * and the raw response items are no longer played, so nothing sounds twice.
 *
 * Same privacy contract as the Claude Code parser: only a tool's name, a file's
 * base name, a command's verb and whether it failed are kept. Messages,
 * reasoning, patches, outputs and full commands are dropped on the spot.
 * The format is internal to Codex, so everything here is defensive.
 */

const SHELL = new Set(['exec_command', 'shell', 'shell_command', 'local_shell', 'container.exec']);

type Payload = Record<string, unknown>;

export class CodexParser {
  /** From session_meta: the session id and the full project path (kept on the server only). */
  meta: { id: string; cwd?: string } | null = null;
  /** The last turn finished (task_complete) and nothing has happened since. */
  turnDone = false;
  /** Shell calls waiting for their output: call id → the event we showed. */
  private pending = new Map<string, ParsedEvent>();
  /** This rollout records item_completed: use those, not the raw response items. */
  private finished = false;

  feed(line: string): ParsedEvent[] {
    let o: { type?: unknown; payload?: Payload };
    try {
      o = JSON.parse(line);
    } catch {
      return [];
    }
    const p = o?.payload;
    if (!p || typeof p !== 'object') return [];
    if (o.type === 'session_meta') {
      const id = typeof p.session_id === 'string' ? p.session_id : typeof p.id === 'string' ? p.id : null;
      if (id) this.meta = { id, cwd: typeof p.cwd === 'string' ? p.cwd : undefined };
      return [];
    }
    if (o.type === 'event_msg') {
      if (p.type === 'task_complete' || p.type === 'turn_complete') this.turnDone = true;
      if (p.type === 'task_started' || p.type === 'turn_started') this.turnDone = false;
      if (p.type !== 'item_completed' || !p.item || typeof p.item !== 'object') return [];
      this.finished = true;
      const out = this.completed(p.item as Payload);
      if (out.length) this.turnDone = false;
      return out;
    }
    if (o.type !== 'response_item' || this.finished) return [];
    const out = this.item(p);
    if (out.length) this.turnDone = false;
    return out;
  }

  private item(p: Payload): ParsedEvent[] {
    switch (p.type) {
      case 'reasoning':
        return [{ kind: 'thinking' }];
      case 'web_search_call':
        return [{ kind: 'tool_start', tool: 'WebSearch' }];
      case 'local_shell_call': {
        const action = p.action as { command?: unknown } | undefined;
        return [this.shell(p.call_id, Array.isArray(action?.command) ? action.command : undefined)];
      }
      case 'function_call': {
        const name = typeof p.name === 'string' ? p.name : '';
        if (!name) return [];
        if (SHELL.has(name)) return [this.shell(p.call_id, args(p.arguments))];
        return [{ kind: 'tool_start', tool: name.split('__').pop()!.slice(0, 40) }];
      }
      case 'custom_tool_call':
        if (p.name === 'apply_patch' && typeof p.input === 'string') return patchFiles(p.input).map((f) => ({ kind: 'file_write', tool: 'Edit', target: f }));
        return typeof p.name === 'string' ? [{ kind: 'tool_start', tool: p.name.slice(0, 40) }] : [];
      case 'function_call_output':
        return this.output(p);
      default:
        return [];
    }
  }

  /** A finished item (newer Codex): one or two events, the second saying how it ended. */
  private completed(it: Payload): ParsedEvent[] {
    switch (it.type) {
      case 'Reasoning':
        return [{ kind: 'thinking' }];
      case 'CommandExecution': {
        // Codex already tells what a command was for: reading a file, searching, listing
        const first = (Array.isArray(it.parsed_cmd) ? it.parsed_cmd[0] : null) as { type?: unknown; name?: unknown; path?: unknown } | null;
        if (first?.type === 'read') return [{ kind: 'file_read', tool: 'Read', target: basename(first.name ?? first.path) }];
        if (first?.type === 'search') return [{ kind: 'tool_start', tool: 'Grep' }];
        if (first?.type === 'list_files') return [{ kind: 'tool_start', tool: 'LS' }];
        const ev = this.shell(undefined, Array.isArray(it.command) ? it.command : typeof it.command === 'string' ? it.command : undefined);
        const code = typeof it.exit_code === 'number' ? it.exit_code : it.status === 'failed' ? 1 : 0;
        if (isTest(ev.target)) return [ev, { kind: code === 0 ? 'test_pass' : 'test_fail', tool: ev.tool, target: ev.target }];
        return code === 0 ? [ev] : [ev, { kind: 'error', tool: ev.tool, target: ev.target }];
      }
      case 'FileChange': {
        if (it.status === 'declined' || !it.changes || typeof it.changes !== 'object') return [];
        const files = (Array.isArray(it.changes) ? it.changes.map((c) => (c as { path?: unknown })?.path) : Object.keys(it.changes)).map(basename).filter(Boolean) as string[];
        return [...new Set(files)].slice(0, 5).map((f) => ({ kind: 'file_write', tool: 'Edit', target: f }));
      }
      case 'McpToolCall': {
        const tool = typeof it.tool === 'string' ? it.tool.slice(0, 40) : 'mcp';
        return it.status === 'failed' ? [{ kind: 'tool_start', tool }, { kind: 'error', tool }] : [{ kind: 'tool_start', tool }];
      }
      case 'Extension':
        return it.kind === 'web.search' ? [{ kind: 'tool_start', tool: 'WebSearch' }] : [];
      default:
        return [];
    }
  }

  /** A shell call: `cmd` string (exec_command), `command` array (shell) or string (shell_command). */
  private shell(callId: unknown, a: unknown): ParsedEvent {
    let cmd: string | undefined;
    if (typeof a === 'string') cmd = a;
    else if (Array.isArray(a)) cmd = a.length >= 3 && /sh$/.test(String(a[0])) && a[1] === '-lc' ? String(a[2]) : a.map(String).join(' ');
    else if (a && typeof a === 'object') {
      const o = a as Record<string, unknown>;
      if (typeof o.cmd === 'string') cmd = o.cmd;
      else return this.shell(callId, o.command);
    }
    const ev: ParsedEvent = { kind: 'bash', tool: 'Bash', target: cmd ? commandTarget(cmd) : undefined };
    if (typeof callId === 'string') this.pending.set(callId, ev);
    return ev;
  }

  /** Codex writes no success flag: the exit code is inside the output text. */
  private output(p: Payload): ParsedEvent[] {
    const call = typeof p.call_id === 'string' ? this.pending.get(p.call_id) : undefined;
    if (!call) return [];
    this.pending.delete(p.call_id as string);
    const code = exitCode(p.output);
    if (code === null) return [];
    if (isTest(call.target)) return [{ kind: code === 0 ? 'test_pass' : 'test_fail', tool: call.tool, target: call.target }];
    return code === 0 ? [] : [{ kind: 'error', tool: call.tool, target: call.target }];
  }
}

function args(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
}

function exitCode(output: unknown): number | null {
  const text = typeof output === 'string' ? output : Array.isArray(output) ? output.map((c) => (typeof c?.text === 'string' ? c.text : '')).join('\n') : '';
  const m = /Process exited with code (-?\d+)|Exit code: (-?\d+)/.exec(text);
  if (m) return Number(m[1] ?? m[2]);
  try {
    const code = JSON.parse(text)?.metadata?.exit_code;
    return typeof code === 'number' ? code : null;
  } catch {
    return null;
  }
}

/** The files an apply_patch touches, by base name: `*** Add/Update/Delete File: <path>`. */
function patchFiles(patch: string): string[] {
  const out: string[] = [];
  for (const m of patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
    const f = basename(m[1].trim());
    if (f && !out.includes(f)) out.push(f);
  }
  return out.slice(0, 5);
}
