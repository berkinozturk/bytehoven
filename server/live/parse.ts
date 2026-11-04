/**
 * Turns Claude Code transcript lines into Bytehoven events.
 *
 * Privacy contract: each line is parsed in memory and only these fields are kept:
 * the tool name, a file's base name, the first word of a shell command (or a known
 * test runner), whether a tool failed, and a sub-agent's type. Prompts, messages,
 * thinking, file contents, paths and full commands are dropped on the spot.
 *
 * The transcript format is internal to Claude Code and changes between versions,
 * so everything here is defensive: unknown lines are ignored, never fatal.
 */

export type ParsedKind =
  | 'tool_start'
  | 'file_read'
  | 'file_write'
  | 'bash'
  | 'thinking'
  | 'error'
  | 'test_pass'
  | 'test_fail'
  | 'subagent_join'
  | 'subagent_leave';

export interface ParsedEvent {
  kind: ParsedKind;
  tool?: string;
  target?: string;
  /** For sub-agent events: the id of the tool call that started it. */
  child?: string;
}

const READ = new Set(['Read', 'NotebookRead']);
const WRITE = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SHELL = new Set(['Bash', 'PowerShell']);
const AGENT = new Set(['Agent', 'Task']);

export const basename = (p: unknown) => (typeof p === 'string' && p ? p.split(/[\\/]/).filter(Boolean).pop() : undefined);

const TEST_RUNNERS = new Set(['vitest', 'jest', 'pytest', 'mocha', 'playwright', 'phpunit', 'rspec']);
const PKG = new Set(['npm', 'pnpm', 'yarn', 'bun']);

/** The verb of a shell command: "git push origin" → "git", "npm run test" → "npm test". */
export function commandTarget(cmd: string): string | undefined {
  for (const segment of cmd.split(/&&|\|\||;|\|/)) {
    const words = segment.trim().split(/\s+/).filter((w) => w && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
    let i = 0;
    let verb = basename(words[i]);
    if (!verb || verb === 'cd') continue;
    if (verb === 'npx' || verb === 'bunx' || verb === 'pnpx') verb = basename(words[++i]);
    if ((verb === 'python' || verb === 'python3') && words[i + 1] === '-m') verb = basename(words[(i += 2)]);
    if (!verb) continue;
    const rest = words.slice(i + 1);
    if (PKG.has(verb) && (rest[0] === 'test' || (rest[0] === 'run' && rest[1] === 'test'))) return `${verb} test`;
    if ((verb === 'cargo' || verb === 'go') && rest[0] === 'test') return `${verb} test`;
    if (verb === 'node' && rest[0] === '--test') return 'node --test';
    return verb;
  }
  return undefined;
}

export const isTest = (target?: string) => !!target && (target.endsWith(' test') || target === 'node --test' || TEST_RUNNERS.has(target));

type Item = { type?: unknown; id?: unknown; name?: unknown; input?: unknown; tool_use_id?: unknown; is_error?: unknown };

export class TranscriptParser {
  /** Tool calls waiting for their result: id → what we told the stage. */
  private pending = new Map<string, ParsedEvent>();

  feed(line: string): ParsedEvent[] {
    let o: { type?: unknown; message?: { content?: unknown } };
    try {
      o = JSON.parse(line);
    } catch {
      return [];
    }
    const content = o?.message?.content;
    if (!Array.isArray(content)) return [];
    const out: ParsedEvent[] = [];
    for (const raw of content as Item[]) {
      if (!raw || typeof raw !== 'object') continue;
      if (o.type === 'assistant' && raw.type === 'thinking') out.push({ kind: 'thinking' });
      else if (o.type === 'assistant' && raw.type === 'tool_use') {
        const ev = this.toolUse(raw);
        if (ev) out.push(ev);
      } else if (o.type === 'user' && raw.type === 'tool_result') {
        const ev = this.toolResult(raw);
        if (ev) out.push(ev);
      }
    }
    return out;
  }

  private toolUse(item: Item): ParsedEvent | null {
    if (typeof item.name !== 'string') return null;
    const name = item.name;
    const input = (item.input && typeof item.input === 'object' ? item.input : {}) as Record<string, unknown>;
    let ev: ParsedEvent;
    if (READ.has(name)) ev = { kind: 'file_read', tool: name, target: basename(input.file_path ?? input.notebook_path) };
    else if (WRITE.has(name)) ev = { kind: 'file_write', tool: name, target: basename(input.file_path ?? input.notebook_path) };
    else if (SHELL.has(name)) ev = { kind: 'bash', tool: name, target: typeof input.command === 'string' ? commandTarget(input.command) : undefined };
    else if (AGENT.has(name)) ev = { kind: 'subagent_join', tool: name, target: typeof input.subagent_type === 'string' ? input.subagent_type.slice(0, 40) : 'agent', child: String(item.id) };
    else ev = { kind: 'tool_start', tool: name.startsWith('mcp__') ? name.split('__').pop()! : name };
    if (typeof item.id === 'string') this.pending.set(item.id, ev);
    return ev;
  }

  private toolResult(item: Item): ParsedEvent | null {
    if (typeof item.tool_use_id !== 'string') return null;
    const call = this.pending.get(item.tool_use_id);
    if (!call) return null;
    this.pending.delete(item.tool_use_id);
    const failed = item.is_error === true;
    if (call.kind === 'subagent_join') return { ...call, kind: 'subagent_leave' };
    if (call.kind === 'bash' && isTest(call.target)) return { kind: failed ? 'test_fail' : 'test_pass', tool: call.tool, target: call.target };
    if (failed) return { kind: 'error', tool: call.tool, target: call.target };
    return null;
  }
}
