import type { AgentEventKind } from '../core/events';
import { CHAIRS, DEFAULT_CAST, MIXABLE, ROLES, parseMix, recast, type Mix } from '../core/mixer';
import type { ChairId } from '../core/route';
import { t } from '../i18n';

/** The mixer drawer: who plays which kind of work, and which events make a sound. */

const KEY = 'bytehoven.mix';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function loadMix(): Mix {
  try {
    return parseMix(localStorage.getItem(KEY));
  } catch {
    return parseMix(null); // private mode
  }
}

function saveMix(m: Mix) {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* private mode: the mix lasts until reload */
  }
}

export class MixerPanel {
  /** Silenced events change at once. */
  onSilent: (kinds: AgentEventKind[]) => void = () => {};
  onClose: () => void = () => {};
  /** The cast as the page was loaded with (a new cast needs a reload). */
  private loaded: Mix['cast'];

  constructor(
    private el: HTMLElement,
    private mix: Mix,
    /** "Clara · Piano", in the current theme. */
    private label: (chair: ChairId) => string,
  ) {
    this.loaded = { ...mix.cast };
  }

  get isOpen() {
    return !this.el.hidden;
  }

  open() {
    this.el.hidden = false;
    this.render();
  }

  close() {
    this.el.hidden = true;
    this.onClose();
  }

  private render() {
    const { cast, silent } = this.mix;
    const changed = ROLES.some((r) => cast[r] !== this.loaded[r]);
    const castRows = ROLES.map(
      (r) => `<label class="mix-row"><span>${esc(t(`role.${r}`))}</span>
        <select data-role="${r}">${CHAIRS.map((c) => `<option value="${c}" ${cast[r] === c ? 'selected' : ''}>${esc(this.label(c))}</option>`).join('')}</select></label>`,
    ).join('');
    const eventRows = MIXABLE.map(
      (k) => `<label class="mix-check"><input type="checkbox" data-kind="${k}" ${silent.includes(k) ? '' : 'checked'}/> ${esc(t(`mixer.ev.${k}`))}</label>`,
    ).join('');
    this.el.innerHTML = `
      <button class="close" aria-label="${esc(t('detail.close'))}">×</button>
      <div class="name"><span style="color:var(--ivory)">${esc(t('mixer.title'))}</span></div>
      <div class="sub">${esc(t('mixer.sub'))}</div>
      <h3>${esc(t('mixer.cast'))}</h3>
      <div class="mix-cast">${castRows}</div>
      ${changed ? `<div class="note">${esc(t('mixer.reloadNote'))}</div><button class="btn gold apply">${esc(t('mixer.apply'))}</button>` : ''}
      <h3>${esc(t('mixer.events'))}</h3>
      <div class="mix-events">${eventRows}</div>
      <div class="note">${esc(t('mixer.note'))}</div>
      <button class="btn ghost reset">${esc(t('mixer.reset'))}</button>
    `;
    this.el.querySelector<HTMLButtonElement>('.close')!.onclick = () => this.close();
    this.el.querySelectorAll<HTMLSelectElement>('select[data-role]').forEach((sel) => {
      sel.onchange = () => {
        this.mix.cast = recast(this.mix.cast, sel.dataset.role as keyof Mix['cast'], sel.value as ChairId);
        saveMix(this.mix);
        this.render();
      };
    });
    this.el.querySelectorAll<HTMLInputElement>('input[data-kind]').forEach((box) => {
      box.onchange = () => {
        const kind = box.dataset.kind as AgentEventKind;
        this.mix.silent = MIXABLE.filter((k) => (k === kind ? !box.checked : this.mix.silent.includes(k)));
        saveMix(this.mix);
        this.onSilent(this.mix.silent);
      };
    });
    this.el.querySelector<HTMLButtonElement>('.apply')?.addEventListener('click', () => location.reload());
    this.el.querySelector<HTMLButtonElement>('.reset')!.onclick = () => {
      this.mix = { cast: { ...DEFAULT_CAST }, silent: [] };
      saveMix(this.mix);
      this.onSilent([]);
      this.render();
    };
  }
}
