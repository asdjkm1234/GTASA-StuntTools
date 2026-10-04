/**
 * The URLs the panel hands out — ONE rule, two readers.
 *
 * The page built these inline until 2026-08-28, which was fine while a person was the only thing that could
 * follow one. `phone_open` (plan 002's remaining tap) is a second reader, and a second copy of the rule is
 * how an agent opens a URL that differs from the one on the screen beside it — the same class of failure the
 * panel's own log/ring sharing exists to prevent.
 *
 * `agent=1` is on every link this file produces and nowhere else: these addresses only exist on the phone,
 * and it is what lets the map be read and driven (plan 002, the browser half). A shared link never carries it.
 */

/** The links the panel offers, in the order the page lists them. `phone_open`'s `LINK` knob takes one. */
export const LINK_NAMES = ['map', 'inventory', 'field', 'engine', 'flat', 'bake', 'share'];

/**
 * Every link, for one panel state.
 *
 * @param {{district?: string, out?: string, ports?: {app?: number, static?: number}, webapp?: boolean}} state
 *   `ports` and `webapp` come from the panel's own `/api/state`; `out` and `district` are what the run used.
 * @returns {Record<string, string>} keyed by {@link LINK_NAMES}.
 */
export function consoleUrls(state = {}) {
  const staticPort = state.ports?.static ?? 3001;
  const appPort = state.ports?.app ?? 5173;
  const out = String(state.out ?? './build/phone')
    .trim()
    .replace(/^\.\//, '');
  const pak = `http://localhost:${staticPort}/${out}`;
  // A prebuilt copy is served as static files and vite is never started, which on some arm64 CPUs is the
  // only way in at all (`scripts/phone.sh`).
  const app = state.webapp
    ? `http://localhost:${staticPort}/build/webapp/dispatch.html`
    : `http://localhost:${appPort}/dispatch.html`;
  const query = `src=${pak}&district=${encodeURIComponent(String(state.district ?? '').trim())}&agent=1`;

  return {
    bake: `${app}?${query}&bake=tiles&zmin=0&zmax=4`,
    // The field run's A/B PARTNER (201/2): the same board and the same collector, with `?overlay=0` — so the
    // window prices the engine rather than the symbology over it. The field round of 2026-08-30 measured the
    // 2D overlay at four times `engine-frame`'s own CPU, which is what makes the pair worth a link each: two
    // halves typed by hand differ by something nobody wrote down.
    engine: `${app}?${query}&units=150&calls=40&inventory=1&overlay=0`,
    // The declared worst case: 201's budget table says 150 units each drawn as a model with a symbol over
    // it, and every number 5/02 and 5/04 owe is measured AT it. Typed by hand it was never typed at all.
    field: `${app}?${query}&units=150&calls=40&inventory=1`,
    flat: `${app}?${query}&mode=flat`,
    inventory: `${app}?${query}&inventory=1`,
    map: `${app}?${query}`,
    // The share artifact is served as a plain file out of the repo, wherever the static server is.
    share: `http://localhost:${staticPort}/dist-share/dispatch.html?${query}&inventory=1`,
  };
}

/**
 * Which ports must already be serving for a link to answer, so opening a dead one is refused by name.
 *
 * The static port is on every list because it hands out the PAK, whatever serves the app: a console that
 * loads and then 404s on its manifest is the failure this check exists to turn into a sentence.
 */
export function portsFor(state = {}) {
  const staticPort = state.ports?.static ?? 3001;

  return state.webapp === true ? [staticPort] : [staticPort, state.ports?.app ?? 5173];
}
