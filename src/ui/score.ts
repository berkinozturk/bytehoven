import type { NoteInfo } from '../audio/engine';
import type { AgentInfo } from '../core/events';
import { t } from '../i18n';

/**
 * The live score: one staff per musician, scrolling right to left.
 * Notes are written the moment they sound, so the strip is a faithful
 * transcript of what you just heard.
 */

interface Row {
  info: AgentInfo;
  color: string;
  range: [number, number];
  y: number; // animated
  h: number; // animated height (0..1) for join/leave
  leaving: boolean;
}

interface Mark {
  agentId: string;
  t: number;
  kind: NoteInfo['kind'];
  midis: number[];
  vel: number;
  dur: number;
  end?: number; // for fermatas: when they resolved
  past?: boolean; // from before the page opened
}

const RANGES: Record<AgentInfo['instrument'], [number, number]> = {
  piano: [45, 90],
  violin: [60, 90],
  flute: [66, 96],
  contrabass: [26, 52],
  percussion: [30, 64],
};

const css = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export class Score {
  private ctx: CanvasRenderingContext2D;
  private rows: Row[] = [];
  private marks: Mark[] = [];
  private bars: number[] = [];
  private openFermata: Mark | null = null;
  private pxPerSec = 70;
  private w = 0;
  private h = 0;
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    window.addEventListener('resize', () => this.resize()); // also fires from the pop-out window
    this.resize();
    const loop = () => {
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
  }

  addRow(info: AgentInfo, color: number) {
    if (this.rows.some((r) => r.info.id === info.id)) return;
    const parentIdx = info.parentId ? this.rows.findIndex((r) => r.info.id === info.parentId) : -1;
    const row: Row = { info, color: css(color), range: RANGES[info.instrument], y: 0, h: info.parentId ? 0 : 1, leaving: false };
    if (parentIdx >= 0) this.rows.splice(parentIdx + 1, 0, row);
    else this.rows.push(row);
  }

  removeRow(id: string) {
    const r = this.rows.find((x) => x.info.id === id);
    if (r) r.leaving = true;
  }

  bar() {
    this.bars.push(performance.now() / 1000);
    if (this.bars.length > 40) this.bars.shift();
  }

  /**
   * Events from before the page opened, squeezed into the visible strip behind the
   * playhead (oldest on the left) and drawn faded, so the score never starts empty.
   */
  history(events: Array<{ agentId: string; kind: string }>) {
    if (!events.length) return;
    const now = performance.now() / 1000;
    const span = Math.max(1, ((this.w - 46 - 132) / this.pxPerSec) * 0.8);
    const step = Math.min(0.35, span / events.length);
    events.forEach((ev, i) => {
      const row = this.rows.find((r) => r.info.id === ev.agentId);
      if (!row) return;
      const [lo, hi] = row.range;
      const mid = Math.round((lo + hi) / 2) + ((i * 5) % 9) - 4;
      // failures stay red; everything else is a faded hollow note head
      const bad = ev.kind === 'test_fail' || ev.kind === 'error';
      const kind: NoteInfo['kind'] = bad ? 'test_fail' : 'file_read';
      this.marks.push({ agentId: ev.agentId, t: now - 0.4 - (events.length - i) * step, kind, midis: bad ? [mid, mid + 1] : [mid], vel: 0.4, dur: 0, past: true });
    });
  }

  note(n: NoteInfo) {
    const now = performance.now() / 1000;
    if (n.agentId.startsWith('__')) return;
    if (n.kind === 'permission_request' && n.index === 0) {
      const m: Mark = { agentId: n.agentId, t: now, kind: n.kind, midis: n.midis, vel: n.velocity, dur: 0 };
      this.openFermata = m;
      this.marks.push(m);
      return;
    }
    if (n.kind === 'resolve' && this.openFermata) {
      this.openFermata.end = now;
      this.openFermata = null;
    }
    this.marks.push({ agentId: n.agentId, t: now, kind: n.kind, midis: n.midis, vel: n.velocity, dur: n.duration });
    if (this.marks.length > 600) this.marks.splice(0, this.marks.length - 600);
  }

  private draw() {
    const { ctx, w, h, dpr } = this;
    const now = performance.now() / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const labelW = 132;
    const top = 34;
    const playX = w - 46;

    // rows: animate in/out
    for (const r of this.rows) r.h += ((r.leaving ? 0 : 1) - r.h) * 0.08;
    this.rows = this.rows.filter((r) => !(r.leaving && r.h < 0.02));
    const total = this.rows.reduce((s, r) => s + r.h, 0) || 1;
    const rowH = Math.min(30, (h - top - 10) / total);
    let y = top;
    const rowY = new Map<string, { y: number; h: number; row: Row }>();
    for (const r of this.rows) {
      rowY.set(r.info.id, { y, h: rowH * r.h, row: r });
      y += rowH * r.h;
    }

    // bar lines
    ctx.lineWidth = 1;
    for (const b of this.bars) {
      const x = playX - (now - b) * this.pxPerSec;
      if (x < labelW) continue;
      ctx.strokeStyle = 'rgba(232,196,124,0.10)';
      ctx.beginPath();
      ctx.moveTo(x + 0.5, top - 4);
      ctx.lineTo(x + 0.5, y);
      ctx.stroke();
    }

    // staffs + labels
    for (const { y: ry, h: rh, row } of rowY.values()) {
      if (rh < 4) continue;
      ctx.globalAlpha = Math.min(1, rh / rowH);
      const mid = ry + rh / 2;
      ctx.strokeStyle = 'rgba(232,196,124,0.08)';
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(labelW, Math.round(mid + k * rh * 0.22) + 0.5);
        ctx.lineTo(playX, Math.round(mid + k * rh * 0.22) + 0.5);
        ctx.stroke();
      }
      ctx.fillStyle = row.color;
      ctx.shadowColor = row.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(26 + (row.info.parentId ? 12 : 0), mid, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#efe4d2';
      ctx.font = '600 12px Inter, sans-serif';
      ctx.textBaseline = 'middle';
      const lx = 36 + (row.info.parentId ? 12 : 0);
      ctx.fillText(row.info.name, lx, mid - (rh > 22 ? 5 : 0));
      if (rh > 22) {
        ctx.fillStyle = '#8f7f72';
        ctx.font = '400 10.5px Inter, sans-serif';
        ctx.fillText(t(`instrument.${row.info.instrument}`), lx, mid + 8);
      }
      ctx.globalAlpha = 1;
    }

    // marks
    ctx.save();
    ctx.beginPath();
    ctx.rect(labelW, 0, playX - labelW + 4, h);
    ctx.clip();
    const keep = now - (playX - labelW) / this.pxPerSec - 4;
    const lastRun = new Map<string, { x: number; y: number }>();
    for (const m of this.marks) {
      if (m.t < keep && (!m.end || m.end < keep)) continue;
      const r = rowY.get(m.agentId);
      if (!r || r.h < 4) continue;
      const x = playX - (now - m.t) * this.pxPerSec;
      const color = r.row.color;
      const py = (midi: number) => {
        const [lo, hi] = r.row.range;
        const k = Math.max(0, Math.min(1, (midi - lo) / (hi - lo)));
        return r.y + r.h * (0.82 - k * 0.64);
      };
      const age = now - m.t;
      const fresh = m.past ? 0 : Math.max(0, 1 - age * 2.2);
      ctx.globalAlpha = Math.min(1, r.h / rowH) * (m.past ? 0.6 : 1);

      if (m.kind === 'permission_request') {
        const endX = m.end ? playX - (now - m.end) * this.pxPerSec : playX;
        const yy = r.y + r.h / 2;
        const tension = m.end ? 1 : Math.min(1, (now - m.t) / 20);
        const g = ctx.createLinearGradient(x, 0, endX, 0);
        g.addColorStop(0, 'rgba(232,196,124,0.9)');
        g.addColorStop(1, m.end ? 'rgba(255,140,80,0.9)' : `rgba(255,${Math.round(180 - tension * 100)},80,1)`);
        ctx.fillStyle = g;
        ctx.shadowColor = '#ffb46a';
        ctx.shadowBlur = 10 + tension * 14;
        const th = 4 + tension * 3;
        ctx.beginPath();
        ctx.roundRect(x, yy - th / 2, Math.max(4, endX - x), th, th / 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        // the fermata sign over the held note
        ctx.strokeStyle = '#f6dfa6';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(x + 8, yy - 6, 6, Math.PI, 0);
        ctx.stroke();
        ctx.fillStyle = '#f6dfa6';
        ctx.beginPath();
        ctx.arc(x + 8, yy - 7.5, 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 1;
        continue;
      }

      if (m.kind === 'test_fail' || m.kind === 'error') {
        ctx.fillStyle = '#ff4a4a';
        ctx.shadowColor = '#ff3030';
        ctx.shadowBlur = 14;
        for (const mi of m.midis) this.head(x, py(mi), 5, '#ff5a5a', true);
        for (const mi of m.midis) this.head(x + 3, py(mi) - 2, 4, '#ff8a6a', true);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#ff6a5a';
        ctx.beginPath();
        const ys = m.midis.map(py);
        ctx.moveTo(x - 6, Math.min(...ys) - 8);
        for (let k = 0; k < 4; k++) ctx.lineTo(x - 3 + k * 3, Math.min(...ys) - 8 + (k % 2 ? -3 : 3));
        ctx.stroke();
        continue;
      }

      if (m.kind === 'subagent_join') {
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, r.y + r.h / 2 - 5);
        ctx.lineTo(x + 5, r.y + r.h / 2);
        ctx.lineTo(x, r.y + r.h / 2 + 5);
        ctx.lineTo(x - 5, r.y + r.h / 2);
        ctx.closePath();
        ctx.stroke();
        continue;
      }

      if (m.kind === 'tuning' || !m.midis.length) {
        if (m.kind === 'tuning' || m.kind === 'bash' || m.kind === 'run' || m.kind === 'tool_start') {
          // unpitched: small ticks
          ctx.fillStyle = color;
          ctx.globalAlpha *= m.kind === 'tuning' ? 0.4 : 0.9;
          ctx.fillRect(x - 1, r.y + r.h * 0.4, 2, r.h * 0.2);
        }
        continue;
      }

      const hollow = m.kind === 'file_read';
      const size = m.kind === 'run' ? 2.6 : 3.6 + m.vel * 1.4;
      if (fresh > 0) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 6 + fresh * 16;
      }
      for (const mi of m.midis) this.head(x, py(mi), size, color, !hollow);
      ctx.shadowBlur = 0;
      // stems for motifs & chords; beams for runs
      const yTop = Math.min(...m.midis.map(py));
      if (m.kind === 'run') {
        const prev = lastRun.get(m.agentId);
        if (prev && x - prev.x < 12 && x > prev.x) {
          ctx.strokeStyle = color;
          ctx.globalAlpha *= 0.7;
          ctx.beginPath();
          ctx.moveTo(prev.x + 2, prev.y - 9);
          ctx.lineTo(x + 2, yTop - 9);
          ctx.stroke();
        }
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(x + 2, yTop);
        ctx.lineTo(x + 2, yTop - 9);
        ctx.stroke();
        lastRun.set(m.agentId, { x, y: yTop });
      } else if (m.kind !== 'file_read') {
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(x + size - 0.5, yTop);
        ctx.lineTo(x + size - 0.5, yTop - 11);
        ctx.stroke();
      }
      if (m.dur > 1 && m.kind !== 'run') {
        // a tail for long notes
        const len = Math.min(m.dur, age) * this.pxPerSec * 0.6;
        ctx.globalAlpha *= 0.35;
        ctx.fillStyle = color;
        for (const mi of m.midis) ctx.fillRect(x + size + 1, py(mi) - 1, len, 2);
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    // playhead
    const g = ctx.createLinearGradient(playX - 30, 0, playX + 2, 0);
    g.addColorStop(0, 'rgba(232,196,124,0)');
    g.addColorStop(1, 'rgba(232,196,124,0.10)');
    ctx.fillStyle = g;
    ctx.fillRect(playX - 30, top - 6, 32, y - top + 10);
    ctx.strokeStyle = 'rgba(246,223,166,0.75)';
    ctx.shadowColor = '#f6dfa6';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(playX + 0.5, top - 8);
    ctx.lineTo(playX + 0.5, y + 2);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // fade at the left edge
    const f = ctx.createLinearGradient(labelW, 0, labelW + 60, 0);
    f.addColorStop(0, 'rgba(14,8,11,1)');
    f.addColorStop(1, 'rgba(14,8,11,0)');
    ctx.fillStyle = f;
    ctx.fillRect(labelW, 0, 60, h);
  }

  private head(x: number, y: number, r: number, color: string, filled: boolean) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.35);
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 0.72, 0, 0, Math.PI * 2);
    if (filled) {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
    ctx.restore();
  }
}
