/**
 * Bytehoven's Claude Code hook (PermissionRequest).
 *
 * Claude Code runs this when a tool needs your permission. It forwards only the
 * session id, the tool name and a short target (a file's base name or a command's
 * first word) to Bytehoven on 127.0.0.1, then waits for Approve / Deny there.
 *
 * If Bytehoven isn't running, nobody is watching, or no answer comes in time,
 * it prints nothing and Claude Code shows its own permission prompt as usual.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { commandTarget } from '../server/live/parse.ts';

// where a running Bytehoven leaves its port and token (see server/live/start.ts)
const LIVE_FILE = path.join(process.env.BYTEHOVEN_HOME || path.join(os.homedir(), '.bytehoven'), 'live.json');
const WAIT_MS = 55_000; // keep below the hook timeout set by `npm run hooks`

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
  });
}

function targetOf(input: Record<string, unknown>): string | undefined {
  const file = input.file_path ?? input.notebook_path;
  if (typeof file === 'string') return path.basename(file);
  if (typeof input.command === 'string') return commandTarget(input.command);
  return undefined;
}

async function main() {
  let live: { port: number; token: string };
  try {
    live = JSON.parse(fs.readFileSync(LIVE_FILE, 'utf8'));
  } catch {
    return; // Bytehoven isn't running
  }
  let hook: Record<string, unknown>;
  try {
    hook = JSON.parse(await readStdin());
  } catch {
    return;
  }
  if (hook.hook_event_name !== 'PermissionRequest') return;
  const input = (hook.tool_input && typeof hook.tool_input === 'object' ? hook.tool_input : {}) as Record<string, unknown>;
  const body = JSON.stringify({
    event: 'PermissionRequest',
    session: hook.session_id,
    folder: typeof hook.cwd === 'string' ? path.basename(hook.cwd) : undefined,
    agent: hook.agent_id,
    tool: hook.tool_name,
    target: targetOf(input),
  });

  const decision = await new Promise<string | null>((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: live.port,
        method: 'POST',
        path: '/__live/hook',
        headers: { host: `127.0.0.1:${live.port}`, 'content-type': 'application/json', 'x-bytehoven-token': live.token },
        timeout: WAIT_MS,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data).decision ?? null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.end(body);
  });

  if (decision === 'allow' || decision === 'deny') {
    const out = { behavior: decision, ...(decision === 'deny' ? { message: 'Denied from Bytehoven.' } : {}) };
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: out } }));
  }
}

main();
