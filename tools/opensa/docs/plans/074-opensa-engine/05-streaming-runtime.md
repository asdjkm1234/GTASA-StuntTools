# 074·05 — Streaming runtime & the memory model

[← chain](readme.md) · prev: [04 lab+P0](04-engine-lab-p0.md) · next: [06 effects](06-world-effects-parity.md)

The plan-060 semantics (rings, hysteresis, keep-old-until-replacement, atomic swap) re-implemented THIN and
three-free, plus the memory model that designs out the 073 heap catastrophe. The prod `StreamingSystem` is NOT
ported (it's three-`Object3D`-shaped); its BEHAVIOUR is — against the same tests where possible.

## Cell lifecycle

```
desired (rings around view, hysteresis dead-band)
→ fetch: worker reads pak RANGE (Cache API/HTTP Range) → transferable ArrayBuffer to main
→ create: buffers + bind groups + record bundle (all synchronous, bounded: ONE cell per frame max)
→ live: replayed when frustum-visible (cell-sphere test)
→ evict: leaves rings → destroy buffers/bundle → residency ledger drops (assertion on leak)
```

- **No parsing on main** — the format IS the GPU layout; "create" is `writeBuffer` + bundle record.
- Record cost is bounded (≤ 8 groups/cell) — measure it in M1; if a record frame exceeds budget, split
  record across 2 frames (bundle-per-group makes this trivial) — decide on numbers, not preemptively.
- HD↔LOD swap = load new level, then unload old on the SAME frame (atomic — no hole, no double-draw).

## Memory model (the 3.5 GB lesson as architecture)

| Store          | Policy                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Pak bytes      | NEVER whole in JS; worker range-reads only                                                                                     |
| Cell blobs     | transferred, uploaded, **released** — JS holds handles + metadata                                                              |
| GPU residency  | ledger by category (world VB/IB, textures, targets); budget with headroom alarm in HUD                                         |
| Texture arrays | district-shared, refcounted by live cells; evicted when count hits zero (hysteresis delay to avoid thrash at district borders) |

Target steady numbers (M1 ledger): JS heap **< 500 MB and flat** while driving; GPU residency bounded by rings.

## Stress matrix (M1 gate — the exact scenarios that killed 073)

| Scenario                                     | Pass                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| ls-noon flythrough (bench path, drive speed) | no frame > 20 ms; heap flat                                             |
| Camera whip 360° (repeat 10×)                | no frame > 20 ms (culling churn only — bundles replay, never re-record) |
| Cold start                                   | < WebGL prod today; zero steady-state pipeline compiles after veil      |
| Teleport (worst case: full ring turnover)    | recovers < 2 s, no leak, no device pressure                             |
| 30-min soak drive (scripted loop)            | heap/residency flat lines; zero long tasks                              |

## Tasks

- [x] Worker IO (M1 v1, 2026-07-12): `pak-worker.ts` — pak bytes live WORKER-side (main never holds them),
      range slices arrive as transferables. NOTE: worker fetches the whole pak once (vite dev middleware
      doesn't guarantee HTTP Range) — true Range-only reads move to the production-server task below.
      Prefetch/velocity-lookahead not yet (rings request on demand).
- [x] Thin streaming driver (M1 v1): `stream/streaming.ts` — rings (HD 380 / LOD 1000 engine units) +
      hysteresis 60 + atomic HD↔LOD swap (unload same frame) + bounded ≤1 create/frame + eviction with margin;
      HUD line: loaded/pending/created/evicted/worst-create. Modes: `?pak=1&stream=1`, stress =
      `&bench=drive`.
- [~] Residency ledger + HUD panel + leak assertions (unload-all test).
- [~] Texture-array refcounting + border-thrash hysteresis.
- [~] Record-cost measurement; split-record fallback only if the number demands it.
- [~] Script the stress matrix; run in Chrome + Safari; fill the ledger; M1 verdict in the umbrella.

## Measurement ledger

**2026-07-12 — drive bench (M3 Pro, 2× retina, wider LS rect, `?pak=1&stream=1&bench=drive`, 600 frames):**

| Metric                                              | Value                                                        | Gate                                                            |
| --------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| frame max                                           | **9.80 ms** (p95 9.30, avg 8.33 = vsync)                     | <20 ms ✅ — streaming never broke a 120 Hz beat                 |
| worst cell create (load+upload+record)              | **1.1 ms**                                                   | the "split record" fallback is unnecessary — decided on numbers |
| submit p95 / max                                    | 0.30 / 1.0 ms                                                | ✅                                                              |
| GPU p95 / max                                       | 1.77 / 4.19 ms                                               | ✅                                                              |
| main-thread JS heap                                 | **8 MB** (pak lives in the worker; blobs freed after upload) | vs 3.4–6.2 GB on the 073 path                                   |
| GPU residency                                       | 288 MB, stable                                               | bounded ✅                                                      |
| 42 cells created during the drive, 0 pending at end |                                                              | atomic swaps invisible                                          |

**M1 core gates: PASSED.** Remaining M1 scenarios (quick follow-ups, not blockers): camera-whip 360°,
teleport (full ring turnover), 30-min soak (heap/residency flat lines), unload-all leak assertion.

## M1 stress tails CLOSED (2026-07-12, after the revisit field bug)

The field caught a driver-lifecycle bug the one-way benches never could: `requested` marked keys forever
while blobs are consumed on create → REVISITED cells could never re-fetch their level (stuck at LOD on
approach). Fixed (`requested` = in-flight only; error responses clear it and retry with a console warning)
— and the missing stress scenarios landed the same day so this class stays caught:

- `?bench=whip` — fast 360° street-height spins (frustum churn, promote/demote storms);
- `?bench=teleport` — six district-corner jumps, 300 frames each, INCLUDING a revisit hop (the exact
  pattern of the field bug);
- `?test=leak` (streaming mode) — sweep-load → `unloadAll()` → the residency ledger must return to its
  post-texture baseline; HUD turns green/red, console prints the diff. The driver gained `unloadAll()`.

## Range-read IO landed (2026-07-12, integration round)

The pak worker auto-detects at init (probe `Range: bytes=0-0` → 206): RANGE mode fetches entries on demand
(the multi-GB pak never resides in memory — the 4 KiB alignment finally earns its keep); servers that ignore
`Range` fall back to the M1 whole-pak mode. Verified against the vite dev server: GET honours ranges
(`bytes=0-15` → exactly 16 bytes; NB its HEAD handler misreports Content-Length — probe uses GET).
Startup transfer for full-LS drops 1.15 GB → ~212 MB (the district-wide texture arrays; per-ring texture
laziness is a later option).

## Full-map field note (2026-07-13)

First whole-map flight (`pak-map`, bakeless) field-checked: overall verdict positive; the user sees
OCCASIONAL DRAW/STREAMING GLITCHES and explicitly deferred them to the
in-game integration phase (plan 10 B3 — streaming follows the PLAYER there, different rings/velocities).
Revisit together with the parked tuning candidates below; the `?bench=map` whole-map tour (074/11) is the
reproduction harness. The `map` bench itself was CLEAN (no holes, no stuck LODs across 9000 frames).

Specific field symptoms to fix in that round (both re-observed on the free-fly, not the bench path):

1. **Late objects** — a cell sometimes stays unloaded until the camera MOVES slightly, then appears.
   Suspect: rings request on demand + the hysteresis dead-band — a stationary/straight-line camera can sit
   just outside the request edge; the parked velocity-lookahead prefetch likely covers it. NB tested
   WITHOUT the opensa-lods chain — re-evaluate once lod-generator cells join the pak.
2. **Magenta-before-texture** — on first appearance an object briefly renders PINK, then the texture lands.
   Magenta is the converter's missing-texture colour, so the CELL bundle is drawing before its texture
   ARRAY is GPU-resident — a hole in the warm-invisibly/atomic-appear invariant (plan 060): cell create
   must WAIT for (or be gated on) its referenced arrays' residency instead of falling back to the
   placeholder layer.
3. **HD↔LOD swap visibly steps** at speed — user explicitly defers until the full game mechanics are
   wired on top; tune with the post-integration candidates below.

## Post-integration tuning candidates (parked 2026-07-12 — **UN-PARKED 2026-07-17 into plan [21](21-fog-draw-distance.md)**)

> The 2-creates/frame and velocity-prefetch candidates below (plus a `lateCreates = 0` gate and the
> fog ⊂ LOD-ring invariant that makes them matter) are now plan 21 phase 3. The in-flight request cap
> stays optional there. This section remains as the original analysis.

The full-city `city` bench (135 u/s traverse) held 120 Hz for ~3595/3600 frames; the couple of 21.9 ms
spikes trace to the ≤1-create/frame budget at speed (submit max 7.1 ms). Two candidates, deliberately NOT
taken now:

- **2 cell-creates per frame** when the pending queue backs up (double the worst-frame create cost — needs
  the bench to confirm it stays under budget);
- **velocity-vector ring prefetch**: bias the HD/LOD rings ahead along the camera's velocity so cells are
  requested earlier at speed (cheap, pure driver logic);
- **in-flight request cap**: teleport hops queue a full ring of wanted blobs (~257 MB transient heap while
  the 1-create/frame budget drains) — capping outstanding fetches (~8) bounds the transient at the cost of
  slightly slower rebuilds. Field rows: whip heap 736 → 55 MB after stale-blob pruning; teleport max 13.8 ms.
