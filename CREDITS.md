# Credits

Bytehoven is released under the MIT license (see `LICENSE`). Everything it ships
with is either our own work or licensed with **no non-commercial restriction**.

## Sounds

All instrument sounds in `public/samples/` are derived from
**VS Chamber Orchestra: Community Edition (VSCO 2 CE)** by
[Versilian Studios](https://vis.versilstudios.net/vsco-community.html),
recorded by Sam Gossner & Simon Dalzell, sample cutting by Elan Hickler / Soundemote.

- Source: <https://github.com/sgossner/VSCO-2-CE>
- License: **CC0 1.0 Universal** (public domain dedication), confirmed in the
  repository's `LICENSE` file. The library's readme permits use "for ANY
  purpose", asks for credit to Versilian Studios, and asks that the samples
  are not sold on their own. We honour both requests.

Instruments used: Upright Piano No. 1, Solo Violin (arco vibrato, spiccato,
pizzicato), Violin Section (sustain, tremolo), Cello Section (tremolo),
Solo Contrabass (pizzicato, sustain), Flute (staccato, sustain), Harp,
Glockenspiel, Timpani (hits, rolls), Snare and Bass Drum (VSCO 1 legacy set),
Suspended Cymbal, Crash Cymbal, Triangle.

How we changed them (`scripts/prepare-samples.mjs`): folded to mono, silence
before the attack removed, length capped with a fade-out, peak-normalised,
octave labels verified with a YIN pitch detector, encoded as 96 kbps MP3.

### Jazz club

- **Tenor saxophone**: from the **Versilian Community Sample Library (VCSL)** by
  Versilian Studios, <https://github.com/sgossner/VCSL>, **CC0 1.0** (repository licence).
- **Muted trumpet**: VSCO 2 CE (above), *Trumpet, straight mute*.
- **Drum kit** (ride, hi-hat, kick, snare, crash): **Virtuosity Drums** by Versilian Studios,
  <https://github.com/sfzinstruments/virtuosity_drums>, **CC0 1.0** (repository licence).
  The drum samples ship as FLAC; they were converted to WAV with macOS `afconvert`
  before the same processing as above.
- Piano and double bass are shared with the Orchestra.

### Lo-fi room

- **Upright piano** (*Upright Piano, Knight*, soft layer) and **vibraphone** (*Vibraphone, soft
  mallets*): **VCSL** (above), **CC0 1.0**.
- **Jazz guitar** (*Electric Guitar FSBS, jazz, bridge pickup*) and **bass guitar** (*Finger Bass YR*):
  **FreePats**, <https://freepats.zenvoid.org>, **CC0 1.0** (licence file in each bank).
  They ship as FLAC; converted to WAV with macOS `afconvert`, then processed as above.
- The drum kit is shared with the Jazz club.
- The vinyl crackle is generated in code (filtered noise and random clicks), not sampled.

### Chiptune arcade

- No samples: the pulse, triangle and noise channels and the drum hits are generated in code
  (`src/audio/chip.ts`), our own work.

## Pixel art

Every visual on stage — the hall, the organ, the curtains, the jazz club and
its neon sign, the lo-fi room, the arcade, the musicians, their instruments, the conductor and the
particles — is original pixel art
drawn procedurally in code (`src/stage/`). It is part of Bytehoven and licensed
under MIT. No third-party sprite packs are used.

## Fonts (self-hosted via Fontsource)

- **Cormorant Garamond** by Christian Thalmann — SIL Open Font License 1.1
- **Inter** by Rasmus Andersson — SIL Open Font License 1.1

## Libraries

| Package | License | Used for |
| --- | --- | --- |
| [PixiJS](https://pixijs.com) | MIT | stage rendering |
| [pixi-filters](https://github.com/pixijs/filters) | MIT | bloom |
| [Tone.js](https://tonejs.github.io) | MIT | audio engine |
| [Vite](https://vitejs.dev) | MIT | dev server & build |
| [TypeScript](https://www.typescriptlang.org) | Apache-2.0 | type checking |
| [@types/node](https://github.com/DefinitelyTyped/DefinitelyTyped) | MIT | **dev-only**: types for the live server code |
| [@breezystack/lamejs](https://github.com/breezystack/lamejs) | LGPL-3.0 | **dev-only**: encoding samples in `scripts/prepare-samples.mjs`; not part of the shipped app |
