import type { ChairId } from '../core/route';
import { t } from '../i18n';
import { short } from './token-format';

/** The box office drawer (live mode): today's tokens per musician, from the live server. */

interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}
interface Takings {
  date: string;
  messages: number;
  total: Tokens;
  chairs: Partial<Record<ChairId, Tokens>>;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const css = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export class BoxOfficePanel {
  onClose: () => void = () => {};
  private timer = 0;
  private last: Takings | null = null;
  private failed = false;

  constructor(
    private el: HTMLElement,
    /** Who sits in a chair: name, instrument label and colour. */
    private who: (chair: ChairId) => { name: string; label: string; color: number },
    /** The server counts for the usual cast; this moves a chair to whoever plays that role now. */
    private cast: (chair: ChairId) => ChairId,
  ) {}

  get isOpen() {
    return !this.el.hidden;
  }

  open() {
    this.el.hidden = false;
    this.render();
    void this.load();
    clearInterval(this.timer);
    this.timer = window.setInterval(() => void this.load(), 20_000);
  }

  close() {
    clearInterval(this.timer);
    this.el.hidden = true;
    this.onClose();
  }

  private async load() {
    try {
      const r = await fetch('/__live/box-office');
      if (!r.ok) throw new Error(String(r.status));
      this.last = await r.json();
      this.failed = false;
    } catch {
      this.failed = true;
    }
    if (this.isOpen) this.render();
  }

  render() {
    const d = this.last;
    const rows = new Map<ChairId, Tokens>();
    for (const [chair, tk] of Object.entries(d?.chairs ?? {}) as Array<[ChairId, Tokens]>) rows.set(this.cast(chair), tk);
    const body = !d
      ? `<div class="note">${esc(t(this.failed ? 'box.unavailable' : 'box.loading'))}</div>`
      : `<table class="box-table">
          <thead><tr><th></th><th>${esc(t('box.output'))}</th><th>${esc(t('box.input'))}</th><th class="dim">${esc(t('box.cacheRead'))}</th></tr></thead>
          <tbody>${[...rows]
            .sort((a, b) => b[1].output - a[1].output)
            .map(([chair, tk]) => {
              const w = this.who(chair);
              return `<tr><td><i style="background:${css(w.color)}"></i>${esc(w.name)}<small>${esc(w.label)}</small></td>
                <td>${short(tk.output)}</td><td>${short(tk.input + tk.cacheWrite)}</td><td class="dim">${short(tk.cacheRead)}</td></tr>`;
            })
            .join('')}</tbody>
          <tfoot><tr><td>${esc(t('box.total'))}</td><td>${short(d.total.output)}</td><td>${short(d.total.input + d.total.cacheWrite)}</td><td class="dim">${short(d.total.cacheRead)}</td></tr></tfoot>
        </table>
        ${rows.size ? '' : `<div class="note">${esc(t('box.empty'))}</div>`}
        <div class="note">${esc(t('box.note', { n: d.messages }))}</div>`;
    this.el.innerHTML = `
      <button class="close" aria-label="${esc(t('detail.close'))}">×</button>
      <div class="name"><span style="color:var(--ivory)">${esc(t('box.title'))}</span></div>
      <div class="sub">${esc(t('box.sub', { date: d?.date ?? '' }))}</div>
      ${body}`;
    this.el.querySelector<HTMLButtonElement>('.close')!.onclick = () => this.close();
  }
}
