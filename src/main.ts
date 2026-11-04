import './style.css';
import * as Tone from 'tone';
import { AudioEngine } from './audio/engine';
import type { AgentEvent, AgentInfo } from './core/events';
import { makeEvent } from './core/events';
import { DemoSimulator, DEMO_AGENTS } from './core/simulator';
import { applyStatic, getLang, onLang, setLang, t, type Lang } from './i18n';
import { Stage, type Seat } from './stage/stage';
import { W } from './stage/hall';
import { Score } from './ui/score';
import { Detail, Feed, TensionMeter } from './ui/panels';
import { Tour } from './ui/tour';

/** Where everyone sits, what they look like, which colour writes their part. */
const SEATS: Record<string, Seat> = {
  ines: { x: 78, y: 182, color: 0xffc36b, look: { skin: 0, hair: 'auburn', hairStyle: 'bun', outfit: 'dress', dress: [0x5ad49a, 0x2f9a68, 0x1f6a48, 0x144430] } },
  leo: { x: 46, y: 192, color: 0xffe9a6, look: { skin: 1, hair: 'brown', hairStyle: 'swept', outfit: 'tux' } },
  mira: { x: 132, y: 186, color: 0x8fd8ff, look: { skin: 2, hair: 'black', hairStyle: 'bob', outfit: 'dress', dress: [0x7aa8ff, 0x4a70d0, 0x2e4698, 0x1c2a60] } },
  clara: { x: 150, y: 128, color: 0xff8fb8, look: { skin: 1, hair: 'black', hairStyle: 'long', outfit: 'dress', dress: [0xd88ae0, 0xa050b0, 0x6e3080, 0x461a52] } },
  bruno: { x: 256, y: 186, color: 0xb9a2ff, look: { skin: 3, hair: 'black', hairStyle: 'short', outfit: 'tux', beard: true } },
  otto: { x: 302, y: 129, color: 0xff9b5a, look: { skin: 0, hair: 'blonde', hairStyle: 'curly', outfit: 'tux', glasses: true } },
};

const pan = (x: number) => Math.max(-0.85, Math.min(0.85, ((x - W / 2) / (W / 2)) * 0.95));
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

async function main() {
  applyStatic();
  const engine = new AudioEngine();
  const stage = new Stage();
  const sim = new DemoSimulator();
  const agents = new Map<string, AgentInfo>();
  const recent = new Map<string, AgentEvent[]>();
  const volumes = new Map<string, number>();
  const mutes = new Map<string, boolean>();

  await stage.init($('#stage'));
  const score = new Score($('#score'));
  const who = (id: string) => {
    const info = agents.get(id);
    return info ? { info, color: SEATS[id]?.color ?? 0xffffff } : undefined;
  };
  const feed = new Feed($('#feed'), who);
  const meter = new TensionMeter($('#gauge-fill'), $('#gauge-glow'), $('#tension-word'), $('#tension-spark'));
  const detail = new Detail($('#detail'));

  stage.beat = () => engine.beatPhase();
  stage.tension = () => ({ value: engine.tension, agent: engine.fermataAgent });

  const addAgent = (info: AgentInfo, walkIn = false) => {
    agents.set(info.id, info);
    const seat = SEATS[info.id];
    stage.addMusician(info, seat, { walkIn });
    engine.addVoice(info.id, info.instrument, pan(seat.x));
    score.addRow(info, seat.color);
  };
  for (const a of DEMO_AGENTS) addAgent(a);

  // ---- events flow: simulator → (sound + stage + feed)
  sim.on('event', (ev) => {
    if (ev.kind === 'subagent_join' && ev.child) addAgent(ev.child, true);
    engine.handle(ev);
    stage.onAgentEvent(ev);
    feed.add(ev);
    const list = recent.get(ev.agentId) ?? [];
    list.unshift(ev);
    recent.set(ev.agentId, list.slice(0, 20));
    if (ev.kind === 'subagent_leave' && ev.child) {
      const id = ev.child.id;
      stage.removeMusician(id);
      score.removeRow(id);
      engine.removeVoice(id, 4);
      setTimeout(() => agents.delete(id), 6000);
    }
    if (ev.kind === 'permission_request') showPermission(ev);
    if (detail.current) refreshDetail();
  });
  engine.on('note', (n) => {
    stage.onNote(n);
    score.note(n);
  });
  engine.on('bar', ({ chord }) => {
    score.bar();
    $('#chord').textContent = chord.name;
    $('#chord-line').classList.toggle('held', !!engine.fermataAgent);
  });

  // ---- the permission card (fermata)
  const perm = $('#permission');
  let permAgent: string | null = null;
  function showPermission(ev: AgentEvent) {
    permAgent = ev.agentId;
    const info = agents.get(ev.agentId)!;
    $('#perm-title').textContent = t('fermata.waiting', { name: info.name });
    $('#perm-tool').textContent = ev.tool ?? '';
    $('#perm-target').textContent = ev.target ?? '';
    setTimeout(() => (perm.hidden = false), 900);
  }
  function resolve(approved: boolean) {
    if (!permAgent) return;
    sim.resolvePermission(permAgent, approved);
    permAgent = null;
    perm.hidden = true;
  }
  $('#approve').onclick = () => resolve(true);
  $('#deny').onclick = () => resolve(false);
  window.addEventListener('keydown', (e) => {
    if (!permAgent || perm.hidden) return;
    if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
    if (e.key === 'Enter') resolve(true);
    if (e.key === 'Escape') resolve(false);
  });

  // ---- detail drawer
  const stateLabel = (id: string) => t(`state.${stage.stateOf(id) ?? 'idle'}`);
  const detailData = (id: string) => ({
    info: agents.get(id)!,
    color: SEATS[id]?.color ?? 0xffffff,
    state: stateLabel(id),
    children: [...agents.values()].filter((a) => a.parentId === id),
    recent: recent.get(id) ?? [],
    volume: volumes.get(id) ?? 0,
    muted: mutes.get(id) ?? false,
  });
  const refreshDetail = () => detail.current && agents.has(detail.current) && detail.refresh(detailData(detail.current));
  stage.onSelect = (id) => {
    if (id && agents.has(id)) detail.open(detailData(id));
    else detail.close();
  };
  detail.onClose = () => stage.select(null);
  detail.onVolume = (id, db) => {
    volumes.set(id, db);
    engine.setVoiceVolume(id, db);
  };
  detail.onMute = (id, m) => {
    mutes.set(id, m);
    engine.setVoiceMuted(id, m);
  };
  detail.onTask = (id) => {
    // Demo: the conductor hands over a new part; the musician starts reading it.
    const ev = makeEvent(id, 'file_read', { tool: 'Read', target: 'new-part.md' });
    sim.emit('event', ev);
    setTimeout(() => sim.emit('event', makeEvent(id, 'tool_start', { tool: 'TodoWrite', target: 'plan' })), 700);
  };
  setInterval(refreshDetail, 1000);

  // ---- top bar
  const master = $<HTMLInputElement>('#master');
  const paintMaster = () => master.style.setProperty('--v', `${Number(master.value) * 100}%`);
  paintMaster();
  master.oninput = () => {
    paintMaster();
    engine.setMasterVolume(Number(master.value));
  };
  const mute = $<HTMLButtonElement>('#mute');
  mute.onclick = () => {
    const m = mute.getAttribute('aria-pressed') !== 'true';
    mute.setAttribute('aria-pressed', String(m));
    mute.title = t(m ? 'top.unmute' : 'top.mute');
    engine.setMuted(m);
  };
  const paintLang = () => document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => b.classList.toggle('on', b.dataset.lang === getLang()));
  document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => (b.onclick = () => setLang(b.dataset.lang as Lang)));
  onLang(() => {
    applyStatic();
    paintLang();
    feed.rerender();
    if (detail.current) detail.open(detailData(detail.current));
    if (permAgent) $('#perm-title').textContent = t('fermata.waiting', { name: agents.get(permAgent)!.name });
    paintBegin();
    tour.refresh();
  });
  paintLang();
  document.documentElement.lang = getLang();

  // ---- the first-run tour
  // Each musician steps into the spotlight and plays a phrase in their own voice.
  const PHRASES: Record<string, Array<[AgentEvent['kind'], string, string, number]>> = {
    ines: [['tool_start', 'WebSearch', 'web audio', 0], ['tool_start', 'WebFetch', 'docs', 1300]],
    mira: [['file_read', 'Read', 'README.md', 0], ['file_read', 'Read', 'docs/setup.md', 700], ['file_write', 'Write', 'README.md', 1500]],
    clara: [['file_write', 'Edit', 'Stage.ts', 0], ['file_write', 'Edit', 'router.ts', 1300]],
    bruno: [['bash', 'Bash', 'npm run build', 0], ['bash', 'Bash', 'tsc --noEmit', 1300]],
    otto: [['test_pass', 'Bash', 'npm test', 0]],
  };
  let phraseTimers: number[] = [];
  const tour = new Tour({
    focus: (id) => stage.focus(id),
    stageRect: (id) => stage.screenRect(id),
    stageEl: $('#stage'),
    play: (id) => {
      for (const tm of phraseTimers) clearTimeout(tm);
      phraseTimers = (PHRASES[id] ?? []).map(([kind, tool, target, at]) =>
        window.setTimeout(() => {
          const ev = makeEvent(id, kind, { tool, target });
          engine.handle(ev);
          stage.onAgentEvent(ev);
        }, at + 250),
      );
    },
  });
  const TOURED = 'bytehoven.toured';
  const toured = () => {
    try {
      return localStorage.getItem(TOURED) === '1';
    } catch {
      return false;
    }
  };
  const markToured = () => {
    try {
      localStorage.setItem(TOURED, '1');
    } catch {
      /* private mode */
    }
  };
  const tourBtn = $<HTMLButtonElement>('#tour-btn');
  const runTour = () => {
    if (tour.isOpen || permAgent) return;
    detail.close();
    stage.select(null);
    const wasRunning = sim.isRunning;
    sim.setPaused(true);
    tour.start(() => {
      markToured();
      sim.setPaused(false);
      if (!wasRunning) sim.start();
    });
  };
  tourBtn.onclick = runTour;

  // ---- per-frame UI
  const tick = () => {
    const v = engine.tension;
    meter.update(v);
    perm.style.setProperty('--t', String(v));
    if (permAgent && !perm.hidden) {
      const p = stage.screenPos(permAgent);
      if (p) {
        // sit beside the musician so the raised hand and the fermata sign stay visible
        const right = p.x < perm.parentElement!.clientWidth * 0.62;
        perm.classList.toggle('to-left', !right);
        perm.style.left = `${p.x + (right ? 34 : -34)}px`;
        perm.style.top = `${p.y + 10}px`;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // ---- loading + the "Begin the concert" moment
  const begin = $<HTMLButtonElement>('#begin');
  let progress = 0;
  const paintBegin = () => {
    $('#begin-label').textContent = engine.ready ? t('start.button') : t('start.loading', { pct: Math.round(progress * 100) });
  };
  engine.on('progress', (p) => {
    progress = p;
    begin.style.setProperty('--p', `${p * 100}%`);
    paintBegin();
    tour.refresh();
  });
  paintBegin();
  await engine.load();
  engine.setMasterVolume(Number(master.value));
  begin.disabled = false;
  paintBegin();
  begin.focus();
  begin.onclick = async () => {
    begin.disabled = true;
    $('#start').classList.add('gone');
    stage.openCurtains(3.6);
    const untilDownbeat = await engine.startConcert();
    setTimeout(
      () => {
        tourBtn.disabled = false;
        if (toured()) sim.start();
        else runTour();
      },
      untilDownbeat * 1000 + (toured() ? 600 : 1400),
    );
  };
  // expose for debugging in the console
  Object.assign(window, { bytehoven: { engine, stage, sim, Tone } });
}

main();
