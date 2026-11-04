/**
 * The Bytehoven event model.
 *
 * This is the only shape the audio engine and the stage ever see. The demo
 * simulator produces it today; a Claude Code transcript reader will produce
 * exactly the same thing later. By design it carries tool names, a short
 * target (usually a file name) and status — never prompts, messages or file
 * contents.
 */

export type Role = 'code' | 'test' | 'research' | 'docs' | 'refactor';
export type InstrumentId = 'piano' | 'percussion' | 'violin' | 'flute' | 'contrabass';

export type AgentEventKind =
  | 'tool_start' // generic tool call (Grep, Glob, WebSearch, ...)
  | 'file_read'
  | 'file_write'
  | 'bash'
  | 'test_pass'
  | 'test_fail'
  | 'error'
  | 'thinking'
  | 'idle'
  | 'permission_request'
  | 'permission_resolved'
  | 'subagent_join'
  | 'subagent_leave'
  | 'task_done';

export interface AgentEvent {
  id: number;
  agentId: string;
  kind: AgentEventKind;
  /** Tool name, e.g. "Read", "Edit", "Bash". */
  tool?: string;
  /** Short target such as a file base name or a command verb. */
  target?: string;
  /** For permission_resolved: whether the user approved. */
  approved?: boolean;
  /** For subagent events: the sub-agent's info. */
  child?: AgentInfo;
  /** For joins: the musician is already on stage (no walk-in). */
  seated?: boolean;
  /** Live mode: the session (project folder) this came from. */
  session?: string;
  /** Live mode: an event from before the page opened, shown but not played. */
  replay?: boolean;
  /** Wall-clock ms. */
  at: number;
}

export interface AgentInfo {
  id: string;
  /** Display name of the musician. */
  name: string;
  role: Role;
  instrument: InstrumentId;
  parentId?: string;
  /** Short, non-sensitive session label (e.g. project folder name). */
  session: string;
}

export const DEFAULT_INSTRUMENT: Record<Role, InstrumentId> = {
  code: 'piano',
  test: 'percussion',
  research: 'violin',
  docs: 'flute',
  refactor: 'contrabass',
};

let nextId = 1;
export function makeEvent(agentId: string, kind: AgentEventKind, extra: Partial<AgentEvent> = {}): AgentEvent {
  return { id: nextId++, agentId, kind, at: performance.now(), ...extra };
}
