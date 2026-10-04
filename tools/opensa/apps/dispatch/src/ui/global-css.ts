/**
 * The four things an inline style object cannot express, and every one of them was a real defect.
 *
 * This console styles inline (`styles.ts`) and that stays the rule — one table, no cascade to reason about.
 * But an inline style reaches no pseudo-class and no pseudo-element, so four things were simply unreachable:
 *
 * - **`:focus-visible`** — keyboard focus fell back to the user agent's ring, which on these dark panels is
 *   somewhere between faint and invisible. A console that can be driven entirely from the keyboard
 *   (201/7-06) has to show where the keyboard IS.
 * - **the range thumb** — both sliders drew a ~16 px thumb. Making the input 44 px tall fixed the TARGET
 *   (a range drags from anywhere in its box), but the thumb still looked like something to aim at rather
 *   than grab. Only `::-webkit-slider-thumb` / `::-moz-range-thumb` reach it.
 * - **form controls do not inherit a typeface** — `font-family` does not cross into `<button>` or `<input>`,
 *   so every button and every field in this console rendered in the browser's default (Arial, measured
 *   2026-08-25) beside panels set in the app's own sans. A style object per token cannot fix this without
 *   repeating itself in fourteen places; one rule does.
 * - **`::placeholder`** — the search box's hint sat at the browser's grey, darker than our own muted step.
 * - **the scrollbars** on the queue and the roster, which on a dark surface arrive as a bright band.
 *
 * **Everything is scoped under `[data-opensa-dispatch]`.** The console is embeddable (`?embed=1`,
 * `embed.ts`), and a widget that ships bare element selectors restyles its host's inputs. The attribute goes
 * on the app root, so these rules cannot reach past it.
 */
import { ACCENT, RAMP } from './styles';
import { DEFAULT_THEME, densityVariables, THEMES, themeVariables } from './theme';

/** The attribute every rule below is scoped under, and the app root carries. */
export const DISPATCH_SCOPE = 'data-opensa-dispatch';

const ID = 'opensa-dispatch-css';

const DEFAULT_PRESET = THEMES.find((theme) => theme.id === DEFAULT_THEME) ?? THEMES[0];

/**
 * Every skin's variables, one attribute-scoped block each — which is what makes switching a skin free.
 *
 * The token table (`styles.ts`) holds `var(--os-…)` rather than colours, so changing `data-theme` on the app
 * root repaints the whole console with **no React work at all**: no re-render, no new style objects, no
 * reconciliation. That is the reason colour left TypeScript, and it is why five skins cost about as much as
 * one. `color-scheme` rides along per theme, so the browser paints the parts we do not draw — scrollbar
 * gutters, form control internals, the range track — the right way round for the ground underneath.
 *
 * The unqualified block comes first and carries the default, so a root that has lost its attribute renders
 * the shipping theme rather than an unstyled console.
 *
 * **The `(pointer: coarse)` tail is the density clamp** (201/7-10), and it is a media query rather than a
 * hook for one reason: the refusal has to survive a skin change that React never sees. A preset asking for
 * `dense` gets `resolveDensity`'s clamped steps on a phone whatever was chosen on a desk, at the cost of
 * three re-declared variables per theme and no JavaScript at all. Only the density tokens are repeated —
 * re-emitting the palette under the query would double this sheet to restate values that cannot change.
 */
const THEME_CSS = [
  `[${DISPATCH_SCOPE}] {\n${themeVariables(DEFAULT_PRESET)}\n}`,
  ...THEMES.map((theme) => `[${DISPATCH_SCOPE}][data-theme='${theme.id}'] {\n${themeVariables(theme)}\n}`),
  `@media (pointer: coarse) {\n${[DEFAULT_PRESET, ...THEMES]
    .map((theme, at) => {
      const selector = at === 0 ? `[${DISPATCH_SCOPE}]` : `[${DISPATCH_SCOPE}][data-theme='${theme.id}']`;

      return `  ${selector} {\n${indent(densityVariables(theme, true))}\n  }`;
    })
    .join('\n')}\n}`,
].join('\n');

function indent(block: string): string {
  return block
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

const CSS = `
${THEME_CSS}
[${DISPATCH_SCOPE}] button,
[${DISPATCH_SCOPE}] input,
[${DISPATCH_SCOPE}] select,
[${DISPATCH_SCOPE}] textarea {
  font-family: inherit;
}
[${DISPATCH_SCOPE}] *:focus-visible {
  outline: 2px solid ${ACCENT.solid};
  outline-offset: 1px;
}
[${DISPATCH_SCOPE}] input[type='range'] {
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
}
[${DISPATCH_SCOPE}] input[type='range']::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background: ${RAMP.lineStrong};
}
[${DISPATCH_SCOPE}] input[type='range']::-moz-range-track {
  height: 4px;
  border-radius: 999px;
  background: ${RAMP.lineStrong};
}
[${DISPATCH_SCOPE}] input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  margin-top: -6px;
  border-radius: 50%;
  border: 2px solid ${RAMP.surface};
  background: ${ACCENT.solid};
  cursor: pointer;
}
[${DISPATCH_SCOPE}] input[type='range']::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid ${RAMP.surface};
  background: ${ACCENT.solid};
  cursor: pointer;
}
[${DISPATCH_SCOPE}] input[type='range']:disabled::-webkit-slider-thumb {
  background: ${RAMP.ring};
}
[${DISPATCH_SCOPE}] input[type='range']:disabled::-moz-range-thumb {
  background: ${RAMP.ring};
}
[${DISPATCH_SCOPE}] ::placeholder {
  color: ${RAMP.textMuted};
  opacity: 0.75;
}
[${DISPATCH_SCOPE}] * {
  scrollbar-width: thin;
  scrollbar-color: ${RAMP.lineStrong} transparent;
}
[${DISPATCH_SCOPE}] ::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
[${DISPATCH_SCOPE}] ::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: ${RAMP.lineStrong};
}
[${DISPATCH_SCOPE}] ::-webkit-scrollbar-track {
  background: transparent;
}
/* The only motion in this console is a tap being acknowledged. An operator who has asked the system for
   less of it gets none, rather than a shorter version of it. */
@media (prefers-reduced-motion: reduce) {
  [${DISPATCH_SCOPE}] * {
    transition: none !important;
  }
}
`;

/** Put the sheet in the document once. Idempotent — a second console on one page reuses the first's. */
export function installDispatchCss(): void {
  if (typeof document === 'undefined' || document.getElementById(ID) !== null) {
    return;
  }
  const style = document.createElement('style');
  style.id = ID;
  style.textContent = CSS;
  document.head.append(style);
}
