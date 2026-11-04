import type { SoundTheme } from './audio/sound-theme';
import { jazz } from './audio/themes/jazz';
import { lofi } from './audio/themes/lofi';
import { orchestra } from './audio/themes/orchestra';
import { jazzStage, lofiStage, orchestraStage, type StageTheme } from './stage/theme';

/** A theme is a band (its sound) on a stage (its look). */
export interface Theme {
  sound: SoundTheme;
  stage: StageTheme;
}

export const THEMES = {
  orchestra: { sound: orchestra, stage: orchestraStage },
  jazz: { sound: jazz, stage: jazzStage },
  lofi: { sound: lofi, stage: lofiStage },
} satisfies Record<string, Theme>;

export type ThemeId = keyof typeof THEMES;
/** Shown in the picker but not built yet. */
export const COMING = ['chiptune'] as const;

const KEY = 'bytehoven.theme';
const isTheme = (v: unknown): v is ThemeId => typeof v === 'string' && v in THEMES;

/** `?theme=jazz` wins, then the last choice, then the orchestra. */
export function chosenTheme(): ThemeId {
  const fromUrl = new URLSearchParams(location.search).get('theme');
  if (isTheme(fromUrl)) return fromUrl;
  try {
    const saved = localStorage.getItem(KEY);
    if (isTheme(saved)) return saved;
  } catch {
    /* private mode */
  }
  return 'orchestra';
}

/** Switching themes rebuilds the band, so the page reloads (keeping live mode). */
export function chooseTheme(id: ThemeId) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* private mode */
  }
  const url = new URL(location.href);
  url.searchParams.delete('theme');
  location.href = url.toString();
}
