import en from './en.json';
import tr from './tr.json';

export type Lang = 'en' | 'tr';
type Dict = typeof en;

const dicts: Record<Lang, Dict> = { en, tr };

const stored = (() => {
  try {
    return localStorage.getItem('bytehoven.lang') as Lang | null;
  } catch {
    return null;
  }
})();

let lang: Lang = stored ?? (navigator.language?.toLowerCase().startsWith('tr') ? 'tr' : 'en');
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return lang;
}

export function setLang(l: Lang) {
  lang = l;
  try {
    localStorage.setItem('bytehoven.lang', l);
  } catch {
    /* private mode */
  }
  document.documentElement.lang = l;
  for (const fn of listeners) fn();
}

export function onLang(fn: () => void) {
  listeners.add(fn);
}

/** t('fermata.waiting', { name: 'Clara' }) */
export function t(key: string, vars: Record<string, string | number> = {}): string {
  const get = (d: unknown) => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], d);
  let s = (get(dicts[lang]) ?? get(dicts.en) ?? key) as string;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Fill every [data-i18n] element. */
export function applyStatic(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n!)));
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => (el.title = t(el.dataset.i18nTitle!)));
  root.querySelectorAll<HTMLElement>('[data-i18n-ph]').forEach((el) => ((el as HTMLInputElement).placeholder = t(el.dataset.i18nPh!)));
}
