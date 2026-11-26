import { basename, commandTarget } from './parse.ts';

/**
 * What the permission hook sends to Bytehoven: the session, its folder name, the
 * tool and a short target. Same privacy contract as the transcript parser:
 * commands are cut to their verb, paths to a base name, contents are dropped.
 *
 * Claude Code and Codex send the same PermissionRequest shape (session_id, cwd,
 * tool_name, tool_input). For Codex the session and folder are named the way
 * the Codex reader names them, so the request lands on the right session.
 */

const SHELL = new Set(['Bash', 'exec_command', 'shell', 'shell_command', 'local_shell']);

export function permissionBody(hook: Record<string, unknown>, codex: boolean) {
  if (hook.hook_event_name !== 'PermissionRequest' || typeof hook.session_id !== 'string') return null;
  const input = (hook.tool_input && typeof hook.tool_input === 'object' ? hook.tool_input : {}) as Record<string, unknown>;
  const tool = typeof hook.tool_name === 'string' ? hook.tool_name : '';
  const folder = typeof hook.cwd === 'string' ? basename(hook.cwd) : undefined;
  return {
    event: 'PermissionRequest',
    session: codex ? `codex:${hook.session_id}` : hook.session_id,
    folder: codex ? `${folder ?? 'codex'} · codex` : folder,
    agent: typeof hook.agent_id === 'string' ? hook.agent_id : undefined,
    tool: SHELL.has(tool) ? 'Bash' : tool === 'apply_patch' ? 'Edit' : tool,
    target: targetOf(input),
  };
}

function targetOf(input: Record<string, unknown>): string | undefined {
  const file = input.file_path ?? input.notebook_path;
  if (typeof file === 'string') return basename(file);
  const cmd = input.cmd ?? input.command;
  if (typeof cmd === 'string') return commandTarget(cmd);
  if (Array.isArray(cmd)) return commandTarget(cmd.length >= 3 && cmd[1] === '-lc' ? String(cmd[2]) : cmd.map(String).join(' '));
  // apply_patch: the first file it touches
  const patch = typeof input.input === 'string' ? input.input : typeof input.patch === 'string' ? input.patch : '';
  const m = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/m.exec(patch);
  return m ? basename(m[1].trim()) : undefined;
}
