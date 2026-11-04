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
 *
 * Planning first: a tool-less `claude -p --json-schema` run splits a task into
 * parts by kind of work. The plan is checked before anyone sees it; a malformed
 * plan starts nothing. You see the plan first (a dry run) and only "Run" starts
 * its parts, one after another, each a normal part as above.
 */

export const ALLOWED = ['Read', 'Grep', 'Glob', 'Edit', 'Write'];
export const BLOCKED = ['Bash(rm:*)', 'Bash(git push:*)', 'Bash(curl:*)'];
export const MAX_TASK = 4000;
export const MAX_PARTS = 5;

export const ROLES = ['code', 'research', 'docs', 'test', 'refactor'] as const;
export type PlanRole = (typeof ROLES)[number];
export interface PlanPart {
  role: PlanRole;
  task: string;
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    parts: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_PARTS,
      items: {
        type: 'object',
        properties: { role: { type: 'string', enum: ROLES }, task: { type: 'string' } },
        required: ['role', 'task'],
      },
    },
  },
  required: ['parts'],
};

/** No tools at all: the planner can only answer, in the plan's shape. Nothing is saved as a session. */
export const PLAN_ARGS = ['-p', '--tools', '', '--no-session-persistence', '--output-format', 'json', '--json-schema', JSON.stringify(PLAN_SCHEMA)];

/** What the planner is told; the task itself goes in on stdin with it. */
export function planPrompt(task: string): string {
  return [
    'You are the conductor of a small band of coding agents. Split the task below into 1 to 5 parts.',
    'Each part goes to one kind of work: code (writing code), research (reading and searching), docs (writing documentation), test (running and fixing tests), refactor (commands and builds).',
    'Each part must be a complete instruction someone can follow on its own, in the order they should run. Use as few parts as the task needs.',
    '',
    'Task:',
    task,
  ].join('\n');
}

/** The planner's answer, checked: anything off and the plan is refused. */
export function parsePlan(stdout: string): { parts: PlanPart[] } | { error: 'malformed' } {
  try {
    const o = JSON.parse(stdout);
    if (o?.is_error) return { error: 'malformed' };
    const parts = checkParts(o?.structured_output?.parts);
    return parts ? { parts } : { error: 'malformed' };
  } catch {
    return { error: 'malformed' };
  }
}

function checkParts(v: unknown): PlanPart[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_PARTS) return null;
  const out: PlanPart[] = [];
  for (const p of v) {
    const task = typeof p?.task === 'string' ? p.task.trim() : '';
    if (!ROLES.includes(p?.role) || !task || task.length > MAX_TASK) return null;
    out.push({ role: p.role, task });
  }
  return out;
}

export function conductArgs(sessionId: string): string[] {
  return ['-p', '--session-id', sessionId, '--permission-mode', 'default', '--allowedTools', ...ALLOWED, '--disallowedTools', ...BLOCKED];
}

type Spawn = typeof nodeSpawn;

export class Conductor {
  private spawn: Spawn;
  private bin: string;
  private onEnd: (id: string) => void;
  private onStart: (id: string, role?: PlanRole) => void;
  private running: string | null = null;
  /** The rest of a plan that is running. */
  private queue: { cwd: string; parts: PlanPart[] } | null = null;
  private planning = false;

  constructor(opts: { spawn?: Spawn; bin?: string; onEnd?: (id: string) => void; onStart?: (id: string, role?: PlanRole) => void } = {}) {
    this.spawn = opts.spawn ?? nodeSpawn;
    this.bin = opts.bin ?? 'claude';
    this.onEnd = opts.onEnd ?? (() => {});
    this.onStart = opts.onStart ?? (() => {});
  }

  get busy() {
    return this.running !== null || this.queue !== null;
  }

  /** Ask for a plan. Starts nothing. */
  plan(o: { cwd: string; task: string }): Promise<{ parts: PlanPart[] } | { error: 'empty' | 'too_long' | 'busy' | 'failed' | 'malformed' }> {
    const task = o.task.trim();
    if (!task) return Promise.resolve({ error: 'empty' });
    if (task.length > MAX_TASK) return Promise.resolve({ error: 'too_long' });
    if (this.planning) return Promise.resolve({ error: 'busy' });
    let child: ReturnType<Spawn>;
    try {
      child = this.spawn(this.bin, PLAN_ARGS, { cwd: o.cwd, stdio: ['pipe', 'pipe', 'ignore'], shell: false });
    } catch {
      return Promise.resolve({ error: 'failed' });
    }
    this.planning = true;
    return new Promise((resolve) => {
      let out = '';
      const timer = setTimeout(() => child.kill(), 120_000);
      child.stdout?.on('data', (c: Buffer) => {
        out += c;
        if (out.length > 65_536) child.kill(); // a plan is small; anything bigger is not one
      });
      const done = (ok: boolean) => {
        if (!this.planning) return;
        this.planning = false;
        clearTimeout(timer);
        resolve(ok ? parsePlan(out) : { error: 'failed' });
      };
      child.on('exit', () => setImmediate(() => done(true))); // let stdout finish first
      child.on('error', () => done(false));
      child.stdin?.on('error', () => {});
      child.stdin?.end(planPrompt(task));
    });
  }

  /** Run a plan's parts one after another. The parts are checked again: they came back from the page. */
  startPlan(o: { cwd: string; parts: unknown }): { ok: true } | { error: 'busy' | 'malformed' } {
    if (this.busy) return { error: 'busy' };
    const parts = checkParts(o.parts);
    if (!parts) return { error: 'malformed' };
    this.queue = { cwd: o.cwd, parts };
    this.next();
    return { ok: true };
  }

  private next() {
    const q = this.queue;
    const part = q?.parts.shift();
    if (!q || !part) return void (this.queue = null);
    const r = this.run({ cwd: q.cwd, task: part.task });
    if ('id' in r) this.onStart(r.id, part.role);
    else this.queue = null;
  }

  start(o: { cwd: string; task: string }): { id: string } | { error: 'empty' | 'too_long' | 'busy' | 'failed' } {
    if (this.queue) return { error: 'busy' };
    return this.run(o);
  }

  private run(o: { cwd: string; task: string }): { id: string } | { error: 'empty' | 'too_long' | 'busy' | 'failed' } {
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
      if (this.queue) this.next();
    };
    child.on('exit', done);
    child.on('error', done);
    child.stdin?.on('error', () => {});
    child.stdin?.end(task);
    return { id };
  }
}
