import type { AgentEvent, AgentInfo } from '../core/events';
import { getLang, t } from '../i18n';

const css = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

interface FeedItem {
  ev: AgentEvent;
  li: HTMLLIElement;
}

/** The "programme": a running list of what each musician just did. */
export class Feed {
  private items: FeedItem[] = [];
  constructor(
    private el: HTMLOListElement,
    private who: (id: string) => { info: AgentInfo; color: number } | undefined,
  ) {
    this.renderEmpty();
    setInterval(() => this.tickTimes(), 1000);
  }

  private renderEmpty() {
    if (!this.items.length) this.el.innerHTML = `<li class="empty">${esc(t('side.empty'))}</li>`;
  }

  add(ev: AgentEvent) {
    if (ev.kind === 'thinking' && Math.random() < 0.6) return; // keep the list readable
    const w = this.who(ev.agentId);
    if (!w) return;
    if (!this.items.length) this.el.innerHTML = '';
    const li = document.createElement('li');
    li.className =
      ev.kind === 'permission_request' ? 'alert' : ev.kind === 'test_fail' || ev.kind === 'error' ? 'bad' : ev.kind === 'test_pass' || (ev.kind === 'permission_resolved' && ev.approved) ? 'good' : '';
    li.innerHTML = this.html(ev, w.info, w.color);
    this.el.prepend(li);
    this.items.unshift({ ev, li });
    while (this.items.length > 40) this.items.pop()!.li.remove();
  }

  rerender() {
    for (const it of this.items) {
      const w = this.who(it.ev.agentId);
      if (w) it.li.innerHTML = this.html(it.ev, w.info, w.color);
    }
    this.renderEmpty();
  }

  private html(ev: AgentEvent, info: AgentInfo, color: number) {
    const child = ev.child?.name ?? '';
    let what: string;
    // a live session taking or leaving its own chair (not a sub-agent)
    const self = ev.child?.id === ev.agentId;
    if (ev.kind === 'permission_resolved') what = t(ev.approved ? 'event.approved' : 'event.denied');
    else if (self && ev.kind === 'subagent_join') what = t('event.arrived', { session: ev.child!.session });
    else if (self && ev.kind === 'subagent_leave') what = t('event.departed');
    else what = t(`event.${ev.kind}`, { child });
    const showTarget = ev.target && !['subagent_join', 'subagent_leave', 'thinking', 'idle'].includes(ev.kind);
    const tool = ev.tool && ['tool_start'].includes(ev.kind) ? `${esc(ev.tool)} ` : '';
    const target = showTarget ? `${tool}<code>${esc(ev.target!)}</code>` : ev.kind === 'tool_start' && ev.tool ? `<code>${esc(ev.tool)}</code>` : '';
    const verb = `<span class="what">${esc(what)}</span>`;
    // Turkish puts the verb last: "Otto npm test çalıştırdı"
    const body = target ? (getLang() === 'tr' ? `${target} ${verb}` : `${verb} ${target}`) : verb;
    return `<span class="dot" style="color:${css(color)}"></span>
      <span><span class="who">${esc(info.name)}</span> ${body}</span>
      <span class="when" data-at="${ev.at}">${esc(t('ago.now'))}</span>`;
  }

  private tickTimes() {
    const now = performance.now();
    this.el.querySelectorAll<HTMLElement>('.when').forEach((el) => {
      const s = Math.round((now - Number(el.dataset.at)) / 1000);
      el.textContent = s < 2 ? t('ago.now') : t('ago.s', { n: s });
    });
  }
}

/** Tension gauge + a sparkline of the last minute. */
export class TensionMeter {
  private history: number[] = [];
  private ctx: CanvasRenderingContext2D;
  private last = 0;
  constructor(
    private fill: HTMLElement,
    private glow: HTMLElement,
    private word: HTMLElement,
    private spark: HTMLCanvasElement,
  ) {
    this.ctx = spark.getContext('2d')!;
  }

  update(v: number) {
    const pct = Math.round(v * 100);
    this.fill.style.width = `${Math.max(0, pct)}%`;
    this.glow.style.left = `${pct}%`;
    this.glow.style.opacity = String(Math.min(1, v * 2));
    this.word.textContent = v < 0.05 ? t('side.calm') : v < 0.6 ? t('side.rising') : t('side.held');
    const now = performance.now();
    if (now - this.last > 250) {
      this.last = now;
      this.history.push(v);
      if (this.history.length > 240) this.history.shift();
      this.drawSpark();
    }
  }

  private drawSpark() {
    const { ctx, spark } = this;
    const w = spark.width,
      h = spark.height;
    ctx.clearRect(0, 0, w, h);
    const n = 240;
    const step = w / (n - 1);
    const off = n - this.history.length;
    ctx.beginPath();
    this.history.forEach((v, i) => {
      const x = (off + i) * step,
        y = h - 4 - v * (h - 10);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    const g = ctx.createLinearGradient(0, h, 0, 0);
    g.addColorStop(0, 'rgba(232,196,124,0.6)');
    g.addColorStop(1, 'rgba(255,90,60,1)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(255,170,100,0.8)';
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineTo(w, h);
    ctx.lineTo(off * step, h);
    ctx.closePath();
    const f = ctx.createLinearGradient(0, 0, 0, h);
    f.addColorStop(0, 'rgba(255,140,80,0.22)');
    f.addColorStop(1, 'rgba(255,140,80,0)');
    ctx.fillStyle = f;
    ctx.fill();
  }
}

export interface DetailData {
  info: AgentInfo;
  color: number;
  state: string;
  children: AgentInfo[];
  recent: AgentEvent[];
  volume: number;
  muted: boolean;
}

/** The musician detail drawer. */
export class Detail {
  current: string | null = null;
  /** Show the "hand them a new part" box. */
  tasks = true;
  /** What the note under the task box says. */
  taskNote = 'detail.demoNote';
  onVolume: (id: string, db: number) => void = () => {};
  onMute: (id: string, m: boolean) => void = () => {};
  onTask: (id: string, text: string) => void = () => {};
  onClose: () => void = () => {};

  constructor(private el: HTMLElement) {}

  open(d: DetailData) {
    this.current = d.info.id;
    this.el.hidden = false;
    const recent = d.recent
      .filter((e) => e.target)
      .slice(0, 7)
      .map((e) => `<li>${esc(e.tool ?? '')} <code>${esc(e.target!)}</code></li>`)
      .join('');
    this.el.innerHTML = `
      <button class="close" aria-label="${esc(t('detail.close'))}">×</button>
      <div class="name" style="color:${css(d.color)}"><i></i><span style="color:var(--ivory)">${esc(d.info.name)}</span></div>
      <div class="sub">${esc(t(`instrument.${d.info.instrument}`))} · ${esc(t(`role.${d.info.role}`))}</div>
      <dl>
        <dt>${esc(t('detail.state'))}</dt><dd class="st">${esc(d.state)}</dd>
        <dt>${esc(t('detail.session'))}</dt><dd>${esc(d.info.session)}</dd>
        <dt>${esc(t('detail.subagents'))}</dt><dd class="kids">${d.children.length ? d.children.map((c) => esc(c.name)).join(', ') : esc(t('detail.none'))}</dd>
      </dl>
      <h3>${esc(t('detail.recent'))}</h3>
      <ul class="recent">${recent || `<li>${esc(t('detail.none'))}</li>`}</ul>
      <h3>${esc(t('detail.volume'))}</h3>
      <div class="row">
        <input type="range" class="vol" min="-24" max="6" step="1" value="${d.volume}" />
        <label class="row" style="gap:6px;color:var(--dim)"><input type="checkbox" class="mute" ${d.muted ? 'checked' : ''}/> ${esc(t('detail.mute'))}</label>
      </div>
      ${
        this.tasks
          ? `<h3>${esc(t('detail.task', { name: d.info.name }))}</h3>
      <textarea class="task" placeholder="${esc(t('detail.taskPh'))}"></textarea>
      <div class="note">${esc(t(this.taskNote))}</div>
      <button class="btn gold send">${esc(t('detail.send'))}</button>`
          : ''
      }
    `;
    const vol = this.el.querySelector<HTMLInputElement>('.vol')!;
    const paint = () => vol.style.setProperty('--v', `${((Number(vol.value) + 24) / 30) * 100}%`);
    paint();
    vol.oninput = () => {
      paint();
      this.onVolume(d.info.id, Number(vol.value));
    };
    this.el.querySelector<HTMLInputElement>('.mute')!.onchange = (e) => this.onMute(d.info.id, (e.target as HTMLInputElement).checked);
    this.el.querySelector<HTMLButtonElement>('.close')!.onclick = () => this.close(true);
    const ta = this.el.querySelector<HTMLTextAreaElement>('.task');
    if (!ta) return;
    this.el.querySelector<HTMLButtonElement>('.send')!.onclick = () => {
      if (!ta.value.trim()) return ta.focus();
      this.onTask(d.info.id, ta.value);
      ta.value = '';
    };
  }

  /** Replace the note under the task box for a moment (e.g. "part handed over"). */
  flash(text: string) {
    const note = this.el.querySelector<HTMLElement>('.note');
    if (!note) return;
    note.textContent = text;
    note.classList.add('flash');
    setTimeout(() => {
      note.classList.remove('flash');
      note.textContent = t(this.taskNote);
    }, 5000);
  }

  refresh(d: DetailData) {
    if (this.current !== d.info.id) return;
    const st = this.el.querySelector('.st');
    if (st) st.textContent = d.state;
    const kids = this.el.querySelector('.kids');
    if (kids) kids.textContent = d.children.length ? d.children.map((c) => c.name).join(', ') : t('detail.none');
    const recent = this.el.querySelector('.recent');
    if (recent)
      recent.innerHTML =
        d.recent
          .filter((e) => e.target)
          .slice(0, 7)
          .map((e) => `<li>${esc(e.tool ?? '')} <code>${esc(e.target!)}</code></li>`)
          .join('') || `<li>${esc(t('detail.none'))}</li>`;
  }

  close(notify = false) {
    this.current = null;
    this.el.hidden = true;
    if (notify) this.onClose();
  }
}
