# The OpenSA frame lost 120 fps: GPU pass ×2.5–3.3 on the 2026-08-17 build, and it is not the cars

**Status: ✅ CLOSED 2026-08-18 on step 1 — the ×2.5–3.3 was two LANES read as one, not a regression of the
pak.** The UNCAPPED headless sweep on the fresh pak
([`2026-08-18-headless-uncapped-0817-evening-pak-surface-out.json`](../../benchmarks/opensa-engine/2026-08-18-headless-uncapped-0817-evening-pak-surface-out.json),
the same lane as the 08-12 record, so a pure pak-vs-pak delta) reads `country-dusk` **3.70 → 4.02 (×1.09)**,
`ocean-horizon` ×1.04 and the city scenes ×1.5–1.7 — tracking their triangles (×1.5–2.1) and draws (×1.5–2.0),
i.e. the fleet arm B already priced. And the user's OWN display lane, BEFORE any of the suspect pak changes
([`2026-08-09-ingame-user-display-oldmap-baseline.json`](../../benchmarks/opensa-engine/2026-08-09-ingame-user-display-oldmap-baseline.json)),
already read `country-dusk` **12.47**, `lv-night` 9.20, `ganton-noon` 8.54 — against 12.37 / 11.75 / 10.36 on
08-17. Arm A's baseline (`08-09 arm1`) was Claude's headless canvas (`target 345`); every row of his is
`target 422/423`, and his surface has cost 2–3× the headless one on the same content since at least 08-09
(country-dusk 12.5 vs 3.9, ocean-horizon only 1.2×) — the comparison `docs/benchmarks/readme.md` forbids,
made anyway because the two 08-17 tables sat side by side. What remains, and is NOT a defect: on his lane
with the fleet pinned (arm B) the world's residual 08-09 → 08-17 is **+7–17 % on city scenes and −4 % on
`country-dusk`** — the `cellVertex` ×2–3 and `texture` +25 % of a fuller map (mods 64/65, the pow2 resample,
LOD-link repairs), and the unpinned fleet is ~1 ms on car-heavy scenes (`vehicle-submesh-draw-batching` in
`docs/performance/`). Steps 2–4 below (`probe=0`, the rect bisect, the alpha census) were NOT run — there is
no ×3 to bisect. **The lesson goes to the readme's comparability list: a regression report must name the lane
of BOTH sides before it names a suspect**, and the city scenes never held 120 on his display (08-09: ls-noon
106 fps, lv-night 70, country-dusk 61) — "lost 120" was true of the headless capped rows only.

<details><summary>The investigation as it stood when the surface was still in (2026-08-17)</summary>

**Status as written 2026-08-17: 🔴 OPEN — investigation paused by the user after four in-game arms; the fleet, the
runtime clutter and the far LOD ring are EXCLUDED, the cost sits near the camera and per pixel, and the
next step (a surface-free pak-vs-pak delta) is written below.**

Records (all in `docs/benchmarks/opensa-engine/`, index rows in `docs/benchmarks/index.md` §2026-08-17):

| arm | file | what changed |
| --- | --- | --- |
| baseline | `2026-08-09-headless-bench-aa-after-102.json` (arm1) | Claude, headless `drive.js`, DPR=2, capped 120, the 08-08 13:19 pak, code 08-09 |
| intermediate | `2026-08-12-ingame-uv-anim-lane-guard.json` | Claude, headless, **UNCAPPED**, the 08-11 18:04 pak, code 08-12 — same pass numbers as 08-09 |
| A | `2026-08-17-ingame-full-hipoly-fleet-sweep.json` | the user, IN-GAME, capped 120, the **08-17 pak** (first build with all 212 mod cars = 30k–100k-poly fleet) |
| B | `2026-08-17-ingame-benchcar-caddy-pin.json` | A + `?benchcar=caddy` — every road car pinned to the lightest `.osm` (2.2 MB) |
| C | `2026-08-17-ingame-caddy-procobj0.json` | B + `procobj=0` — runtime clutter off |
| D | `2026-08-17-ingame-caddy-draw400.json` | B + `draw=400` — LOD ring floored (default 1200) |

## The symptom, in numbers (`gpuMs.pass`, ms — the world pass; the frame's other lanes are flat)

| scene | 08-09 base | 08-12 uncapped | A fleet | B caddy | C +procobj=0 | D +draw=400 |
| --- | --- | --- | --- | --- | --- | --- |
| ls-noon | 2.7 | 2.7 | 6.9 | 5.6 | 5.6 | 4.4 |
| sf-fog-dawn | 2.5 | 2.2 | 5.4 | 4.5 | 4.5 | 4.4 |
| lv-night | 3.6 | 3.7 | 11.8 | 10.8 | 10.7 | 8.6 |
| **country-dusk** (4 cars) | 3.8 | 3.7 | **12.4** | **12.0** | **12.0** | **11.6** |
| ocean-horizon (sky only) | 2.3 | 1.8 | 2.2 | 2.2 | 2.2 | 2.1 |
| ls-rain-night | 2.7 | 2.3 | 5.9 | 4.9 | 4.9 | 4.6 |
| ganton-noon | 3.1 | 3.1 | 10.4 | 9.1 | 9.2 | 10.9 |
| strip-noon | 3.2 | 2.5 | 7.3 | 6.2 | 6.2 | 4.7 |
| ganton-night | 3.2 | — | 10.8 | 11.4 | 9.3 | 11.1 |

No city scene holds 120 fps on the 08-17 build (avgMs 10–17, p95 12–21). CPU-side lanes are unchanged
(vehicles 0.28–0.48 ms mean, physics 1–3 ms, `lateCreates` 0, every `legStart` green, no console errors
beyond the known `peren` deferred-spawn line and one CLEO atlas miss).

## What was excluded, and by which arm

1. **The high-poly fleet (arm B).** Pinning every road car to `caddy` brings triangles and draws most of the
   way back to the baseline (ls-noon 3.91 → 3.05 M vs 2.31 base; ganton draws 1898 → 1163 vs 1264 base) but
   gives back only ~1 ms of pass where cars stand and **nothing on `country-dusk` (12.4 → 12.0, 4 cars)**.
   The fleet is ~10–15 % of the regression on car-heavy scenes and ~0 on the countryside. (All 143 car slots
   of this build are mod cars — there is no stock low-poly pin; `caddy` is the lightest `.osm`.)
2. **The runtime clutter (arm C).** `procobj=0` on top of B changes nothing on any scene — pass, draws AND
   triangles identical to B (country-dusk 788/787 draws, 1.31/1.29 M tris). Either the clutter costs nothing
   on the pass or the knob did not apply on this path (the boot's `[procobj]` line would tell — it was not
   captured); either way the ×3 is not there.
3. **The far LOD ring (arm D).** `draw=400` halves the resident cells (country-dusk `cellIndex` 25 → 11),
   halves the draws (788 → 408) and the triangles (1.31 → 0.97 M) — and the pass stays at 11.6. Only the
   city scenes with many far cells give some back (ls-noon 5.6 → 4.4, lv-night 10.8 → 8.6). **The cost is
   near the camera and per pixel: half the draws, the same GPU time.**

## What the record already says about the rest

- **The engine is not the variable.** `git log --since=2026-08-11 -- packages apps` holds one commit
  (`eab81b9d`, the debug spawner's plate field). Arm A runs the same renderer the 08-12 uncapped sweep ran.
  The delta is **pak + surface**.
- **The surface differs, measurably but not by ×3.** Residency `target` reads **422** on every 08-17 row
  and **345** on every 08-09 / 08-12 row: the render targets are ~22 % bigger on the user's in-game window
  than on the headless 1440-wide DPR=2 canvas. That fits `ocean-horizon`'s +20 % (1.8 uncapped → 2.2) and
  nothing else.
- **The pak changed a lot between 08-11 and 08-17** (sessions 13–18): the mods folder was LAYERED and the
  opensa build now applies `common` (64 mods) only, where before every mod applied to both targets; mods 64
  (GTA5 cranes, 13k–28k-face collisions) and 65 (Watts towers) were added; map-optimizer now resamples any
  non-block-aligned DXT UP to a power of two (`875cd8ed`); the LOD-link repairs and the Urbanize IPL fold
  landed (both mostly `sa`-side); the img split (no runtime effect). Residency on the new pak: `cellVertex`
  ×1.3–2.9 per scene, `texture` +9–25 %.
- Same-ish geometry as the baseline costs 3× — `country-dusk` at 1.3 M tris / 787 draws vs 1.23 M / 874 —
  which points at **overdraw / alpha classes / a material path that is dearer per fragment** on what the
  cells carry now, not at "more geometry".

## What we do next, in order (each step is one measurement, recorded before the next)

1. **Take the surface out.** Claude runs the **UNCAPPED headless** sweep on THIS pak (`UNCAPPED=1 DPR=2
   … drive.js … sweep-uncapped`, `docs/development/benchmarks.md`) — the same lane as the 08-12 record, so
   the pak-vs-pak delta is pure. Expected: the ×3 survives (then it is the pak); if it collapses to ~1.2×,
   the in-game surface (window size, DPR, browser flags) is the story and this issue closes on a doc.
2. **`probe=0`** on the same lane (the env probe is 1.1–3.0 ms of GPU on the 08-17 rows and was 0.9–1.4 on
   the baseline; `gpuMs.probe` is Metal-begin-contaminated, so judge it ON/OFF only).
3. **Per-pixel bisect on ONE scene (`country-dusk`, 4 cars, no city, the cleanest ×3):** with `.work-opensa`
   kept (`--keep-work`), rect-repack its cells (`opensa-pack --rect x0,y0,x1,y1 --no-ao --checkpoints …`)
   from the pack input with one mod layer removed at a time (64, 65, the pow2 resample off, the vegetation
   layer, `lod-always`), serve the probe pak, run `?bench=country-dusk` on it. Instrument:
   `scripts/debug/model-repack.ts` for one model, `opensa-pack --rect` for the area — never a full rebuild
   per arm (CLAUDE.md standing rule).
4. **If no single layer owns it:** an alpha-class census of the country cells' materials on the 08-17 pak vs
   the 08-11 one (`dump-cell.ts` — cutout / softBlend / opaque counts and the textures they bind); a
   softBlend that used to be opaque, or a cutout that stopped writing depth, is exactly a per-pixel ×3 with
   no draw-count change (plan 092's class, in reverse).
5. **Only then a fix**, and it goes through the same lane before it is called one.

## What NOT to do

- Do not "fix the cars" — arm B says they are not the cost.
- Do not compare a capped in-game row against an uncapped headless one as a delta; the capped lane answers
  "does it hold 120", the uncapped one answers "what does it cost" (`docs/development/benchmarks.md`).
- Do not rebuild the pak per hypothesis — the rect probe and the one-model lab are minutes, the pipeline is
  ~50; and a run that dies is resumed (`--resume`), not restarted.

</details>
