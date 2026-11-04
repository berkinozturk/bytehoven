import { Emitter } from './bus';
import { DEFAULT_INSTRUMENT, makeEvent, type AgentEvent, type AgentEventKind, type AgentInfo, type Role } from './events';

/**
 * Live mode: your running Claude Code sessions take the stage.
 *
 * Listens to the dev server's /__live/events stream and turns it into the same
 * AgentEvents the demo simulator produces. Each session sits in one of the five
 * chairs and takes that musician's name and instrument; its sub-agents become
 * second chairs beside it.
 */

/** Chairs in the order sessions fill them, and the second chair's name. */
const CHAIRS: Array<{ id: string; name: string; role: Role; second: string }> = [
  { id: 'clara', name: 'Clara', role: 'code', second: 'Nora' },
  { id: 'ines', name: 'Ines', role: 'research', second: 'Leo' },
  { id: 'otto', name: 'Otto', role: 'test', second: 'Hugo' },
  { id: 'mira', name: 'Mira', role: 'docs', second: 'Ada' },
  { id: 'bruno', name: 'Bruno', role: 'refactor', second: 'Felix' },
];

type Msg =
  | { type: 'hello'; sessions: Session[]; permissions: Permission[] }
  | { type: 'session'; session: Session }
  | { type: 'session_end'; id: string }
  | { type: 'event'; session: string; agent?: string; ev: { kind: AgentEventKind; tool?: string; target?: string; child?: string } }
  | ({ type: 'permission' } & Permission)
  | { type: 'permission_end'; id: number; approved?: boolean };

interface Session {
  id: string;
  folder: string;
  status: string;
}

interface Permission {
  id: number;
  session: string;
  agent?: string;
  tool: string;
  target?: string;
}

export interface LiveStatus {
  connected: boolean;
  /** The page is served without the live server (e.g. a static build). */
  unavailable: boolean;
  sessions: number;
}

export class LiveSource extends Emitter<{ event: AgentEvent; status: LiveStatus }> {
  /** session id → chair id */
  private seats = new Map<string, string>();
  /** session id → status, to notice a finished turn */
  private statuses = new Map<string, string>();
  /** chair id → sub-agent tool-call id → musician id */
  private children = new Map<string, Map<string, string>>();
  /** musician id → the permission request it is waiting on */
  private waiting = new Map<string, number>();
  /** chair id → when it was freed; a chair rests a moment so its musician can walk off */
  private freed = new Map<string, number>();
  /** musician id → who sits there, so a leaving musician is named */
  private infos = new Map<string, AgentInfo>();
  private source: EventSource | null = null;
  private paused = false;
  private connected = false;
  private failures = 0;

  get isRunning() {
    return !!this.source;
  }

  start() {
    if (this.source) return;
    const es = new EventSource('/__live/events');
    this.source = es;
    es.onmessage = (e) => {
      this.failures = 0;
      try {
        this.onMsg(JSON.parse(e.data));
      } catch {
        /* a message we don't understand */
      }
    };
    es.onerror = () => {
      this.connected = false;
      this.failures++;
      this.report();
    };
  }

  setPaused(p: boolean) {
    this.paused = p;
  }

  resolvePermission(agentId: string, approved: boolean) {
    const id = this.waiting.get(agentId);
    if (id === undefined) return;
    this.waiting.delete(agentId);
    fetch('/__live/decision', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, approved }) }).catch(() => {});
    this.emit('event', makeEvent(agentId, 'permission_resolved', { approved }));
  }

  private report() {
    // A static build has no live server: the stream fails before it ever opens.
    this.emit('status', { connected: this.connected, unavailable: !this.connected && this.failures > 2, sessions: this.seats.size });
  }

  private onMsg(m: Msg) {
    switch (m.type) {
      case 'hello':
        this.connected = true;
        for (const s of m.sessions) this.seat(s, false);
        for (const p of m.permissions) this.ask(p);
        this.report();
        break;
      case 'session': {
        const known = this.seats.has(m.session.id);
        const chair = this.seat(m.session, true);
        const before = this.statuses.get(m.session.id);
        this.statuses.set(m.session.id, m.session.status);
        if (known && chair && before === 'busy' && m.session.status === 'idle') this.send(chair, 'task_done');
        this.report();
        break;
      }
      case 'session_end': {
        const chair = this.seats.get(m.id);
        if (!chair) break;
        for (const kid of this.children.get(chair)?.values() ?? []) this.leave(kid);
        this.children.delete(chair);
        this.seats.delete(m.id);
        this.statuses.delete(m.id);
        this.freed.set(chair, Date.now());
        this.leave(chair);
        this.report();
        break;
      }
      case 'event':
        this.onEvent(m);
        break;
      case 'permission':
        this.ask(m);
        break;
      case 'permission_end': {
        // answered in Claude Code itself, or timed out
        for (const [who, id] of this.waiting) {
          if (id !== m.id) continue;
          this.waiting.delete(who);
          this.emit('event', makeEvent(who, 'permission_resolved', { approved: m.approved ?? true }));
        }
        break;
      }
    }
  }

  /** Give a session a chair. Returns the chair id, or null when the stage is full. */
  private seat(s: Session, walkIn: boolean): string | null {
    const have = this.seats.get(s.id);
    if (have) return have;
    const taken = new Set(this.seats.values());
    const chair = CHAIRS.find((c) => !taken.has(c.id) && Date.now() - (this.freed.get(c.id) ?? 0) > 7000);
    if (!chair) return null;
    this.seats.set(s.id, chair.id);
    this.statuses.set(s.id, s.status);
    const info: AgentInfo = { id: chair.id, name: chair.name, role: chair.role, instrument: DEFAULT_INSTRUMENT[chair.role], session: s.folder };
    this.infos.set(chair.id, info);
    this.emit('event', makeEvent(chair.id, 'subagent_join', { child: info, seated: !walkIn }));
    return chair.id;
  }

  private leave(id: string) {
    const child = this.infos.get(id) ?? ({ id, name: '' } as AgentInfo);
    this.infos.delete(id);
    this.waiting.delete(id);
    this.emit('event', makeEvent(id, 'subagent_leave', { child }));
  }

  private onEvent(m: Extract<Msg, { type: 'event' }>) {
    const chair = this.seats.get(m.session) ?? this.seat({ id: m.session, folder: 'session', status: 'busy' }, true);
    if (!chair || this.paused) return;
    const { kind, tool, target, child } = m.ev;
    if (kind === 'subagent_join' && child) return this.join(chair, child, target);
    if (kind === 'subagent_leave' && child) {
      const kid = this.children.get(chair)?.get(child);
      if (kid) {
        this.children.get(chair)!.delete(child);
        this.leave(kid);
      }
      return;
    }
    const who = (m.agent && this.children.get(chair)?.get(m.agent)) || chair;
    if (this.waiting.has(who)) return; // a musician holding the fermata doesn't play
    this.send(who, kind, { tool, target });
  }

  private join(chair: string, call: string, kind?: string) {
    const kids = this.children.get(chair) ?? new Map<string, string>();
    this.children.set(chair, kids);
    if (kids.size >= 1) return; // one second chair per musician fits on stage
    const parent = CHAIRS.find((c) => c.id === chair)!;
    const id = `${chair}-2`;
    kids.set(call, id);
    const info: AgentInfo = {
      id,
      name: parent.second,
      role: parent.role,
      instrument: 'violin', // second chairs are the string section: a second piano wouldn't fit
      parentId: chair,
      session: kind ?? 'sub-agent',
    };
    this.infos.set(id, info);
    this.send(chair, 'subagent_join', { child: info, tool: 'Agent', target: kind });
  }

  private ask(p: Permission) {
    const chair = this.seats.get(p.session);
    if (!chair) return;
    const who = (p.agent && this.children.get(chair)?.get(p.agent)) || chair;
    this.waiting.set(who, p.id);
    this.emit('event', makeEvent(who, 'permission_request', { tool: p.tool, target: p.target }));
  }

  private send(agentId: string, kind: AgentEventKind, extra: Partial<AgentEvent> = {}) {
    this.emit('event', makeEvent(agentId, kind, extra));
  }
}
