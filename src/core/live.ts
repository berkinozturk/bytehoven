import { Emitter } from './bus';
import { DEFAULT_INSTRUMENT, makeEvent, type AgentEvent, type AgentEventKind, type AgentInfo, type Role } from './events';
import { DEFAULT_CAST, roleOf } from './mixer';
import { chairFor, chairForTool, type ChairId } from './route';

/**
 * Live mode: your running Claude Code sessions play the orchestra.
 *
 * All five musicians are always on stage, each standing for a kind of work
 * (see ./route): any session can make any of them play, and every line in the
 * programme says which session (project folder) it came from. Musicians with
 * nothing to do doze off. Sub-agents and parts handed out by the conductor
 * play as second chairs.
 */

const CHAIRS: Array<{ id: ChairId; name: string; role: Role; second: string }> = [
  { id: 'clara', name: 'Clara', role: 'code', second: 'Nora' },
  { id: 'ines', name: 'Ines', role: 'research', second: 'Leo' },
  { id: 'otto', name: 'Otto', role: 'test', second: 'Hugo' },
  { id: 'mira', name: 'Mira', role: 'docs', second: 'Ada' },
  { id: 'bruno', name: 'Bruno', role: 'refactor', second: 'Felix' },
];

type Msg =
  | { type: 'hello'; sessions: SessionMsg[]; permissions: Permission[]; recent?: Recent[] }
  | { type: 'session'; session: SessionMsg }
  | { type: 'session_end'; id: string }
  | { type: 'event'; session: string; agent?: string; ev: { kind: AgentEventKind; tool?: string; target?: string; child?: string } }
  | ({ type: 'permission' } & Permission)
  | { type: 'permission_end'; id: number; approved?: boolean }
  | { type: 'part'; session: string; child: string }
  | { type: 'part_end'; child: string };

/** An event from before the page opened; `at` is wall-clock ms. */
type Recent = Extract<Msg, { type: 'event' }> & { at: number };

interface SessionMsg {
  id: string;
  folder: string;
  status: string;
}

interface Permission {
  id: number;
  session: string;
  folder?: string;
  agent?: string;
  tool: string;
  target?: string;
}

interface Session {
  folder: string;
  status: string;
  /** The musician this session played last (for work with no clear owner). */
  last: ChairId;
  /** Its sub-agents: tool-call id → second-chair musician id */
  kids: Map<string, string>;
}

export interface LiveStatus {
  connected: boolean;
  /** The page is served without the live server (e.g. a static build). */
  unavailable: boolean;
  sessions: number;
}

export class LiveSource extends Emitter<{ event: AgentEvent; status: LiveStatus }> {
  private sessions = new Map<string, Session>();
  /** musician id → the permission request it is waiting on */
  private waiting = new Map<string, number>();
  /** musician id → who sits there (its `session` shows the folder it last played for) */
  private infos = new Map<string, AgentInfo>();
  /** chair id → the session that last made it play (where a new part would start) */
  private lastSession = new Map<string, string>();
  /** A part handed out by the conductor: its session id → the second chair playing it */
  private parts = new Map<string, string>();
  /** Parts started but not seen yet: session id → the chair that was handed the part */
  private pendingParts = new Map<string, ChairId>();
  /** The musician a part is being handed to, until the server confirms it */
  private handing: ChairId | null = null;
  private source: EventSource | null = null;
  private seated = false;
  private paused = false;
  private connected = false;
  private failures = 0;
  /** Who plays which kind of work (from the mixer). */
  private cast: Record<Role, ChairId>;

  constructor(cast: Record<Role, ChairId> = { ...DEFAULT_CAST }) {
    super();
    this.cast = cast;
  }

  /** The routed musician for the usual cast, moved to whoever plays that role in this mix. */
  private routed(chair: ChairId | null, fallback: ChairId): ChairId {
    return chair ? this.cast[roleOf(DEFAULT_CAST, chair)] : fallback;
  }

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

  /** The conductor hands a musician a new part: a `claude -p` run in the folder that last made it play. */
  async task(musicianId: string, text: string): Promise<'ok' | 'busy' | 'error'> {
    const session =
      [...this.parts].find(([, m]) => m === musicianId)?.[0] ?? this.lastSession.get(musicianId) ?? [...this.sessions.keys()].pop();
    if (!session) return 'error';
    const parent = (this.infos.get(musicianId)?.parentId ?? musicianId) as ChairId;
    this.handing = parent;
    try {
      const r = await fetch('/__live/task', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session, task: text }) });
      return r.status === 202 ? 'ok' : r.status === 409 ? 'busy' : 'error';
    } catch {
      return 'error';
    }
  }

  private report() {
    // A static build has no live server: the stream fails before it ever opens.
    this.emit('status', { connected: this.connected, unavailable: !this.connected && this.failures > 2, sessions: this.sessions.size });
  }

  /** The whole band takes its seats once, as soon as the live server answers. */
  private seatAll() {
    if (this.seated) return;
    this.seated = true;
    for (const c of CHAIRS) {
      const info: AgentInfo = { id: c.id, name: c.name, role: roleOf(this.cast, c.id), instrument: DEFAULT_INSTRUMENT[c.role], session: '—' };
      this.infos.set(c.id, info);
      this.emit('event', makeEvent(c.id, 'subagent_join', { child: info, seated: true }));
    }
  }

  private session(id: string, folder = 'session', status = 'busy'): Session {
    let s = this.sessions.get(id);
    if (!s) {
      s = { folder, status, last: 'clara', kids: new Map() };
      this.sessions.set(id, s);
      this.report();
    }
    return s;
  }

  private onMsg(m: Msg) {
    switch (m.type) {
      case 'hello':
        this.connected = true;
        const first = !this.seated; // a reconnect would replay the same events again
        this.seatAll();
        for (const s of m.sessions) this.session(s.id, s.folder, s.status);
        if (first) for (const r of m.recent ?? []) this.replay(r);
        for (const p of m.permissions) this.ask(p);
        this.report();
        break;
      case 'session': {
        if (this.partFor(m.session.id)) break;
        const before = this.sessions.get(m.session.id)?.status;
        const s = this.session(m.session.id, m.session.folder, m.session.status);
        s.folder = m.session.folder;
        s.status = m.session.status;
        if (before === 'busy' && m.session.status === 'idle') this.play(m.session.id, s.last, 'task_done');
        break;
      }
      case 'session_end': {
        const part = this.parts.get(m.id);
        if (part) {
          this.parts.delete(m.id);
          this.leave(part);
          break;
        }
        const s = this.sessions.get(m.id);
        if (!s) break;
        for (const kid of s.kids.values()) this.leave(kid);
        this.sessions.delete(m.id);
        for (const [chair, sid] of this.lastSession) if (sid === m.id) this.lastSession.delete(chair);
        this.report();
        break;
      }
      case 'event':
        this.onEvent(m);
        break;
      case 'permission':
        this.ask(m);
        break;
      case 'part': {
        // the musician the part was handed to plays it on its second chair
        const chair = this.handing ?? this.sessions.get(m.session)?.last;
        this.handing = null;
        if (chair) this.pendingParts.set(m.child, chair);
        break;
      }
      case 'part_end':
        this.pendingParts.delete(m.child); // it never got going
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

  private onEvent(m: Extract<Msg, { type: 'event' }>) {
    const part = this.partFor(m.session);
    if (part) {
      if (this.paused || this.waiting.has(part) || m.ev.kind === 'subagent_join' || m.ev.kind === 'subagent_leave') return;
      return this.send(part, m.ev.kind, { tool: m.ev.tool, target: m.ev.target, session: this.folderOf(m.session) });
    }
    const s = this.session(m.session);
    if (this.paused) return;
    const { kind, tool, target, child } = m.ev;
    if (kind === 'subagent_join' && child) {
      const kid = this.join(s.last, target, m.session);
      if (kid) s.kids.set(child, kid);
      return;
    }
    if (kind === 'subagent_leave' && child) {
      const kid = s.kids.get(child);
      if (kid) {
        s.kids.delete(child);
        this.leave(kid);
      }
      return;
    }
    // a sub-agent's own work stays on its second chair
    const kid = m.agent ? s.kids.get(m.agent) : undefined;
    if (kid) {
      if (!this.waiting.has(kid)) this.send(kid, kind, { tool, target, session: s.folder });
      return;
    }
    this.play(m.session, this.routed(chairFor({ kind, tool, target }, null), s.last), kind, { tool, target });
  }

  /**
   * Write a past event into the programme and the score without playing it, so the
   * page doesn't start empty. Sub-agents that came and went are left out.
   */
  private replay(r: Recent) {
    const { kind, tool, target } = r.ev;
    if (kind === 'subagent_join' || kind === 'subagent_leave' || this.parts.has(r.session)) return;
    const s = this.session(r.session);
    const chair = this.routed(chairFor({ kind, tool, target }, null), s.last);
    s.last = chair;
    this.lastSession.set(chair, r.session);
    const at = performance.now() - Math.max(0, Date.now() - r.at);
    this.send(chair, kind, { tool, target, session: s.folder, replay: true, at });
  }

  /** A musician plays for a session. */
  private play(sessionId: string, chair: ChairId, kind: AgentEventKind, extra: Partial<AgentEvent> = {}) {
    const s = this.sessions.get(sessionId);
    if (s) s.last = chair;
    this.lastSession.set(chair, sessionId);
    const info = this.infos.get(chair);
    if (info && s) info.session = s.folder;
    if (this.waiting.has(chair)) return; // a musician holding the fermata doesn't play
    this.send(chair, kind, { ...extra, session: s?.folder });
  }

  /** The musician playing a part session, seating it as a second chair the first time. */
  private partFor(session: string): string | null {
    const have = this.parts.get(session);
    if (have) return have;
    const chair = this.pendingParts.get(session);
    if (!chair) return null;
    this.pendingParts.delete(session);
    const kid = this.join(chair, 'part', session);
    if (kid) this.parts.set(session, kid);
    return kid;
  }

  private folderOf(sessionId: string) {
    return this.sessions.get(sessionId)?.folder;
  }

  /** Seat a second chair next to `chair`. Returns its id, or null if that chair is taken. */
  private join(chair: ChairId, kind: string | undefined, sessionId: string): string | null {
    const id = `${chair}-2`;
    if (this.infos.has(id)) return null; // one second chair per musician fits on stage
    const parent = CHAIRS.find((c) => c.id === chair)!;
    const folder = this.folderOf(sessionId);
    const info: AgentInfo = {
      id,
      name: parent.second,
      role: roleOf(this.cast, chair),
      instrument: 'violin', // second chairs are the string section: a second piano wouldn't fit
      parentId: chair,
      session: folder ?? kind ?? 'sub-agent',
    };
    this.infos.set(id, info);
    this.send(chair, 'subagent_join', { child: info, tool: 'Agent', target: kind, session: folder });
    return id;
  }

  private leave(id: string) {
    const child = this.infos.get(id) ?? ({ id, name: '' } as AgentInfo);
    this.infos.delete(id);
    this.waiting.delete(id);
    this.emit('event', makeEvent(id, 'subagent_leave', { child }));
  }

  private ask(p: Permission) {
    const part = this.partFor(p.session);
    if (part) {
      this.waiting.set(part, p.id);
      return this.emit('event', makeEvent(part, 'permission_request', { tool: p.tool, target: p.target, session: this.folderOf(p.session) }));
    }
    // e.g. a `claude -p` run that never shows up in the session list
    const s = this.session(p.session, p.folder ?? 'session');
    const kid = p.agent ? s.kids.get(p.agent) : undefined;
    let who: string;
    if (kid) who = kid;
    else {
      const chair = this.routed(chairForTool(p.tool, p.target, null), s.last);
      s.last = chair;
      this.lastSession.set(chair, p.session);
      who = chair;
    }
    this.waiting.set(who, p.id);
    this.emit('event', makeEvent(who, 'permission_request', { tool: p.tool, target: p.target, session: s.folder }));
  }

  private send(agentId: string, kind: AgentEventKind, extra: Partial<AgentEvent> = {}) {
    this.emit('event', makeEvent(agentId, kind, extra));
  }
}
