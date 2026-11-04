import { spawn as nodeSpawn } from 'node:child_process';
import crypto from 'node:crypto';

/**
 * The conductor hands a musician a new part: a one-off `claude -p` run in that
 * session's project folder.
 *
 * Safety rules:
 *   - no shell: `claude` is started with an argument list, and the task goes to
 *     its stdin, so nothing you type is ever parsed as a command line;
 *   - narrow permissions: reading, searching and editing files are allowed;
 *     other tools follow your Claude Code permission settings, and whatever asks
 *     for permission becomes a fermata you answer with Approve / Deny;
 *   - `rm`, `git push` and `curl` are always blocked;
 *   - one part at a time; the task text is never logged or stored.
 */

export const ALLOWED = ['Read', 'Grep', 'Glob', 'Edit', 'Write'];
export const BLOCKED = ['Bash(rm:*)', 'Bash(git push:*)', 'Bash(curl:*)'];
export const MAX_TASK = 4000;

export function conductArgs(sessionId: string): string[] {
  return ['-p', '--session-id', sessionId, '--permission-mode', 'default', '--allowedTools', ...ALLOWED, '--disallowedTools', ...BLOCKED];
}

type Spawn = typeof nodeSpawn;

export class Conductor {
  private spawn: Spawn;
  private bin: string;
  private onEnd: (id: string) => void;
  private running: string | null = null;

  constructor(opts: { spawn?: Spawn; bin?: string; onEnd?: (id: string) => void } = {}) {
    this.spawn = opts.spawn ?? nodeSpawn;
    this.bin = opts.bin ?? 'claude';
    this.onEnd = opts.onEnd ?? (() => {});
  }

  get busy() {
    return this.running !== null;
  }

  start(o: { cwd: string; task: string }): { id: string } | { error: 'empty' | 'too_long' | 'busy' | 'failed' } {
    const task = o.task.trim();
    if (!task) return { error: 'empty' };
    if (task.length > MAX_TASK) return { error: 'too_long' };
    if (this.running) return { error: 'busy' };
    const id = crypto.randomUUID();
    let child: ReturnType<Spawn>;
    try {
      // the model's answer is not kept: stdout and stderr go nowhere
      child = this.spawn(this.bin, conductArgs(id), { cwd: o.cwd, stdio: ['pipe', 'ignore', 'ignore'], shell: false });
    } catch {
      return { error: 'failed' };
    }
    this.running = id;
    const done = () => {
      if (this.running !== id) return;
      this.running = null;
      this.onEnd(id);
    };
    child.on('exit', done);
    child.on('error', done);
    child.stdin?.on('error', () => {});
    child.stdin?.end(task);
    return { id };
  }
}
