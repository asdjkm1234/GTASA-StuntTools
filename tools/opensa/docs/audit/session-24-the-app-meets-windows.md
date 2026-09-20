# Session 24 (2026-08-18): the app meets Windows

**On `main`, 15 commits after `8e05ded2` (session 23's audit), tree clean, suite 502 files / 4 564 green
plus the one pre-existing flake, tsc + eslint clean, knip byte-identical to the session's baseline (it
exits 1 before and after — see "What the instruments actually say").**

Session 23 shipped an 84.8 MB portable exe that **had never been run**. This session is what happened when
it was, and everything the answer dragged behind it. `apps/cutscene-converter` plan 002 is now DONE, all
eight steps, and the app is published from the user's own hosting.

The GPU-pass regression (`docs/open-issues/fixed/opensa-gpu-pass-regression-2026-08-17.md`) was NOT started and
is now the only open item in his order.

## The two defects, and what each cost

**1. A stale artifact reads as a broken app.** His first Windows run showed the title and the plugin's SHA
and nothing else. The app was not at fault: the exe's asar carried `main.cjs` alone — no `preload.cjs`, no
`convert-child.cjs`, a renderer with no wizard in it. It was the step 1–2 build, packed at 20:03 while the
wizard landed at 20:33 the same evening. `release/` is untracked, so nothing on screen or in the file said
which commit it came from; the answer took unpacking the asar.

Fixed at the root rather than by rebuilding: `scripts/build-stamp.ts` reads `git rev-parse --short HEAD`
plus a `--porcelain` dirty flag, vite injects it into the renderer and esbuild into the main process, and
the footer shows it beside the version and the plugin SHA. **A screenshot now answers "which build is
this"** — ask for it before diagnosing anything.

**2. The black window.** The next run converted correctly — the files were in the output folder — and the
window went black. One line:

```ts
useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [lines.length]);
```

A concise arrow body returns what it evaluates, and React takes an effect's return value for its CLEANUP.
At the end of the run React called it, `destroy_ is not a function`, and the whole tree unmounted over
finished, correct work. Braces are the fix (`f1f65b7b`).

It was found by **reproducing it, not by reading**: `scripts/debug/cutscene-converter-drive.ts` drives the
built app through Playwright's Electron support with the folder dialogs stubbed in the MAIN process — three
pickers, a real conversion, the status line, Exit. It reproduced the crash in seconds on macOS. The
renderer had no test lane at all, which is why both defects reached Windows in the first place.

## What changed

| area | change | commit |
| --- | --- | --- |
| `apps/cutscene-converter` | the build stamps its own commit into both bundles and the footer | `d2cc65b2` |
| | the run is timed spawn-to-exit and reported ("Conversion finished in 1.1 s") | `c6ae5013` |
| | the black-window fix, the status line with its pulse, Exit, an error boundary, and a `render-process-gone` handler in main | `f1f65b7b` |
| | a loose-file cars folder is named instead of reported as empty coverage | `bf2d47dc` |
| | a Tutorial link in the footer — URL held in the main process, the renderer asks to open THE TUTORIAL | `c174b0f9` |
| `scripts/debug` | `cutscene-converter-drive.ts` — the app's first end-to-end lane | `63bf6fc4` |
| `docs/tutorial/cutscene-converter/` | the page + its screenshots (English source of the published Russian one); no per-version folder (his call) | `68f912dd`, `4a02918e` |
| `tools/vehicle-cutscene` | the CLI usage no longer claims `.settings.txt` is part of its input | `68f912dd` |
| `docs/benchmarks/tools`, `docs/contracts/vehicles.md`, `docs/restrictions/architecture.md` | the three record gaps this audit found | `6ec96f58` |

## What it bought

| | |
| --- | --- |
| Cold start (Windows 11, his stopwatch) | **~5 s** |
| Conversion (Windows 11) | **~2 s** |
| Released exe | 89 008 404 B, sha256 `bbef5d2f…b2e950`, built from `99c8595a` |
| App tests | 17 → 20 |
| Repo suite | 4 558 → 4 564 |

Numbers and what they mean: `docs/benchmarks/tools/2026-08-18-cutscene-converter-0.4.0.md`. The reading
worth keeping: **the cold start is 2.5× the work it starts**, and the portable format owns it.

## What the instruments actually say

- **The suite is 4 564 green with one red**: `tools/opensa-pack/src/model-osm-uv-anim.test.ts` times out at
  5 000 ms under full-suite load (3.7 s alone). It predates this session — confirmed at `6ea15dc0` in
  session 23 — and it wants an explicit `testTimeout` or a lighter fixture. It is still not fixed.
- **`knip` exits 1, and did before this session too.** Its output at `8e05ded2` and at HEAD is byte-for-byte
  identical (unused files under `scripts/`, `tools-debug/`, unused type exports, unlisted deps in the new
  app). Session 23's audit called knip "clean"; that was wrong, and this is the correction. Nothing in this
  session added to it.
- **The effect-cleanup class cannot be linted cheaply, and both instruments were measured** before that was
  written down: a syntactic `no-restricted-syntax` rule fires on 4 shorthand effects in this repo and **3
  are the legitimate unsubscribe idiom**; the type-aware `@typescript-eslint/no-confusing-void-expression`
  is correct in principle and flags **128 ordinary JSX handlers**. The rule is recorded in
  `docs/restrictions/architecture.md` with "nothing catches this" stated, which is what that folder is for.

## Decisions taken here (do not re-derive)

- **Distribution is the user's own hosting** — a zip beside the tutorial page on `gooddev.org`. Not a
  GitHub release (he did not want one), not a binary in the repo (85 MB per build in git history forever,
  and Git LFS's free quota is ~12 downloads a month), not a CI artifact (90-day life, needs a login).
  The four options and their prices are in plan 002.
- **No CI build.** `pack:win` runs on his machine; a CI job would first have to build `perfect-cutscene.asi`
  with mingw, because the app build FAILS without the plugin by design. Worth it when a second person ships.
- **The tutorial has no per-version folder** (his call, reversing 001's "the app links to its own version").
  0.4.0 is the only version there has ever been, and the footer links to the page in the repo so the link
  survives wherever else it is published. When 0.5.0 behaves differently, the split comes back.
- **The look is plain CSS with `apps/web`'s `--sa-*` tokens**, not Tailwind: the app has no Tailwind
  pipeline and one screen does not earn one. Accepted on `99c8595a`.

## Left

1. **Re-upload the zip.** The site still serves `63bf6fc4` — without the loose-file verdict and without the
   footer link. And the repo is unpushed, so the Tutorial button 404s until it is.
2. **The GPU-pass regression** — the only open item in his order. First step is mine: the UNCAPPED headless
   sweep on the fresh pak, for a surface-free pak-vs-pak delta against `2026-08-12-ingame-uv-anim-lane-guard.json`.
