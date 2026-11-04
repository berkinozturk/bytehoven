import { t } from '../i18n';

/**
 * The first-run tour: a short, skippable walk through the stage.
 * Each musician steps into the spotlight and plays a phrase, so you learn
 * what every instrument sounds like before the agents start working.
 */

type Target =
  | { kind: 'center' }
  | { kind: 'stage'; id: string } // a musician, or '__conductor'
  | { kind: 'el'; sel: string; side: 'left' | 'top' };

interface Step {
  key: string;
  target: Target;
  /** Musician to spotlight on stage while this step is open. */
  focus?: string;
  /** Called when the step opens (e.g. let the musician play). */
  enter?: () => void;
}

export interface TourHooks {
  focus: (id: string | null) => void;
  /** Screen rect of a musician / the conductor, relative to the stage canvas. */
  stageRect: (id: string) => { x: number; y: number; w: number; h: number } | null;
  stageEl: HTMLElement;
  play: (id: string) => void;
}

const FERMATA_SVG = `<svg viewBox="0 0 32 20" aria-hidden="true"><path d="M3 16 C 3 4, 29 4, 29 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="16" cy="14" r="2.4" fill="currentColor"/></svg>`;

export class Tour {
  private root: HTMLDivElement;
  private ring: HTMLDivElement;
  private card: HTMLDivElement;
  private steps: Step[];
  private i = 0;
  private open = false;
  private raf = 0;
  private onDone: () => void = () => {};
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);

  constructor(private hooks: TourHooks) {
    this.root = document.createElement('div');
    this.root.className = 'tour';
    this.root.hidden = true;
    this.ring = document.createElement('div');
    this.ring.className = 'tour-ring';
    this.card = document.createElement('div');
    this.card.className = 'tour-card';
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-live', 'polite');
    this.root.append(this.ring, this.card);
    document.body.appendChild(this.root);

    const m = (id: string): Step => ({ key: id, target: { kind: 'stage', id }, focus: id, enter: () => hooks.play(id) });
    this.steps = [
      { key: 'welcome', target: { kind: 'center' } },
      m('ines'),
      m('mira'),
      m('clara'),
      m('bruno'),
      m('otto'),
      { key: 'conductor', target: { kind: 'stage', id: '__conductor' } },
      { key: 'score', target: { kind: 'el', sel: '.score', side: 'top' } },
      { key: 'fermata', target: { kind: 'el', sel: '.tension', side: 'left' } },
      { key: 'feed', target: { kind: 'el', sel: '.feed', side: 'left' } },
      { key: 'end', target: { kind: 'center' } },
    ];
  }

  get isOpen() {
    return this.open;
  }

  start(onDone: () => void = () => {}) {
    this.onDone = onDone;
    this.open = true;
    this.root.hidden = false;
    this.i = 0;
    window.addEventListener('keydown', this.keyHandler, true);
    this.show();
    const loop = () => {
      this.place();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Re-render the open step (after a language change). */
  refresh() {
    if (this.open) this.show(false);
  }

  private finish() {
    this.open = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.keyHandler, true);
    this.hooks.focus(null);
    this.root.classList.add('leaving');
    setTimeout(() => {
      this.root.hidden = true;
      this.root.classList.remove('leaving');
    }, 350);
    this.onDone();
  }

  private go(d: number) {
    const n = this.i + d;
    if (n < 0) return;
    if (n >= this.steps.length) return this.finish();
    this.i = n;
    this.show();
  }

  private onKey(e: KeyboardEvent) {
    if (!this.open) return;
    if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowRight' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      this.go(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.go(-1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.finish();
    }
  }

  private show(animate = true) {
    const step = this.steps[this.i];
    const last = this.i === this.steps.length - 1;
    const first = this.i === 0;
    this.hooks.focus(step.focus ?? null);
    if (animate) step.enter?.();
    const dots = this.steps.map((_, k) => `<i class="${k === this.i ? 'on' : k < this.i ? 'done' : ''}"></i>`).join('');
    const icon = step.key === 'fermata' || first || last ? `<div class="tour-icon">${FERMATA_SVG}</div>` : '';
    this.card.innerHTML = `
      ${icon}
      <div class="tour-count">${this.i + 1} / ${this.steps.length}</div>
      <h3>${t(`tour.${step.key}.title`)}</h3>
      <p>${t(`tour.${step.key}.body`)}</p>
      <div class="tour-dots">${dots}</div>
      <div class="tour-actions">
        ${last ? '' : `<button class="tour-skip">${t('tour.skip')}</button>`}
        <span class="grow"></span>
        ${first ? '' : `<button class="btn ghost tour-back">${t('tour.back')}</button>`}
        <button class="btn gold tour-next">${last ? t('tour.done') : first ? t('tour.start') : t('tour.next')}</button>
      </div>`;
    this.card.querySelector<HTMLButtonElement>('.tour-next')!.onclick = () => this.go(1);
    this.card.querySelector<HTMLButtonElement>('.tour-back')?.addEventListener('click', () => this.go(-1));
    this.card.querySelector<HTMLButtonElement>('.tour-skip')?.addEventListener('click', () => this.finish());
    if (animate) {
      this.card.classList.remove('pop');
      void this.card.offsetWidth;
      this.card.classList.add('pop');
    }
    this.card.querySelector<HTMLButtonElement>('.tour-next')!.focus({ preventScroll: true });
    this.place();
  }

  /** Position the ring and the card every frame (the camera moves). */
  private place() {
    const step = this.steps[this.i];
    const vw = window.innerWidth,
      vh = window.innerHeight;
    const cw = this.card.offsetWidth,
      ch = this.card.offsetHeight;
    let ring: { x: number; y: number; w: number; h: number } | null = null;
    let cx: number, cy: number;
    const target = step.target;
    if (target.kind === 'stage') {
      const r = this.hooks.stageRect(target.id);
      const s = this.hooks.stageEl.getBoundingClientRect();
      if (r) {
        const pad = 10;
        ring = { x: s.left + r.x - pad, y: s.top + r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
        // keep the ring inside the stage
        ring.y = Math.max(s.top + 6, ring.y);
        ring.h = Math.min(s.bottom - 6 - ring.y, ring.h);
      }
    } else if (target.kind === 'el') {
      const el = document.querySelector<HTMLElement>(target.sel);
      if (el) {
        const b = el.getBoundingClientRect();
        ring = { x: b.left + 6, y: b.top + 6, w: b.width - 12, h: b.height - 12 };
      }
    }
    if (ring) {
      this.ring.classList.remove('none');
      Object.assign(this.ring.style, { left: `${ring.x}px`, top: `${ring.y}px`, width: `${ring.w}px`, height: `${ring.h}px` });
      const side = target.kind === 'el' ? target.side : ring.x + ring.w + cw + 32 < vw ? 'right' : 'left';
      if (side === 'top') {
        cx = Math.min(vw - cw - 16, Math.max(16, ring.x + 40));
        cy = ring.y - ch - 18;
      } else if (side === 'right') {
        cx = ring.x + ring.w + 18;
        cy = ring.y + ring.h / 2 - ch / 2;
      } else {
        cx = ring.x - cw - 18;
        cy = ring.y + ring.h / 2 - ch / 2;
      }
    } else {
      this.ring.classList.add('none');
      const s = this.hooks.stageEl.getBoundingClientRect();
      Object.assign(this.ring.style, { left: `${s.left + s.width / 2}px`, top: `${s.top + s.height / 2}px`, width: '0px', height: '0px' });
      cx = s.left + s.width / 2 - cw / 2;
      cy = s.top + s.height / 2 - ch / 2;
    }
    cx = Math.max(12, Math.min(vw - cw - 12, cx));
    cy = Math.max(12, Math.min(vh - ch - 12, cy));
    this.card.style.transform = `translate(${Math.round(cx)}px, ${Math.round(cy)}px)`;
  }
}
