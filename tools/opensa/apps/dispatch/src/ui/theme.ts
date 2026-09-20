/**
 * The console's skins, and the rule about what a skin is allowed to be.
 *
 * Asked for 2026-08-26 ("разные стили как у SonoranCAD"). SonoranCAD ships four operator-selectable themes
 * over one fixed screen, and it is the right idea executed in the expensive way: four hand-written skins,
 * one of which (`trevor`) fills a whole row with the status colour and drops its text contrast through the
 * floor. Four skins is four times the surface on which that can happen, and nothing there checks it.
 *
 * So a theme here is **data, not a fork**, and three things follow.
 *
 * **1. A theme is the INPUT to `styles.ts`, never a copy of it.** It carries the neutral ramp, the accent,
 * the two semantic surfaces, the shadows and a font stack — nothing else. Every one of them is emitted as a
 * CSS custom property, so switching a skin is one attribute on the app root: **no re-render, no restyle
 * pass through React**, which is the whole reason the colours left the TypeScript objects.
 *
 * **2. What a theme may NOT touch.** Target sizes (`TOUCH_TARGET` is not a taste), the layout, the dock,
 * and — the important one — **`map/beacons.ts` → `SET_COLORS`**. Those are the colours the engine draws
 * pillars with, and the lists, the radar, the labels and the header tallies all read the same table so a
 * chip cannot drift from the pin. A theme that repainted statuses would break exactly the agreement that
 * table exists to keep. (A colour-vision-safe status palette is a real and wanted thing, and it is NOT a
 * theme for this reason — see the note at the bottom of this file.)
 *
 * **3. A theme cannot ship with broken contrast.** `theme.test.ts` runs every preset through APCA and fails
 * the build below the thresholds `DESIGN.md` already declares — Lc 90 for primary text, Lc 60 for
 * secondary. That is what makes five skins cost less risk than SonoranCAD's four.
 */
import type { JsonStorage } from '../map/storage';

import { readJson, STORAGE_KEYS, writeJson } from '../map/storage';
import { readView } from '../map/view-link';
import { contrastFailures } from './apca';

export interface ConsoleTheme {
  readonly accent: ThemeAccent;
  /**
   * How tight the rows are. The density lever, and the ONLY one — it moves row padding and the two
   * row-level type steps together, because a row's height is its padding PLUS its type step and moving one
   * without the other cannot reach a grid as tight as Mark43's.
   */
  readonly density: ThemeDensity;
  /** The font stacks. A skin that changes the typeface changes its character more than any colour does. */
  readonly font: { readonly mono: string; readonly sans: string };
  readonly id: ThemeId;
  /**
   * Tells the browser which way round to render the parts we do not draw — scrollbar gutters, form control
   * internals, the range track. Getting this wrong paints light chrome onto a dark surface.
   */
  readonly mode: 'dark' | 'light';
  readonly name: string;
  /**
   * Ink for text sitting ON a status fill. The same value in every skin on purpose: `SET_COLORS` is not
   * themed, so the colour underneath does not change, and neither may the thing written on it.
   */
  readonly onStatus: string;
  readonly ramp: ThemeRamp;
  readonly semantic: ThemeSemantic;
  readonly shadow: { readonly float: string; readonly modal: string };
  /** How a surface is told apart from what is under it, and how sharp its corners are. */
  readonly shape: ThemeShape;
  /**
   * What floats over the map, and it is **opaque**.
   *
   * These were step 3 at 92 % and the modal at 97 % until 2026-08-26, and the translucency was the single
   * biggest reason the console read as a generated dashboard rather than as an instrument: a panel you can
   * see the world through is a glassy card, and it also makes 11-px text sit on whatever happens to be
   * under it. An instrument's panel is a solid thing bolted over the display.
   */
  readonly surfaces: { readonly float: string; readonly modal: string };
}

/**
 * What a density step actually moves, and the list is deliberately short.
 *
 * A row's height is its padding PLUS the type step inside it, so `rowPadding` alone cannot reach a grid as
 * tight as Mark43's — it runs out while the text still holds the row open. These three move together and
 * **nothing else does**: never `TOUCH_TARGET` (WCAG 2.5.5, not a taste), never `input` (15 px is the floor
 * below which iOS zooms the page on focus), never the title.
 */
export interface DensitySteps {
  /** `TEXT.body` — what a row's own line is set in. */
  readonly body: number;
  /** `TEXT.caption` — the label above it and the meta beside it. */
  readonly caption: number;
  readonly rowPadding: string;
}

/** The accent, which means one thing: the operator's own mark — selection, focus, live, the primary action. */
export interface ThemeAccent {
  readonly bg: string;
  readonly border: string;
  readonly solid: string;
  readonly text: string;
}

export type ThemeDensity = 'comfortable' | 'compact' | 'dense';

export type ThemeId = 'amber' | 'contrast' | 'day' | 'mark43' | 'night';

/**
 * The three steps. `compact` is what the console has always shipped, so the values here are the ones that
 * were already in `styles.ts` — this table did not get to re-tune the console while adding a lever to it.
 */
const DENSITY: Readonly<Record<ThemeDensity, DensitySteps>> = {
  comfortable: { body: 13, caption: 12, rowPadding: '7px 11px' },
  compact: { body: 12, caption: 11, rowPadding: '5px 9px' },
  dense: { body: 11, caption: 10, rowPadding: '4px 8px' },
};

/**
 * The neutral ramp, by Radix's step roles — the same ten values `styles.ts` documents, now per theme.
 * Names are the roles, not the numbers, because a theme author needs to know what a step is FOR.
 */
export interface ThemeRamp {
  /** 1 — the world, and what the map draws onto. */
  readonly bg: string;
  /** 6 — separators inside one surface. */
  readonly line: string;
  /** 7 — the edge of an interactive component. */
  readonly lineStrong: string;
  /** 8 — strong border, and the focus ring. */
  readonly ring: string;
  /** 2 — docked surfaces: the panels and the three bars. */
  readonly surface: string;
  /** 4 — hover. */
  readonly surfaceHover: string;
  /** 5 — active or selected. */
  readonly surfaceOn: string;
  /** 3 — components: rows, inputs, and everything floating over the map. */
  readonly surfaceRaised: string;
  /** 12 — primary text. */
  readonly text: string;
  /** 11 — secondary text. */
  readonly textMuted: string;
}

/** The two surfaces that are neither neutral nor accent: a warning we are standing in, and a danger. */
export interface ThemeSemantic {
  readonly danger: string;
  readonly dangerBg: string;
  readonly dangerText: string;
  readonly warnBg: string;
  readonly warnBorder: string;
  readonly warnSolid: string;
  readonly warnText: string;
}

/**
 * How a surface is told apart from what is under it — the layer a palette cannot carry.
 *
 * Added 2026-08-30 for the Mark43 preset (201/7-10), which is not expressible in colour alone: its surfaces
 * are separated by a visible line and cast nothing, ours by a value step and a shadow. Both are legitimate
 * depth strategies and the difference is structural, so it is a token rather than a fork of the style table.
 */
export interface ThemeShape {
  /**
   * `'line'` drops both shadows to `none` and leaves the hairline to do the separating; `'shadow'` keeps
   * the shadows the preset declares.
   *
   * **There is no `--os-edge-width` to go with this, and the plan asked for one.** It would be 1 px in
   * every preset we ship: our floating surfaces have always carried a hairline BESIDE their shadow, so the
   * symmetric reading of `edge: 'shadow'` — a 0-px border — would restyle four shipped skins to make a
   * token look like a lever. A constant that never varies is a token that lies about being one.
   */
  readonly edge: 'line' | 'shadow';
  readonly radius: { readonly control: number; readonly pill: number; readonly surface: number };
}

/**
 * The density a preset actually gets, which is not always the one it asked for.
 *
 * **`dense` is refused where the pointer is coarse**, and this is the whole point of the function existing
 * rather than the table being read directly. A skin is chosen on a desk and travels to the same operator's
 * phone through one `localStorage` key, and nothing on that path re-asks the question — so a desk-chosen
 * `dense` would land 10-px text on a phone. That is a
 * [cross-platform-surface](../../../../docs/restrictions/cross-platform-surface.md) violation of the exact
 * kind that file exists for: it typechecks, it lints, every test stays green and it looks perfect on the
 * machine that chose it. Clamping here makes it unrepresentable instead of reviewable.
 *
 * Note what the clamp protects and what it does not have to: the phone's own row (`styles.rowTouch`) carries
 * `minHeight: TOUCH_TARGET` and its own padding, so 44 px is already true by construction whatever this
 * returns. What travels is the TYPE, inside a row that stays 44 px tall while its text shrinks — which is
 * why the guard measures the steps and not only the height.
 */
export function resolveDensity(density: ThemeDensity, coarsePointer: boolean): DensitySteps {
  return DENSITY[coarsePointer && density === 'dense' ? 'compact' : density];
}

const SANS = 'ui-sans-serif, system-ui, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/**
 * **Night** — the shift theme, and the default. Cool slate at hue ~213, built dark-first.
 *
 * This is the palette the console shipped with and the one every other preset is measured against; it is
 * first in the list because a dispatcher who never opens the switcher must get the best one.
 */
const NIGHT: ConsoleTheme = {
  accent: { bg: '#0c2634', border: '#1d5b7d', solid: '#38bdf8', text: '#6fd0fb' },
  density: 'compact',
  font: { mono: MONO, sans: SANS },
  id: 'night',
  mode: 'dark',
  name: 'Night',
  onStatus: '#06090d',
  ramp: {
    bg: '#070a0f',
    line: '#222f40',
    lineStrong: '#2b3a4d',
    ring: '#3a4d64',
    surface: '#0b111a',
    surfaceHover: '#16202e',
    surfaceOn: '#1b2736',
    surfaceRaised: '#111a26',
    text: '#e8eff7',
    textMuted: '#a8bbd0',
  },
  semantic: {
    danger: '#ff92a6',
    dangerBg: '#4a1220',
    dangerText: '#ffb3c0',
    warnBg: 'rgba(92, 56, 6, 0.94)',
    warnBorder: '#a9701f',
    warnSolid: '#ffb454',
    warnText: '#ffe8c4',
  },
  shadow: { float: '0 4px 16px rgba(0, 0, 0, 0.45)', modal: '0 12px 40px rgba(0, 0, 0, 0.6)' },
  shape: { edge: 'shadow', radius: { control: 2, pill: 2, surface: 0 } },
  surfaces: { float: '#111a26', modal: '#16202e' },
};

/**
 * **Day** — a phone outdoors, which is the one condition a dark console genuinely cannot serve.
 *
 * Not an inversion of Night. Inverting a dark ramp breaks the depth rule this console took from IBM Carbon
 * — in the dark each added layer is one step LIGHTER, and in the light it is one step DARKER — so the light
 * ramp is built in its own direction and the layering still reads.
 */
const DAY: ConsoleTheme = {
  accent: { bg: '#dbedf6', border: '#7fb6cf', solid: '#0b6f95', text: '#07536f' },
  density: 'compact',
  font: { mono: MONO, sans: SANS },
  id: 'day',
  mode: 'light',
  name: 'Day',
  onStatus: '#06090d',
  ramp: {
    bg: '#f2f5f9',
    line: '#ccd7e3',
    lineStrong: '#b4c2d2',
    ring: '#7f95ad',
    surface: '#ffffff',
    surfaceHover: '#e6ecf4',
    surfaceOn: '#dee7f1',
    surfaceRaised: '#f7f9fc',
    text: '#0d1620',
    textMuted: '#46586b',
  },
  semantic: {
    danger: '#c31d38',
    dangerBg: '#ffe1e5',
    dangerText: '#7e0f22',
    warnBg: 'rgba(255, 243, 212, 0.96)',
    warnBorder: '#c2942c',
    warnSolid: '#8a5900',
    warnText: '#523500',
  },
  shadow: { float: '0 4px 16px rgba(15, 23, 32, 0.16)', modal: '0 12px 40px rgba(15, 23, 32, 0.26)' },
  shape: { edge: 'shadow', radius: { control: 2, pill: 2, surface: 0 } },
  surfaces: { float: '#ffffff', modal: '#ffffff' },
};

/**
 * **Contrast** — a bad screen, bright sun, or eyes that have worked a long shift.
 *
 * Pure black ground and pure white text, and the mid steps pushed apart so a border is visible rather than
 * implied. This is the preset that exists because a console is used for eight hours, not looked at.
 */
const CONTRAST: ConsoleTheme = {
  accent: { bg: '#06304a', border: '#4aa8d4', solid: '#6cd6ff', text: '#b3eaff' },
  density: 'compact',
  font: { mono: MONO, sans: SANS },
  id: 'contrast',
  mode: 'dark',
  name: 'Contrast',
  onStatus: '#06090d',
  ramp: {
    bg: '#000000',
    line: '#3d4a5a',
    lineStrong: '#59697c',
    ring: '#96abc2',
    surface: '#0a0d12',
    surfaceHover: '#1c232d',
    surfaceOn: '#28323f',
    surfaceRaised: '#12171f',
    text: '#ffffff',
    textMuted: '#c8d6e4',
  },
  semantic: {
    danger: '#ff9dac',
    dangerBg: '#5e0f1e',
    dangerText: '#ffd6dd',
    warnBg: 'rgba(122, 76, 8, 0.97)',
    warnBorder: '#dda23a',
    warnSolid: '#ffcb72',
    warnText: '#fff2da',
  },
  shadow: { float: '0 4px 16px rgba(0, 0, 0, 0.7)', modal: '0 12px 40px rgba(0, 0, 0, 0.85)' },
  shape: { edge: 'shadow', radius: { control: 2, pill: 2, surface: 0 } },
  surfaces: { float: '#0a0d12', modal: '#12171f' },
};

/**
 * **Amber** — the identity slot, and the tightest of the four.
 *
 * SonoranCAD's four skins exist because its customer is a server owner who wants the console to be *theirs*;
 * that is a real want and this is where it is served. Warm near-black with a monospace chrome and a row
 * padding two pixels tighter — the same lever SonoranCAD's `mike19` pulls, and the reason that one reads as
 * a working instrument rather than a product.
 */
const AMBER: ConsoleTheme = {
  accent: { bg: '#3a2708', border: '#9a7526', solid: '#ffc247', text: '#ffd98a' },
  density: 'dense',
  font: { mono: MONO, sans: MONO },
  id: 'amber',
  mode: 'dark',
  name: 'Amber',
  onStatus: '#06090d',
  ramp: {
    bg: '#0a0806',
    line: '#3a2e1d',
    lineStrong: '#4d3d26',
    ring: '#6d5836',
    surface: '#130f0a',
    surfaceHover: '#241c12',
    surfaceOn: '#2f2517',
    surfaceRaised: '#1b150d',
    text: '#f8eed6',
    textMuted: '#cbb894',
  },
  semantic: {
    danger: '#ffa19c',
    dangerBg: '#4d1414',
    dangerText: '#ffc7c2',
    warnBg: 'rgba(104, 45, 6, 0.95)',
    warnBorder: '#c96a22',
    warnSolid: '#ff8a3c',
    warnText: '#ffdfc6',
  },
  shadow: { float: '0 4px 16px rgba(0, 0, 0, 0.55)', modal: '0 12px 40px rgba(0, 0, 0, 0.7)' },
  shape: { edge: 'shadow', radius: { control: 2, pill: 2, surface: 0 } },
  surfaces: { float: '#1b150d', modal: '#241c12' },
};

/**
 * **Mark43** — the field preset, and the one that made the token contract grow (201/7-10).
 *
 * Read off the vendor's own product screenshot on 2026-08-28 (`Mark43CAD.pdf` page 2, 1071x549), because
 * the best-designed CAD in the surveyed field turned out to be this console's own direction arrived at
 * independently: square, opaque, ornament-free, and dark. Two things make it a different skin rather than a
 * recolour of Night, and both are structural:
 *
 * **1. The ramp is ACHROMATIC and it starts much lighter.** R, G and B within a couple of levels on every
 * step, against Night's cool slate at hue ~213; the ground is `#1e1f21` — 18.9 % of every pixel on their
 * screen — where Night's is `#070a0f`.
 *
 * **2. Depth is a LINE, not a value step and a shadow.** Ground to panel is about 10/255 on their screen and
 * there is no shadow anywhere; the `#333` separator does the work our layering and `shadow.float` do. That
 * is `shape.edge: 'line'`, and it is the layer a palette could not carry before this preset existed.
 *
 * **What is measured and what is fitted, stated because the difference matters.** The ground, the panel and
 * the separator are the source's own values, sampled from flat regions. The steps between them are FITTED:
 * a literal luminance sort of their swatches is not monotone — their grid rows measure below their ground —
 * and our layering rule is, so the ramp continues the measured span instead of copying an ordering our
 * roles cannot express. **The text is fitted and not sampled at all**, per the step's own procedure: text in
 * a resampled JPEG is blended with what is under it, and the source's contrast is not evidence that it
 * passes. Both steps were walked until `theme.test.ts` cleared its thresholds with margin — which is where
 * a borrowed palette becomes ours, and it is not a formality: **Night's own danger pink measures Lc 58 on
 * this preset's lighter surface**, under the floor it clears comfortably on Night.
 *
 * Its status colours are NOT here. Mark43 encodes state with 11 saturated hues on filled pills; ours come
 * from `SET_COLORS` in every preset, and 11 hues fails the read-by-more-than-colour rule the queue meets in
 * three channels.
 */
const MARK43: ConsoleTheme = {
  accent: { bg: '#132434', border: '#2f5f80', solid: '#74c2ff', text: '#9ad3ff' },
  density: 'dense',
  font: { mono: MONO, sans: SANS },
  id: 'mark43',
  mode: 'dark',
  name: 'Mark43',
  onStatus: '#06090d',
  ramp: {
    bg: '#1e1f21',
    line: '#333335',
    lineStrong: '#3f4041',
    ring: '#555657',
    surface: '#232426',
    surfaceHover: '#2d2e30',
    surfaceOn: '#313234',
    surfaceRaised: '#28292b',
    text: '#efeff1',
    textMuted: '#bfbfc1',
  },
  semantic: {
    danger: '#ffa3b5',
    dangerBg: '#4e1924',
    dangerText: '#ffb8c6',
    warnBg: '#514324',
    warnBorder: '#947427',
    warnSolid: '#ddb557',
    warnText: '#e5c67d',
  },
  // Declared and then overridden to `none` by `edge: 'line'`. Kept rather than blanked so the preset still
  // says what it WOULD lift with, if a later edge strategy wants both.
  shadow: { float: '0 4px 16px rgba(0, 0, 0, 0.45)', modal: '0 12px 40px rgba(0, 0, 0, 0.6)' },
  shape: { edge: 'line', radius: { control: 0, pill: 0, surface: 0 } },
  surfaces: { float: '#28292b', modal: '#2d2e30' },
};

/** Every skin, in the order the switcher offers them. Night first: the default must be the first choice. */
export const THEMES: readonly ConsoleTheme[] = [NIGHT, DAY, CONTRAST, AMBER, MARK43];

export const DEFAULT_THEME: ThemeId = 'night';

/**
 * Why a host's request resolved the way it did, so a refusal can be reported rather than guessed at.
 *
 * `reason` is `'none'`, `'id'` or `'preset'` when the request was honoured, and a sentence naming what was
 * wrong when it was not.
 */
export interface HostThemeChoice {
  readonly reason: string;
  readonly theme: ConsoleTheme;
}

/**
 * The three variables the density lever moves, on their own.
 *
 * Separate from `themeVariables` because `global-css.ts` re-declares exactly these — and nothing else —
 * under `(pointer: coarse)`: repeating the palette there would double the sheet to restate values that
 * cannot change with the pointer.
 */
export function densityVariables(theme: ConsoleTheme, coarsePointer: boolean): string {
  const density = resolveDensity(theme.density, coarsePointer);

  const entries: readonly (readonly [string, string])[] = [
    ['--os-row-padding', density.rowPadding],
    ['--os-text-caption', `${density.caption}px`],
    ['--os-text-body', `${density.body}px`],
  ];

  return entries.map(declaration).join('\n');
}

/** The skin the operator last chose, or the default for anything unreadable or no longer shipped. */
/**
 * The skin the console opens with, and the ONE place the four sources are ordered.
 *
 * They are ordered rather than merged, because every pair of them can disagree and a rule invented at each
 * call site is how two surfaces end up opening in different skins:
 *
 * 1. **a link's or a host's `theme=`** — someone is showing this operator a specific thing, or a CAD shell
 *    is pinning its own brand. Honoured for the session and **never persisted**: it is somebody else's
 *    view, not a change to how this console looks from now on.
 * 2. **the operator's stored choice** — an explicit decision, and it wins forever once made.
 * 3. **what their machine asks for** — `prefers-contrast`, then `prefers-color-scheme`.
 * 4. **Night.**
 *
 * An unknown id in (1) falls through to (2) rather than to Night, and says so: a typo in a shared link
 * should cost the recipient the sender's skin, not their own.
 */
export function initialTheme(params?: URLSearchParams, storage?: JsonStorage): ThemeId {
  const asked = params === undefined ? undefined : readView(params).theme;
  if (asked !== undefined) {
    const choice = resolveHostTheme(asked);
    if (choice.reason === 'id') {
      return choice.theme.id;
    }
    report(choice.reason);
  }

  return loadTheme(storage);
}

export function loadTheme(storage?: JsonStorage, preferred: ThemeId = preferredTheme()): ThemeId {
  const stored = readJson(STORAGE_KEYS.theme, storage);

  return THEMES.some((theme) => theme.id === stored) ? (stored as ThemeId) : preferred;
}

/**
 * The skin the operator's own machine asks for, before they have said anything.
 *
 * Until 201/7-10 the first run was Night whatever the OS said, which meant a console opening dark on a
 * phone in daylight had a Day preset it never offered — and `prefers-contrast` names exactly the person
 * Contrast was built for. An explicit choice still wins forever: this is only consulted when nothing is
 * stored, and the moment the operator picks a skin `saveTheme` takes over for good.
 *
 * Order matters. Contrast is checked FIRST because it answers a stronger statement — someone who has asked
 * their system for more contrast has said something about their eyes or their screen, not about the light
 * in the room — and it is a dark preset, so a light-preferring operator who also asks for contrast gets the
 * one that serves the harder need.
 */
export function preferredTheme(): ThemeId {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return DEFAULT_THEME;
  }
  if (window.matchMedia('(prefers-contrast: more)').matches) {
    return 'contrast';
  }

  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'day' : DEFAULT_THEME;
}

/**
 * The skin a HOST asked for, checked before it is allowed to paint anything.
 *
 * `?embed=1` is the whole console inside a CAD shell that will have its own brand, so a host needs a way
 * in. It has exactly two, and neither is the one the cascade would allow:
 *
 * - **an id** — `theme=mark43`, which is what a URL can carry and what an iframe embedder actually has.
 * - **a full preset** — for a same-document host that mounts our chrome itself, validated here against the
 *   same APCA thresholds every shipped preset clears, and refused loudly when it does not.
 *
 * **What must not happen is a host overriding `--os-*` from its own root.** The cascade permits it and no
 * guard would ever see it: an unmeasured skin that renders, lints and screenshots fine — which is the exact
 * failure 7-09's guard exists to catch, re-entering through the back door. That is why this returns a
 * REASON as well as a theme, and why a refusal is reported rather than silently swallowed.
 *
 * A refusal falls back to the default rather than to a partially-applied palette: half a validated skin is
 * a screen nobody has ever looked at.
 */
export function resolveHostTheme(asked: unknown): HostThemeChoice {
  if (asked === undefined || asked === null || asked === '') {
    return { reason: 'none', theme: shipped(DEFAULT_THEME) };
  }
  if (typeof asked === 'string') {
    const found = THEMES.find((theme) => theme.id === asked);

    return found === undefined
      ? { reason: `no preset is called '${asked}'`, theme: shipped(DEFAULT_THEME) }
      : { reason: 'id', theme: found };
  }
  const failures = validateTheme(asked);

  return failures.length === 0
    ? { reason: 'preset', theme: asked as ConsoleTheme }
    : {
        reason: `the supplied preset fails its contrast floor — ${failures.join('; ')}`,
        theme: shipped(DEFAULT_THEME),
      };
}

/**
 * Everything wrong with a candidate theme, as sentences — empty when it may be used.
 *
 * Shape first, then contrast, because a missing field is not a contrast failure and reporting it as one
 * sends the host looking in the wrong place.
 */
export function validateTheme(candidate: unknown): readonly string[] {
  if (typeof candidate !== 'object' || candidate === null) {
    return ['a theme must be an object'];
  }
  // `in` is not enough: `{ ...night, ramp: undefined }` carries the key and fails the CONTRAST check
  // instead, which sends a host looking at its colours for a field it never sent.
  const fields = candidate as Readonly<Record<string, unknown>>;
  const missing = REQUIRED_FIELDS.filter((field) => fields[field] === undefined || fields[field] === null);
  if (missing.length > 0) {
    return [`missing: ${missing.join(', ')}`];
  }

  // `contrastFailures` reports an unmeasurable colour as a failed pair rather than throwing, so a host that
  // sends `rebeccapurple` gets told which pair it broke instead of a blanket refusal.
  return contrastFailures(candidate as ConsoleTheme);
}

/**
 * How a refused host request is reported, and it is `console.error` for a reason that is not severity.
 *
 * It is not a thrown error: a bad `theme=` must never be why an operator cannot open the console. It is not
 * swallowed either — the point of validating a host's palette is that a skin nobody measured does not get
 * to paint the screen quietly. And it is `error` rather than `warn` because `world/error-log.ts` collects
 * exactly that into the JSON the operator copies: the target device is a phone with no devtools to attach,
 * so a refusal logged at `warn` is a refusal nobody will ever read.
 */
function report(reason: string): void {
  // eslint-disable-next-line no-console -- picked up by `error-log.ts` into the capture; see above
  console.error(`[dispatch] theme: ${reason}; keeping the operator's own choice`);
}

/** The fields `contrastFailures` and `themeVariables` both read; a theme missing one paints nothing. */
const REQUIRED_FIELDS = [
  'accent',
  'density',
  'font',
  'id',
  'mode',
  'name',
  'onStatus',
  'ramp',
  'semantic',
  'shadow',
  'shape',
  'surfaces',
] as const;

export function saveTheme(id: ThemeId, storage?: JsonStorage): void {
  writeJson(STORAGE_KEYS.theme, id, storage);
}

/**
 * The CSS custom properties one theme defines, as a declaration block.
 *
 * Emitted once per theme into the console's single stylesheet (`global-css.ts`), each block scoped to
 * `[data-theme="…"]`. Switching is then an attribute write — the browser repaints and React is not involved
 * at all, which is the point of putting colour here instead of in the style objects.
 *
 * `coarsePointer` is what the density clamp is resolved against. It is a parameter rather than a hook call
 * because the blocks are emitted ONCE into a static sheet: `global-css.ts` emits both sides and lets a
 * `@media (pointer: coarse)` query pick, so the clamp costs no JavaScript and survives a skin change that
 * React never sees.
 */
export function themeVariables(theme: ConsoleTheme, coarsePointer = false): string {
  // `edge: 'line'` is the whole of Mark43's depth strategy: a hairline separates the surfaces and nothing
  // is lifted off anything. Emitting `none` here rather than branching in the style objects keeps the rule
  // that a skin change is one attribute write.
  const shadow = theme.shape.edge === 'line' ? { float: 'none', modal: 'none' } : theme.shadow;
  const entries: readonly (readonly [string, string])[] = [
    ['color-scheme', theme.mode],
    ['--os-bg', theme.ramp.bg],
    ['--os-line', theme.ramp.line],
    ['--os-line-strong', theme.ramp.lineStrong],
    ['--os-ring', theme.ramp.ring],
    ['--os-surface', theme.ramp.surface],
    ['--os-surface-hover', theme.ramp.surfaceHover],
    ['--os-surface-on', theme.ramp.surfaceOn],
    ['--os-surface-raised', theme.ramp.surfaceRaised],
    ['--os-text', theme.ramp.text],
    ['--os-text-muted', theme.ramp.textMuted],
    ['--os-accent-bg', theme.accent.bg],
    ['--os-accent-border', theme.accent.border],
    ['--os-accent-solid', theme.accent.solid],
    ['--os-accent-text', theme.accent.text],
    ['--os-danger', theme.semantic.danger],
    ['--os-danger-bg', theme.semantic.dangerBg],
    ['--os-danger-text', theme.semantic.dangerText],
    ['--os-warn-bg', theme.semantic.warnBg],
    ['--os-warn-border', theme.semantic.warnBorder],
    ['--os-warn-solid', theme.semantic.warnSolid],
    ['--os-warn-text', theme.semantic.warnText],
    ['--os-float-bg', theme.surfaces.float],
    ['--os-modal-bg', theme.surfaces.modal],
    ['--os-on-status', theme.onStatus],
    ['--os-shadow-float', shadow.float],
    ['--os-shadow-modal', shadow.modal],
    ['--os-font-sans', theme.font.sans],
    ['--os-font-mono', theme.font.mono],
    ['--os-radius-control', `${theme.shape.radius.control}px`],
    ['--os-radius-pill', `${theme.shape.radius.pill}px`],
    ['--os-radius-surface', `${theme.shape.radius.surface}px`],
  ];

  return [...entries.map(declaration), densityVariables(theme, coarsePointer)].join('\n');
}

function declaration([name, value]: readonly [string, string]): string {
  return `  ${name}: ${value};`;
}

function shipped(id: ThemeId): ConsoleTheme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

/*
 * NOT A THEME, and deliberately: a colour-vision-safe STATUS palette.
 *
 * Unit and call colours are red / amber / green, the worst possible triple for deuteranopia (~8 % of men).
 * A safe palette is wanted and it cannot live here, because those colours are `map/beacons.ts` →
 * `SET_COLORS`: the engine builds a debug-line set per key at boot and draws the pillars from it, so
 * repainting a status means rebuilding those sets rather than writing a CSS variable. It needs an engine
 * hook, it belongs with the symbology (201/5), and it has to swap the whole table at once so the map and
 * the lists move together. Filed rather than half-done.
 */
