import './style.css';
import * as Tone from 'tone';
import { AudioEngine } from './audio/engine';
import type { AgentEvent, AgentInfo } from './core/events';
import { makeEvent } from './core/events';
import { DemoSimulator, DEMO_AGENTS, SUB_AGENT } from './core/simulator';
import { LiveSource } from './core/live';
import { applyStatic, getLang, onLang, setLang, setVariant, t, type Lang } from './i18n';
import { COMING, THEMES, chooseTheme, chosenTheme, type ThemeId } from './themes';
import { Stage, type Seat } from './stage/stage';
import { W } from './stage/hall';
import { Score } from './ui/score';
import { Detail, Feed, TensionMeter } from './ui/panels';
import { Tour } from './ui/tour';
import { canPopOut, popOut } from './ui/pip';

/** Where everyone sits, what they look like, which colour writes their part. */
const SEATS: Record<string, Seat> = {
  ines: { x: 78, y: 182, color: 0xffc36b, look: { skin: 0, hair: 'auburn', hairStyle: 'bun', outfit: 'dress', dress: [0x5ad49a, 0x2f9a68, 0x1f6a48, 0x144430] } },
  leo: { x: 46, y: 192, color: 0xffe9a6, look: { skin: 1, hair: 'brown', hairStyle: 'swept', outfit: 'tux' } },
  mira: { x: 132, y: 186, color: 0x8fd8ff, look: { skin: 2, hair: 'black', hairStyle: 'bob', outfit: 'dress', dress: [0x7aa8ff, 0x4a70d0, 0x2e4698, 0x1c2a60] } },
  clara: { x: 150, y: 128, color: 0xff8fb8, look: { skin: 1, hair: 'black', hairStyle: 'long', outfit: 'dress', dress: [0xd88ae0, 0xa050b0, 0x6e3080, 0x461a52] } },
  bruno: { x: 256, y: 186, color: 0xb9a2ff, look: { skin: 3, hair: 'black', hairStyle: 'short', outfit: 'tux', beard: true } },
  otto: { x: 302, y: 129, color: 0xff9b5a, look: { skin: 0, hair: 'blonde', hairStyle: 'curly', outfit: 'tux', glasses: true } },
};

/** Second chairs in live mode sit next to their musician (violinists, like Leo). */
const SECOND_CHAIRS: Record<string, { x: number; y: number }> = {
  'ines-2': { x: 46, y: 192 },
  'clara-2': { x: 112, y: 130 },
  'otto-2': { x: 268, y: 131 },
  'mira-2': { x: 104, y: 194 },
  'bruno-2': { x: 222, y: 192 },
};
function secondChair(info: AgentInfo): Seat {
  const parent = SEATS[info.parentId ?? ''] ?? SEATS.leo;
  const at = SECOND_CHAIRS[info.id] ?? { x: parent.x - 30, y: parent.y + 6 };
  return { ...SEATS.leo, ...at, color: parent.color };
}

/** What the page needs from an event source: the demo simulator or live Claude Code sessions. */
interface Source {
  on(type: 'event', fn: (e: AgentEvent) => void): () => void;
  emit(type: 'event', e: AgentEvent): void;
  start(): void;
  resolvePermission(agentId: string, approved: boolean): void;
  setPaused(p: boolean): void;
  readonly isRunning: boolean;
}

const LIVE = new URLSearchParams(location.search).has('live');
if (LIVE) document.querySelector('[data-i18n="start.note"]')?.setAttribute('data-i18n', 'start.liveNote');

const pan = (x: number) => Math.max(-0.85, Math.min(0.85, ((x - W / 2) / (W / 2)) * 0.95));
// Query inside #app rather than `document`: the app can move into a pop-out window.
const appRoot = document.getElementById('app')!;
const $ = <T extends HTMLElement>(sel: string) => appRoot.querySelector<T>(sel)!;

const THEME = chosenTheme();
setVariant(THEME === 'orchestra' ? null : THEME);

async function main() {
  applyStatic();
  const engine = new AudioEngine(THEMES[THEME].sound);
  const stage = new Stage(THEMES[THEME].stage);
  document.documentElement.dataset.theme = THEME;
  $('.tempo').textContent = `♩ = ${THEMES[THEME].sound.bpm}`;
  const live = LIVE ? new LiveSource() : null;
  const sim: Source = live ?? new DemoSimulator();
  document.documentElement.classList.toggle('live', LIVE);
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
    const seat = (SEATS[info.id] ??= secondChair(info));
    stage.addMusician(info, seat, { walkIn });
    engine.addVoice(info.id, info.instrument, pan(seat.x));
    score.addRow(info, seat.color);
  };
  if (!LIVE) for (const a of DEMO_AGENTS) addAgent(a);

  // ---- events flow: simulator → (sound + stage + feed)
  sim.on('event', (ev) => perform(ev));
  /** Everything an event does: sound, stage, programme, drawer, permission card. */
  function perform(ev: AgentEvent) {
    if (ev.kind === 'subagent_join' && ev.child) {
      if (agents.has(ev.child.id)) return; // a chair being refilled before its musician left
      addAgent(ev.child, !ev.seated);
    }
    engine.handle(ev);
    stage.onAgentEvent(ev);
    if (!ev.seated) feed.add(ev); // the band taking its seats isn't news
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
    // the tour's signal lesson plays a fermata without the card
    if (ev.kind === 'permission_request' && !tour.isOpen) showPermission(ev);
    if (ev.kind === 'permission_resolved' && ev.agentId === permAgent) {
      // answered somewhere else (in Claude Code itself)
      permAgent = null;
      perm.hidden = true;
    }
    if (detail.current) refreshDetail();
  }
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
    $('#perm-from').textContent = ev.session ?? '';
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
  if (live) {
    detail.taskNote = 'detail.liveNote';
    detail.onTask = async (id, text) => {
      const r = await live.task(id, text);
      detail.flash(t(r === 'ok' ? 'detail.taskSent' : r === 'busy' ? 'detail.taskBusy' : 'detail.taskFailed'));
    };
  } else detail.onTask = (id) => {
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
  // ---- theme picker
  const themePick = $<HTMLSelectElement>('#theme');
  const paintThemes = () => {
    themePick.innerHTML = '';
    for (const id of [...(Object.keys(THEMES) as ThemeId[]), ...COMING]) {
      const o = document.createElement('option');
      o.value = id;
      o.disabled = (COMING as readonly string[]).includes(id);
      o.textContent = o.disabled ? `${t(`theme.${id}`)} · ${t('theme.soon')}` : t(`theme.${id}`);
      themePick.append(o);
    }
    themePick.value = THEME;
    $('#theme-name').textContent = t(`theme.${THEME}`);
  };
  paintThemes();
  themePick.onchange = () => chooseTheme(themePick.value as ThemeId);

  const paintLang = () => appRoot.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => b.classList.toggle('on', b.dataset.lang === getLang()));
  appRoot.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => (b.onclick = () => setLang(b.dataset.lang as Lang)));
  onLang(() => {
    applyStatic();
    if (appRoot.ownerDocument !== document) applyStatic(appRoot.ownerDocument);
    paintThemes();
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
  // The signal lesson: who plays each signal, and what they "do".
  const SIGNALS: Record<string, [string, Partial<AgentEvent>]> = {
    file_read: ['mira', { tool: 'Read', target: 'README.md' }],
    file_write: ['clara', { tool: 'Edit', target: 'app.ts' }],
    bash: ['bruno', { tool: 'Bash', target: 'npm run build' }],
    thinking: ['ines', {}],
    test_fail: ['otto', { tool: 'Bash', target: 'npm test' }],
    test_pass: ['otto', { tool: 'Bash', target: 'npm test' }],
    subagent_join: ['ines', { tool: 'Agent', child: SUB_AGENT }],
    task_done: ['mira', {}],
    permission_request: ['clara', { tool: 'Bash', target: 'git push' }],
  };
  let lessonTimers: number[] = [];
  let lessonLeo = false;
  /** End whatever the last signal left behind (a held fermata, Leo on stage). */
  const stopLesson = () => {
    for (const tm of lessonTimers) clearTimeout(tm);
    lessonTimers = [];
    if (engine.fermataAgent) perform(makeEvent(engine.fermataAgent, 'permission_resolved', { approved: true }));
    if (lessonLeo) perform(makeEvent('ines', 'subagent_leave', { child: SUB_AGENT }));
    lessonLeo = false;
  };
  const playSignal = (kind: string) => {
    stopLesson();
    const later = (ms: number, fn: () => void) => lessonTimers.push(window.setTimeout(fn, ms));
    const [who, extra] = SIGNALS[kind];
    stage.focus(who);
    if (kind === 'subagent_join') {
      if (agents.has(SUB_AGENT.id)) return void engine.handle(makeEvent(who, 'subagent_join', extra)); // Leo is already on stage: just the sound
      perform(makeEvent(who, 'subagent_join', extra));
      lessonLeo = true;
      later(6000, () => {
        lessonLeo = false;
        perform(makeEvent(who, 'subagent_leave', { child: SUB_AGENT }));
      });
    } else if (kind === 'permission_request') {
      perform(makeEvent(who, 'permission_request', extra));
      later(4500, () => perform(makeEvent(who, 'permission_resolved', { approved: true })));
    } else perform(makeEvent(who, kind as AgentEvent['kind'], extra));
    later(kind === 'permission_request' ? 6500 : 3200, () => tour.isOpen && stage.focus(null));
  };

  const tour = new Tour({
    signal: playSignal,
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
  tourBtn.hidden = LIVE; // the tour introduces the demo orchestra
  const runTour = () => {
    if (tour.isOpen || permAgent || pipWin) return;
    detail.close();
    stage.select(null);
    const wasRunning = sim.isRunning;
    sim.setPaused(true);
    tour.start(() => {
      stopLesson();
      markToured();
      sim.setPaused(false);
      if (!wasRunning) sim.start();
    });
  };
  tourBtn.onclick = runTour;

  // ---- pop-out: an always-on-top mini window (Document Picture-in-Picture)
  let pipWin: Window | null = null;
  const popBtn = $<HTMLButtonElement>('#popout');
  popBtn.hidden = !canPopOut();
  popBtn.onclick = async () => {
    if (pipWin) return pipWin.close();
    if (tour.isOpen) return;
    const ok = await popOut(appRoot, {
      opened: (win) => {
        pipWin = win;
        stage.listenOn(win);
        popBtn.hidden = true;
        tourBtn.disabled = true;
      },
      closed: () => {
        pipWin = null;
        popBtn.hidden = false;
        tourBtn.disabled = !$('#start').classList.contains('gone');
      },
      placeholder: () => {
        const el = document.createElement('div');
        el.className = 'pip-away';
        const p = document.createElement('p');
        p.textContent = t('pip.away');
        const back = document.createElement('button');
        back.className = 'btn gold';
        back.textContent = t('pip.back');
        back.onclick = () => pipWin?.close();
        el.append(p, back);
        return el;
      },
    });
    if (!ok) popBtn.hidden = true; // the browser can't open the window after all
  };

  // ---- per-frame UI
  const tick = () => {
    const v = engine.tension;
    meter.update(v);
    perm.style.setProperty('--t', String(v));
    if (permAgent && !perm.hidden) {
      const p = stage.screenPos(permAgent);
      // narrow panels: dock the card at the bottom of the stage instead
      const docked = perm.parentElement!.clientWidth < 600;
      perm.classList.toggle('docked', docked);
      if (p && !docked) {
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
    if (live) return void setTimeout(() => sim.start(), untilDownbeat * 1000 + 300);
    setTimeout(
      () => {
        tourBtn.disabled = false;
        if (toured() || pipWin) sim.start(); // no tour inside the mini window
        else runTour();
      },
      untilDownbeat * 1000 + (toured() ? 600 : 1400),
    );
  };
  // ---- live mode: say so when the stage is empty or the live server is missing
  const liveNote = $('#live-note');
  live?.on('status', (st) => {
    const key = st.unavailable ? 'live.unavailable' : st.connected && st.sessions === 0 ? 'live.empty' : '';
    liveNote.hidden = !key;
    if (key) {
      const text = $('#live-note-text');
      text.dataset.i18n = key; // so a language switch re-translates it
      text.textContent = t(key);
    }
  });

  // expose for debugging in the console
  Object.assign(window, { bytehoven: { engine, stage, sim, Tone } });
}

main();
