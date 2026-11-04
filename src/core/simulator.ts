import { Emitter } from './bus';
import { makeEvent, type AgentEvent, type AgentEventKind, type AgentInfo } from './events';

/**
 * Demo mode: five simulated Claude Code agents with believable rhythms of
 * work, plus a scripted dramaturgy (a burst, a sub-agent, a failing test,
 * a permission request) so every feature of Bytehoven shows up within the
 * first minute. The simulator emits the same AgentEvent shape a real
 * transcript reader will.
 */

export const DEMO_AGENTS: AgentInfo[] = [
  { id: 'ines', name: 'Ines', role: 'research', instrument: 'violin', session: 'fermata · research' },
  { id: 'mira', name: 'Mira', role: 'docs', instrument: 'flute', session: 'fermata · docs' },
  { id: 'clara', name: 'Clara', role: 'code', instrument: 'piano', session: 'fermata · web' },
  { id: 'bruno', name: 'Bruno', role: 'refactor', instrument: 'contrabass', session: 'fermata · core' },
  { id: 'otto', name: 'Otto', role: 'test', instrument: 'percussion', session: 'fermata · ci' },
];

const SUB_AGENT: AgentInfo = {
  id: 'leo',
  name: 'Leo',
  role: 'research',
  instrument: 'violin',
  parentId: 'ines',
  session: 'fermata · research › explore',
};

type Step = { kind: AgentEventKind; tool?: string; targets?: string[]; w: number };

const FILES = {
  code: ['Stage.ts', 'router.ts', 'auth.ts', 'api/client.ts', 'useScore.ts', 'theme.css', 'main.ts', 'store.ts'],
  test: ['auth.spec.ts', 'router.spec.ts', 'e2e/stage.spec.ts', 'vitest.config.ts'],
  research: ['docs.pixijs.com', 'tonejs.github.io', 'web.dev/audio', 'mdn: AudioContext', 'w3.org/webaudio'],
  docs: ['README.md', 'CHANGELOG.md', 'docs/themes.md', 'docs/setup.md', 'CREDITS.md'],
  refactor: ['engine.ts', 'scheduler.ts', 'harmony.ts', 'voices.ts', 'mixer.ts', 'utils/time.ts'],
} as const;

const BEHAVIOUR: Record<AgentInfo['role'], { steps: Step[]; gap: [number, number] }> = {
  code: {
    gap: [700, 2100],
    steps: [
      { kind: 'file_read', tool: 'Read', targets: [...FILES.code], w: 3 },
      { kind: 'file_write', tool: 'Edit', targets: [...FILES.code], w: 3 },
      { kind: 'tool_start', tool: 'Grep', targets: ['"useScore"', '"export function"', '"TODO"'], w: 1.5 },
      { kind: 'bash', tool: 'Bash', targets: ['npm run build', 'tsc --noEmit'], w: 0.8 },
      { kind: 'thinking', w: 1.2 },
    ],
  },
  test: {
    gap: [1400, 3200],
    steps: [
      { kind: 'bash', tool: 'Bash', targets: ['npm test', 'vitest run', 'npx playwright test'], w: 3 },
      { kind: 'file_read', tool: 'Read', targets: [...FILES.test], w: 1.5 },
      { kind: 'file_write', tool: 'Edit', targets: [...FILES.test], w: 1 },
      { kind: 'thinking', w: 1 },
    ],
  },
  research: {
    gap: [1200, 2800],
    steps: [
      { kind: 'tool_start', tool: 'WebSearch', targets: ['pixijs bloom', 'web audio latency', 'tone.js sampler'], w: 2 },
      { kind: 'tool_start', tool: 'WebFetch', targets: [...FILES.research], w: 2 },
      { kind: 'file_read', tool: 'Read', targets: [...FILES.code], w: 1.5 },
      { kind: 'thinking', w: 1.6 },
    ],
  },
  docs: {
    gap: [1600, 3400],
    steps: [
      { kind: 'file_read', tool: 'Read', targets: [...FILES.docs], w: 2 },
      { kind: 'file_write', tool: 'Write', targets: [...FILES.docs], w: 2.2 },
      { kind: 'tool_start', tool: 'Glob', targets: ['docs/**/*.md', '*.md'], w: 0.8 },
      { kind: 'thinking', w: 1.4 },
    ],
  },
  refactor: {
    gap: [1100, 2600],
    steps: [
      { kind: 'tool_start', tool: 'Grep', targets: ['"schedule("', '"new Sampler"', '"any"'], w: 2 },
      { kind: 'file_write', tool: 'Edit', targets: [...FILES.refactor], w: 2.5 },
      { kind: 'file_read', tool: 'Read', targets: [...FILES.refactor], w: 1.5 },
      { kind: 'thinking', w: 1 },
    ],
  },
};

const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];
const rand = (a: number, b: number) => a + Math.random() * (b - a);

function weighted(steps: Step[]): Step {
  const total = steps.reduce((s, x) => s + x.w, 0);
  let r = Math.random() * total;
  for (const s of steps) if ((r -= s.w) <= 0) return s;
  return steps[steps.length - 1];
}

interface AgentRuntime {
  info: AgentInfo;
  active: boolean;
  activity: number; // multiplier on how busy the agent is (0 = paused)
  timer?: number;
}

export class DemoSimulator extends Emitter<{ event: AgentEvent }> {
  private runtimes = new Map<string, AgentRuntime>();
  private timers: number[] = [];
  private waitingFor: string | null = null;
  private running = false;
  private paused = false;

  constructor(readonly agents: AgentInfo[] = DEMO_AGENTS) {
    super();
    for (const info of agents) this.runtimes.set(info.id, { info, active: false, activity: 1 });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    for (const rt of this.runtimes.values()) {
      if (rt.info.parentId) continue;
      rt.active = true;
      this.send(rt.info.id, 'thinking');
      this.loop(rt, rand(600, 2200));
    }
    this.runScript();
  }

  stop(): void {
    this.running = false;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    for (const rt of this.runtimes.values()) clearTimeout(rt.timer);
  }

  /** The user's answer to a permission request (from the Approve / Deny controls). */
  resolvePermission(agentId: string, approved: boolean): void {
    if (this.waitingFor !== agentId) return;
    this.waitingFor = null;
    this.send(agentId, 'permission_resolved', { approved, tool: 'Bash', target: 'npm install' });
    for (const rt of this.runtimes.values()) rt.activity = 1;
    const rt = this.runtimes.get(agentId)!;
    rt.active = true;
    // a happy burst of work right after the go-ahead
    this.at(900, () => this.burst(agentId, 'file_write', 'Edit', [...FILES.code], 4, 1400));
    this.at(1600, () => this.loop(rt, 1200));
    this.afterResolve();
  }

  /**
   * Pause the agents (e.g. while the tour is showing). Scripted moments that
   * fall into the pause are dropped, except a permission request, which waits.
   */
  setPaused(p: boolean): void {
    this.paused = p;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Ask the user for permission on behalf of an agent (used by the script and for debugging). */
  requestPermission(agentId: string, tool = 'Bash', target = 'npm install'): void {
    if (this.waitingFor) return;
    if (this.paused) {
      this.at(2000, () => this.requestPermission(agentId, tool, target));
      return;
    }
    this.setActive(agentId, false);
    this.waitingFor = agentId;
    for (const rt of this.runtimes.values()) if (rt.info.id !== agentId) rt.activity = 0.3;
    this.send(agentId, 'permission_request', { tool, target });
  }

  /** Fire a single event by hand (debug console: bytehoven.sim.fire('otto', 'test_fail')). */
  fire(agentId: string, kind: AgentEventKind, extra: Partial<AgentEvent> = {}): void {
    this.send(agentId, kind, extra);
  }

  get pending(): string | null {
    return this.waitingFor;
  }

  // ------------------------------------------------------------------ internals

  private send(agentId: string, kind: AgentEventKind, extra: Partial<AgentEvent> = {}) {
    if (!this.running) return;
    if (this.paused && kind !== 'permission_resolved' && kind !== 'subagent_leave') return;
    // a musician with a raised hand plays nothing until the conductor answers
    if (this.waitingFor === agentId && kind !== 'permission_request' && kind !== 'permission_resolved') return;
    this.emit('event', makeEvent(agentId, kind, extra));
  }

  private at(ms: number, fn: () => void) {
    this.timers.push(window.setTimeout(fn, ms));
  }

  private loop(rt: AgentRuntime, delay: number) {
    clearTimeout(rt.timer);
    rt.timer = window.setTimeout(() => {
      if (!this.running || !rt.active) return;
      if (rt.activity <= 0.01) return this.loop(rt, 800);
      if (Math.random() > rt.activity) return this.loop(rt, rand(900, 1800));
      const b = BEHAVIOUR[rt.info.role];
      const step = weighted(b.steps);
      this.send(rt.info.id, step.kind, { tool: step.tool, target: step.targets ? pick(step.targets) : undefined });
      const extra = step.kind === 'thinking' ? rand(1800, 3600) : 0;
      this.loop(rt, rand(b.gap[0], b.gap[1]) / Math.max(0.35, rt.activity) + extra);
    }, delay);
  }

  private burst(agentId: string, kind: AgentEventKind, tool: string, targets: string[], count: number, overMs: number) {
    for (let i = 0; i < count; i++) {
      this.at((overMs / count) * i + rand(0, 60), () => this.send(agentId, kind, { tool, target: pick(targets) }));
    }
  }

  private setActive(id: string, active: boolean) {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    rt.active = active;
    if (active) this.loop(rt, rand(400, 900));
    else clearTimeout(rt.timer);
  }

  /** The scripted part of the demo. Times are ms after the concert starts. */
  private runScript() {
    // 1. Clara skims the codebase — 16 reads in three seconds become one flowing run.
    this.at(12000, () => this.burst('clara', 'file_read', 'Read', [...FILES.code, ...FILES.refactor], 16, 3000));

    // 2. Ines spawns an Explore sub-agent: a second violin walks on stage.
    this.at(19000, () => {
      this.runtimes.set(SUB_AGENT.id, { info: SUB_AGENT, active: false, activity: 1 });
      this.send('ines', 'subagent_join', { tool: 'Task', target: 'explore', child: SUB_AGENT });
    });
    this.at(21500, () => this.setActive('leo', true));

    // 3. Otto's test run fails: a dissonant chord.
    this.at(30000, () => {
      this.setActive('otto', false);
      this.send('otto', 'bash', { tool: 'Bash', target: 'npm test' });
    });
    this.at(32600, () => this.send('otto', 'test_fail', { tool: 'Bash', target: 'auth.spec.ts' }));
    this.at(37000, () => {
      this.send('otto', 'thinking');
      this.setActive('otto', true);
    });

    // 4. The sub-agent reports back and leaves.
    this.at(41000, () => {
      this.setActive('leo', false);
      this.send('leo', 'task_done', { tool: 'Task', target: 'explore' });
    });
    this.at(43000, () => this.send('ines', 'subagent_leave', { tool: 'Task', target: 'explore', child: SUB_AGENT }));

    // 5. Bruno dozes off for a while.
    this.at(44000, () => {
      this.setActive('bruno', false);
      this.send('bruno', 'idle');
    });

    // 6. FERMATA: Clara needs permission to run a command.
    this.at(48000, () => this.requestPermission('clara', 'Bash', 'npm install'));
  }

  private afterResolve() {
    this.at(4000, () => {
      this.send('bruno', 'thinking');
      this.setActive('bruno', true);
    });
    this.at(9000, () => {
      this.setActive('otto', false);
      this.send('otto', 'bash', { tool: 'Bash', target: 'npm test' });
    });
    this.at(11600, () => this.send('otto', 'test_pass', { tool: 'Bash', target: '42 passed' }));
    this.at(12500, () => this.setActive('otto', true));
    this.at(22000, () => {
      this.setActive('mira', false);
      this.send('mira', 'task_done', { tool: 'Write', target: 'README.md' });
    });
    this.at(26000, () => {
      this.send('mira', 'thinking');
      this.setActive('mira', true);
    });
    // and around again, so the demo keeps telling its story
    this.at(34000, () => {
      this.runtimes.delete(SUB_AGENT.id);
      this.runScript();
    });
  }
}
