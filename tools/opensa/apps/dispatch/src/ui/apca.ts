/**
 * APCA lightness contrast, and the thresholds a skin has to clear.
 *
 * This lived inside `theme.test.ts` until 201/7-10, which is exactly as long as the only thing being
 * measured was a preset we wrote ourselves. Once an embedding HOST can supply a palette, the same formula
 * has to run at runtime — and two copies of a contrast formula is the shape where a guard and the thing it
 * guards drift apart in silence. One implementation, used by the test and by the validator.
 *
 * The measure is APCA (Lc) rather than WCAG 2's ratio, for the reason `DESIGN.md` gives: WCAG 2.x is
 * symmetric and APCA is not, and a dark console is the polarity WCAG 2 gets wrong — it passes light-on-dark
 * pairs that are genuinely hard to read and fails pairs that are fine.
 *
 * The constants below are the published APCA 0.1.9 values with the spec's own names, so a number here can
 * be checked against the reference tool rather than trusted.
 */
import type { ConsoleTheme } from './theme';

/** Lc for primary text (ramp step 12) on any surface it is set on. */
export const LC_PRIMARY = 90;
/** Lc for secondary text (ramp step 11), and for the semantic text colours on their own fills. */
export const LC_SECONDARY = 60;

const TRC = 2.4;
const R_CO = 0.2126729;
const G_CO = 0.7151522;
const B_CO = 0.072175;
const NORM_BG = 0.56;
const NORM_TXT = 0.57;
const REV_TXT = 0.62;
const REV_BG = 0.65;
const BLK_THRS = 0.022;
const BLK_CLMP = 1.414;
const LO_CLIP = 0.1;
const DELTA_Y_MIN = 0.0005;
const SCALE = 1.14;
const LO_OFFSET = 0.027;

/** One text-on-surface pair a theme renders, named so a failure says which one broke. */
export interface ContrastPair {
  /** The Lc this pair has to clear. */
  readonly least: number;
  readonly on: string;
  readonly text: string;
  readonly what: string;
}

/** APCA lightness contrast, signed as the spec signs it. Callers compare its magnitude. */
export function apca(text: string, background: string): number {
  const clamp = (y: number): number => (y > BLK_THRS ? y : y + (BLK_THRS - y) ** BLK_CLMP);
  const txtY = clamp(luminance(text));
  const bgY = clamp(luminance(background));
  if (Math.abs(bgY - txtY) < DELTA_Y_MIN) {
    return 0;
  }
  if (bgY > txtY) {
    const sapc = (bgY ** NORM_BG - txtY ** NORM_TXT) * SCALE;

    return (sapc < LO_CLIP ? 0 : sapc - LO_OFFSET) * 100;
  }
  const sapc = (bgY ** REV_BG - txtY ** REV_TXT) * SCALE;

  return (sapc > -LO_CLIP ? 0 : sapc + LO_OFFSET) * 100;
}

/**
 * Every pair that is under its threshold, each as a sentence naming the pair and both numbers.
 *
 * Empty means the theme is readable everywhere it is set. This is what the test asserts and what the
 * runtime validator refuses a host's palette on, and they are the same call on purpose.
 */
export function contrastFailures(theme: ConsoleTheme): readonly string[] {
  return contrastPairs(theme).flatMap((pair) => {
    // An unmeasurable colour is a FAILURE, never a pass. `luminance` parses hex digits, so anything else —
    // `rebeccapurple`, an `rgba()`, a number — yields NaN, and `NaN < 60` is false: the pair would slip
    // through the guard silently, which is the one outcome a contrast guard may never have. Cheap to get
    // wrong and invisible when you do, so it is checked rather than assumed.
    const unreadable = [pair.text, pair.on].filter((colour) => !OPAQUE_HEX.test(colour));
    if (unreadable.length > 0) {
      return [`${pair.what}: ${unreadable.join(' and ')} is not an opaque #rrggbb`];
    }
    const lc = Math.round(Math.abs(apca(pair.text, pair.on)));

    return lc < pair.least ? [`${pair.what}: Lc ${lc}, wanted ${pair.least}`] : [];
  });
}

/**
 * What a MEASURED colour has to look like.
 *
 * Only the pairs are held to this. A theme may legitimately carry `rgba()` elsewhere — Night's `warnBg` is
 * one — because a colour nothing is written on never needs a luminance of its own.
 */
const OPAQUE_HEX = /^#[0-9a-f]{6}$/iu;

/** Every text-on-surface pair a theme actually renders. */
export function contrastPairs(theme: ConsoleTheme): readonly ContrastPair[] {
  const { accent, ramp, semantic } = theme;
  const surfaces: readonly (readonly [string, string])[] = [
    ['bg', ramp.bg],
    ['surface', ramp.surface],
    ['surfaceRaised', ramp.surfaceRaised],
    ['surfaceHover', ramp.surfaceHover],
    ['surfaceOn', ramp.surfaceOn],
  ];

  return [
    ...surfaces.map(([name, on]) => ({ least: LC_PRIMARY, on, text: ramp.text, what: `text on ${name}` })),
    ...surfaces.map(([name, on]) => ({ least: LC_SECONDARY, on, text: ramp.textMuted, what: `textMuted on ${name}` })),
    { least: LC_SECONDARY, on: accent.bg, text: accent.text, what: 'accent text on accent bg' },
    { least: LC_SECONDARY, on: ramp.surface, text: accent.solid, what: 'accent solid on surface' },
    { least: LC_SECONDARY, on: semantic.dangerBg, text: semantic.dangerText, what: 'danger text on danger bg' },
    { least: LC_SECONDARY, on: ramp.surface, text: semantic.danger, what: 'danger on surface' },
  ];
}

/**
 * Screen luminance of a `#rrggbb`.
 *
 * Alpha is not accepted and that is not an oversight: a translucent colour has no luminance of its own, so
 * a pair involving one cannot be measured without knowing what is behind it — which is why the console's
 * surfaces are opaque in the first place.
 */
export function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channel = (at: number): number => Number.parseInt(value.slice(at, at + 2), 16) / 255;

  return R_CO * channel(0) ** TRC + G_CO * channel(2) ** TRC + B_CO * channel(4) ** TRC;
}
