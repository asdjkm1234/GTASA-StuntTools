/**
 * **A skin cannot ship with unreadable text.**
 *
 * This is the guard that makes four themes cheaper than SonoranCAD's four. Theirs are hand-written and
 * unchecked, and it shows: the `trevor` skin fills a whole row with the status colour and lands grey text
 * on a mid-blue fill, so the row that matters most is the one that stops being readable. Nothing on their
 * side catches that, because contrast failure is silent by nature — it renders, it lints, it screenshots
 * fine on the monitor of whoever wrote it.
 *
 * The measure is **APCA** (Lc), not WCAG 2's ratio, for the reason `DESIGN.md` already gives: WCAG 2.x is
 * symmetric and APCA is not, and a dark console is the polarity WCAG 2 gets wrong — it passes light-on-dark
 * pairs that are genuinely hard to read and fails pairs that are fine. The thresholds are the ones DESIGN.md
 * declares: **Lc 90 for primary text, Lc 60 for secondary**.
 *
 * The formula itself moved to `apca.ts` in 201/7-10, when an embedding host became able to supply a
 * palette: the same measure now runs at runtime, and a guard that measures with its own private copy of
 * the formula it guards is a guard that drifts. This file asserts; `apca.ts` measures.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { contrastFailures, luminance } from './apca';
import { styles, TOUCH_TARGET } from './styles';
import {
  DEFAULT_THEME,
  initialTheme,
  loadTheme,
  resolveDensity,
  resolveHostTheme,
  saveTheme,
  THEMES,
  themeVariables,
  validateTheme,
} from './theme';

/** Every component file beside this test, as `[name, source]` — what the two raw-value guards read. */
function components(): readonly (readonly [string, string])[] {
  const here = dirname(fileURLToPath(import.meta.url));

  return readdirSync(here)
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => [name, readFileSync(join(here, name), 'utf8')] as const);
}

describe('theme', () => {
  describe('negative cases', () => {
    it.each(THEMES.map((theme) => [theme.name, theme] as const))(
      'lets no text in %s fall under its APCA threshold',
      (_name, theme) => {
        expect(contrastFailures(theme)).toEqual([]);
      },
    );

    it('lets no two skins share an id', () => {
      expect(new Set(THEMES.map((theme) => theme.id)).size).toBe(THEMES.length);
    });

    it('lets no skin define fewer variables than the others', () => {
      // A theme missing one variable does not fail loudly — it inherits whatever the previous theme left on
      // the root, so a skin looks right until the ONE component that used the missing token is on screen.
      const names = THEMES.map((theme) => themeVariables(theme).match(/--os-[a-z-]+/gu) ?? []);
      for (const set of names) {
        expect(set).toEqual(names[0]);
      }
    });

    it('lets no component paint a colour the theme cannot reach', () => {
      // Twice in one change: `#0e3a52` on the region badge and `#7d8ea1` on a hint line. Both render, both
      // lint, and both stay dark-blue-on-white the moment the Day skin is chosen — a raw hex in a component
      // is a colour that has opted out of the theme. `styles.test.ts` cannot see these because it reads the
      // token table; this reads the components themselves.
      const strays: string[] = [];
      for (const [file, source] of components()) {
        for (const hex of source.match(/'#[0-9a-f]{3,8}'/giu) ?? []) {
          strays.push(`${file}: ${hex}`);
        }
      }

      expect(strays).toEqual([]);
    });

    it('lets no component write its own radius or its own shadow', () => {
      // The same rule as the hex above, for the layer 201/7-10 added to the contract. A radius or a shadow
      // written into a component has opted out of `shape` exactly as a hex opts out of the ramp: it renders,
      // it lints, and it stays rounded-and-lifted under a preset whose whole depth strategy is a hairline.
      // The one deliberate exception is a symbology MARK rather than a surface, and it lives in the token
      // table (`styles.tallyDot`) where this guard can see it.
      const strays: string[] = [];
      for (const [file, source] of components()) {
        for (const written of source.match(/\b(?:borderRadius|boxShadow):\s*[^,\n]+/gu) ?? []) {
          strays.push(`${file}: ${written.trim()}`);
        }
      }

      expect(strays).toEqual([]);
    });

    it('lets no preset carry a desk density onto a phone', () => {
      // The [cross-platform-surface](../../../../docs/restrictions/cross-platform-surface.md) half of
      // 201/7-10, and the reason the clamp lives in `resolveDensity` rather than in a review. A skin is
      // chosen on a desk and travels to the same operator's phone through one `localStorage` key with
      // nothing on that path re-asking the question.
      //
      // BOTH halves are asserted, and the second is the one that can actually fail. The phone's row carries
      // `minHeight: TOUCH_TARGET` and its own padding, so the 44-px criterion is true by construction
      // whatever a preset asks for — the plan's original phrasing would have passed on every possible
      // input. What genuinely travels is the TYPE, inside a row that stays 44 px tall while its text
      // shrinks to 10 px, which is invisible to every other guard here.
      const floor = resolveDensity('compact', true);
      const under = THEMES.filter((theme) => {
        const steps = resolveDensity(theme.density, true);

        return steps.body < floor.body || steps.caption < floor.caption;
      }).map((theme) => theme.name);

      expect(under).toEqual([]);
      expect(styles.rowTouch.minHeight).toBe(TOUCH_TARGET);
    });

    it('refuses a host palette that cannot be read, and names every pair', () => {
      // The back door 7-09's guard exists to close: a host CAN override `--os-*` from its own root and no
      // guard would ever see it. The supported way in is measured with the same call the shipped presets
      // are, so an unreadable palette is refused rather than rendered.
      const night = THEMES[0];
      const unreadable = { ...night, ramp: { ...night.ramp, text: '#0d0f13', textMuted: '#0a0c10' } };

      expect(validateTheme(unreadable).length).toBeGreaterThan(0);
      expect(validateTheme({ ...night, ramp: undefined })).toEqual([expect.stringContaining('missing')]);
      expect(validateTheme('night')).toEqual(['a theme must be an object']);
      // A colour APCA cannot measure must FAIL rather than pass. `luminance` yields NaN for one, and
      // `NaN < 60` is false — so before 7-10 this palette cleared the guard on the pairs it broke.
      expect(validateTheme({ ...night, ramp: { ...night.ramp, bg: 'rebeccapurple' } })).toEqual([
        'text on bg: rebeccapurple is not an opaque #rrggbb',
        'textMuted on bg: rebeccapurple is not an opaque #rrggbb',
      ]);
    });

    it('keeps the operator their own skin when a link names one that is not shipped', () => {
      // A typo in a shared link should cost the recipient the SENDER's skin, not their own — so an
      // unknown id falls through to the stored choice rather than resetting the console to Night.
      const storage = { getItem: (): string => '"amber"', setItem: (): void => undefined };

      expect(initialTheme(new URLSearchParams('theme=chartreuse'), storage)).toBe('amber');
      expect(resolveHostTheme('chartreuse').reason).toContain('chartreuse');
      expect(resolveHostTheme('chartreuse').theme.id).toBe(DEFAULT_THEME);
    });

    it('falls back to the default for a stored id that is not shipped any more', () => {
      expect(loadTheme({ getItem: () => '"chartreuse"', setItem: () => undefined })).toBe(DEFAULT_THEME);
      expect(loadTheme({ getItem: () => 'not json', setItem: () => undefined })).toBe(DEFAULT_THEME);
      expect(loadTheme(undefined)).toBe(DEFAULT_THEME);
    });
  });

  describe('positive cases', () => {
    it('ships the default first, so an operator who never opens the switcher gets it', () => {
      expect(THEMES[0]?.id).toBe(DEFAULT_THEME);
    });

    it('declares a colour scheme that matches the ground it paints', () => {
      for (const theme of THEMES) {
        // Light ground, light scheme — otherwise the browser paints dark scrollbars and form internals onto it.
        expect(theme.mode).toBe(luminance(theme.ramp.bg) > 0.35 ? 'light' : 'dark');
      }
    });

    it('moves only the row padding and the two row type steps', () => {
      // Density is a bounded lever, not a scale factor over the type table: `input` at 15 px is the floor
      // below which iOS zooms the page on focus, and the title is not a row. A step that reached either
      // would be a phone defect written as a preference.
      const moved = new Set<string>();
      for (const density of ['comfortable', 'compact', 'dense'] as const) {
        for (const [name, value] of Object.entries(resolveDensity(density, false))) {
          moved.add(`${name}:${String(value)}`);
        }
      }

      expect([...new Set([...moved].map((entry) => entry.split(':')[0]))].sort()).toEqual([
        'body',
        'caption',
        'rowPadding',
      ]);
    });

    it('settles the four sources in one order, and persists none of the host half', () => {
      const stored = { getItem: (): string => '"amber"', setItem: (): void => undefined };
      const empty = { getItem: (): null => null, setItem: (): void => undefined };

      // A link wins for the session...
      expect(initialTheme(new URLSearchParams('theme=mark43'), stored)).toBe('mark43');
      // ...over the stored choice, which itself wins over anything the machine asks for.
      expect(initialTheme(new URLSearchParams(''), stored)).toBe('amber');
      // Nothing asked and nothing stored: the machine's preference, and Night when it has none. jsdom is
      // not present in this suite, so `preferredTheme` takes its no-`matchMedia` branch here.
      expect(initialTheme(new URLSearchParams(''), empty)).toBe(DEFAULT_THEME);
      expect(loadTheme(empty, 'day')).toBe('day');
      // An explicit choice still beats the machine's, which is the half that must not regress.
      expect(loadTheme(stored, 'day')).toBe('amber');
    });

    it('accepts a whole preset from a host when it measures', () => {
      const choice = resolveHostTheme({ ...THEMES[0], id: 'night', name: 'Host Night' });

      expect(choice.reason).toBe('preset');
      expect(choice.theme.name).toBe('Host Night');
      expect(resolveHostTheme('mark43').theme.id).toBe('mark43');
      expect(resolveHostTheme(undefined).theme.id).toBe(DEFAULT_THEME);
    });

    it('remembers the chosen skin', () => {
      const store = new Map<string, string>();
      const storage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
      };
      saveTheme('amber', storage);

      expect(loadTheme(storage)).toBe('amber');
    });
  });
});
