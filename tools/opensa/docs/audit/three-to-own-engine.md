# Migration audit — three.js → own WebGPU engine

**Verdict: the migration made the app both faster and smaller.** Replacing the three.js renderer with the
own WebGPU engine (plan [074](../plans/074-opensa-engine/readme.md), flip completed 2026-07-18, `three`
dependency fully removed) delivered a **~7× runtime speed-up** at the same content and a **−12.8 % gzip
bundle** — despite the own engine being a large body of added code. This doc records the closing numbers of
that phase; the raw runs live in [`../benchmarks/`](../benchmarks/).

## 1. Runtime — ~7× fps at identical content

The decisive measurement is the **back-to-back pair** taken 2026-07-18 on one machine (M3 Pro @2× retina),
same day, same 841-car road population, prod three.js and the own engine one after the other:

| scene | three.js prod (fps) | own engine (fps) | speed-up |
| --- | ---: | ---: | ---: |
| ls-noon | 16.8 | 120.1 | 7.1× |
| sf-fog-dawn | 18.6 | 120.3 | 6.5× |
| lv-night | 23.8 | 120.0 | 5.0× |
| country-dusk | 37.8 | 119.6 | 3.2× |
| ocean-horizon | 59.6 | 120.0 | 2.0× |
| ls-rain-night | 16.2 | 120.2 | 7.4× |

The own engine held **vsync (120 fps)** across every scene where prod ran at **16–24 fps** in the city.

- three.js side: [`benchmarks/three-engine/2026-07-18-preflip-prod.json`](../benchmarks/three-engine/2026-07-18-preflip-prod.json)
- own engine side: [`benchmarks/opensa-engine/2026-07-18-ingame-preflip-baseline.json`](../benchmarks/opensa-engine/2026-07-18-ingame-preflip-baseline.json)
- the annotated narrative: [`benchmarks/opensa-engine/2026-07-18-series.md`](../benchmarks/opensa-engine/2026-07-18-series.md)

**Caveat that only strengthens the result:** the 07-18 own-engine baseline ran a *lighter* pak (before the
087 LOD/vegetation/procobj content landed). On the full 087 map the own engine now sits at 60–120 fps
depending on scene ([`benchmarks/opensa-engine/2026-07-24-ingame-617556f-087ring.json`](../benchmarks/opensa-engine/2026-07-24-ingame-617556f-087ring.json),
perf-neutral vs the 07-20 baseline at a 34 % fuller car population) — and three.js was already at 16 fps on
the *lighter* world, so the true gap on the complete world is wider than the table above, not narrower.

## 2. Bundle — smaller, despite adding an engine

`apps/web` production bundle, both branches built with the **same command** (`npm run build` =
`tsc -b && vite build`; `main` built in a throwaway git worktree with its own `npm install`), measured
2026-07-24 (`main` @ `da092a3`, migration branch @ `617556f`):

| metric | main (with three.js) | migration (own engine) | Δ |
| --- | ---: | ---: | ---: |
| **JS gzip** (over-the-wire) | 1252 kB | **1092 kB** | **−160 kB (−12.8 %)** |
| JS raw (sum of chunks) | 3593 kB | 2990 kB | −603 kB (−16.8 %) |
| `dist/` total (with assets) | 3.8 MB | 3.2 MB | −0.6 MB |
| largest chunk | `canvas-host` 2671 kB / gzip 1003 | `engine-canvas-host` 2416 kB / gzip **904** | −99 kB gzip |

Where the weight went: three r0.177 is gone entirely — its `OrbitControls` addon (39 kB raw / 10.9 kB gzip)
and a three-heavy `build-texture` chunk (550 kB raw / 140 kB gzip on `main`) have **no counterpart** on the
migration branch, and three's core no longer inflates the main chunk. The own engine that replaced three's
rendering nets out *smaller* than what it removed.

**Scope caveat:** the −603 kB raw / −160 kB gzip is the **total delta between the two branches**, not a
pure three.js subtraction — the branch changed more than one dependency. But three.js was the single largest
removed piece, and the raw reduction is essentially its footprint.

## Reproduce

- Runtime: `?bench=all` in-game sweep, `[bench]` console protocol — see
  [`../development/benchmarks.md`](../development/benchmarks.md). Compare any two runs only after reading
  [`../benchmarks/index.md`](../benchmarks/index.md) (harness/pak/machine caveats).
- Bundle: `npm run build` on each side (a git worktree + `npm install` for `main`, whose lockfile has
  drifted from its `package.json` so `npm ci` refuses), then sum `dist/**/*.js` and their gzip sizes.
