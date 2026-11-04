import type { InstrumentId } from '../core/events';
import { NEON, NEON_BLUE, TABLES, drawClub, drawClubAudience, drawClubDrapes } from './club';
import type { Look } from './figures';
import { drawAudience, drawClosedCurtain, drawFrontDrapes, drawHall, W } from './hall';
import { Drummer, Saxophonist, Trumpeter } from './jazz-figures';
import { BassGuitarist, Guitarist, UprightPianist, Vibraphonist } from './lofi-figures';
import { Bassist, Pianist, makeFigure, type Figure } from './musicians';
import type { PixelCanvas } from './pixel';
import { CUSHIONS, LAMP, WIN, WINDOW_GLOW, drawRoom, drawRoomAudience, drawRoomFront } from './room';

/** What the stage looks like: the room, what is in front of the band, and who plays each chair. */
export interface StageTheme {
  backdrop(): PixelCanvas;
  /** Drawn in front of the musicians (curtains, pillars, lights). */
  front(): PixelCanvas;
  curtain(side: 'left' | 'right'): PixelCanvas;
  audience(): PixelCanvas;
  /** Additive glows: [x, y, scale, tint, alpha]. */
  glows: Array<readonly [number, number, number, number, number]>;
  figure(instrument: InstrumentId, look: Look): Figure;
  /** Tint of the spotlights. */
  light: number;
}

export const orchestraStage: StageTheme = {
  backdrop: drawHall,
  front: drawFrontDrapes,
  curtain: drawClosedCurtain,
  audience: drawAudience,
  // warm sconce glows and a faint organ halo
  glows: [
    [64, 58, 0.9, 0xffb86a, 0.75],
    [W - 64, 58, 0.9, 0xffb86a, 0.75],
    [192, 60, 3.2, 0xffd59a, 0.12],
  ],
  figure: makeFigure,
  light: 0xffd9a0,
};

export const jazzStage: StageTheme = {
  backdrop: drawClub,
  front: drawClubDrapes,
  curtain: drawClosedCurtain,
  audience: drawClubAudience,
  glows: [
    // the neon sign, its fermata, the wall lamps
    [W / 2, 33, 2.6, NEON, 0.32],
    [W / 2, 19, 0.9, NEON_BLUE, 0.35],
    [70, 60, 0.8, 0xffc070, 0.7],
    [W - 70, 60, 0.8, 0xffc070, 0.7],
    // string lights
    ...[8, 24, 40, 56].flatMap((o) => [0, 64, 128, 192, 256, 320].map((h) => [h + o, 10, 0.32, 0xffd890, 0.5] as const)),
    // candles on the tables
    ...TABLES.map((x) => [x, 201, 0.5, 0xffb050, 0.75] as const),
  ],
  figure(instrument, look) {
    switch (instrument) {
      case 'violin':
        return new Saxophonist(look);
      case 'flute':
        return new Trumpeter(look);
      case 'percussion':
        return new Drummer(look);
      case 'contrabass':
        return new Bassist(look);
      case 'piano':
        return new Pianist(look);
    }
  },
  light: 0xffc890,
};

export const lofiStage: StageTheme = {
  backdrop: drawRoom,
  front: drawRoomFront,
  curtain: drawClosedCurtain,
  audience: drawRoomAudience,
  glows: [
    // the window and the moon, the floor lamp, the cushions catching it
    [(WIN.x0 + WIN.x1) / 2, (WIN.y0 + WIN.y1) / 2, 3.4, WINDOW_GLOW, 0.22],
    [WIN.x1 - 30, WIN.y0 + 15, 0.7, 0xfff2d0, 0.4],
    [W - 24, 80, 1.6, LAMP, 0.55],
    ...CUSHIONS.map((x) => [x, 206, 0.6, LAMP, 0.18] as const),
  ],
  figure(instrument, look) {
    switch (instrument) {
      case 'violin':
        return new Guitarist(look);
      case 'flute':
        return new Vibraphonist(look);
      case 'percussion':
        return new Drummer(look);
      case 'contrabass':
        return new BassGuitarist(look);
      case 'piano':
        return new UprightPianist(look);
    }
  },
  light: 0xffb8a0,
};
