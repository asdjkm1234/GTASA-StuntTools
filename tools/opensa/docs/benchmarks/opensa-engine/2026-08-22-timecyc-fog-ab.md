# 2026-08-22 — timecyc fog A/B: the floor, and the three source tables

Plan [104/04](../../plans/104-timecyc24h-source/readme.md). Recorded before it is read, per the standing
rule. **This is a LOOK A/B, not a frame-cost run** — the only cost number here is the boot parse, at the
bottom. The one figure it turns on is the fog contribution AT THE CAMERA, which is what a negative authored
`FogSt` produces and what `Math.max(0, …)` was throwing away.

## Conditions

- Build under test: `build/original/opensa`, built **2026-08-22**, **not rebuilt** for this A/B. Served with
  `npm run serve:static`, booted through the real load path (`?loader=http-dir&src=…`).
- Engine code: `main` at `f1ae2c5c` for the unfloored arms; the floored arm is that commit with the one
  line reverted in the working tree and restored immediately after (checked back to 0 occurrences).
- Capture: headless Chromium, 1440×900, DPR 1, ~20 s settle, `.sa-capture` hidden.
- Pose, identical in all nine shots: `spawn=-1960,505,36` (SF downtown plaza, `grounded 1`, z 35.1),
  `look=-2400,520,30` — a street with ~250 u of depth. **`weather=9` (FOGGY_SF) and the player standing in
  SF**: the city-zone remap rewrites a weather that has no variant for the region the player is in, so this
  pair has to be chosen together (a FOGGY_SF forced in LS becomes SUNNY_LA before the first frame).
- File-move ledger: one move, `build/original/opensa/data/timecyc_24h.dat` → `.ab-aside` for arm C only,
  **restored the same minute**; the built tree is back to four `timecyc*` files. Every boot printed the
  step-02 line and it agreed with the arm every time:
  `[timecyc] data/timecyc_24h.dat (authored-24h, 504 rows)` for A/B, `data/timecyc24h.dat (dante-24h,
  552 rows)` for C.

## The arms

| Arm | Code | Table that won | Why |
| --- | --- | --- | --- |
| A | fog start floored at 0 (the old behaviour) | our generated 504-row table | the BEFORE |
| B | fog start as authored | the same 504-row table | what the fix alone changes |
| C | fog start as authored | Dante's 552-row `timecyc24h.dat` | what the next build will resolve to |

**Arms A and B differ only in the code, and A/B vs C only in the table.** Note the generated table and the
stock expansion are IDENTICAL in fog: `npm run timecyc` merges RealVision into `Amb`/`Amb_Obj`/`Sky top`/
`Sky bot` and the whole of `CLOUDY_LA`, and never touches `FogSt` or `FarClp`. So arm B is also the reading
for a world carrying only the stock `timecyc.dat`.

## Fog contribution at the camera (0 u), FOGGY_SF

Computed with the engine's own curve (`1 − exp(−(k·d)²)`, `k = 2/(cut − start)`), at ground level:

| Hour | A — floored | B — stock/ours as authored | C — Dante as authored |
| --- | --- | --- | --- |
| 12 | 0 % (start 0 / cut 250) | **4 %** (−30 / 250) | **83 %** (−500 / 250) |
| 18 | 0 % (0 / 164) | **27 %** (−64.3 / 164.3) | **91 %** (−700 / 200) |
| 21 | 0 % (0 / 150) | **43 %** (−90 / 150) | **15 %** (−20 / 80) |
| 0 | 0 % (0 / 150) | 73 % (−200 / 150) | 97 % (−1600 / 80) |

Hour 21 is the row worth keeping: **Dante is LIGHTER than stock there.** The arms track the authored table,
not a global "more fog" bias, which is the control this A/B needed.

Screenshots (nine, one per arm × hour) are attached to the session, not committed — they are 1440×900 PNGs
of a build that will be replaced by the next one.

## What the pictures show

- **A → B at noon is almost nothing** (0 % → 4 %) and at 18:00/21:00 it is a visible wash of the whole
  frame toward the fog colour. That is stock's own authored near haze, which the floor had been discarding
  on 112 of its 504 rows.
- **B → C at noon is the whole frame** — the street beyond ~50 u is gone and the player at 5 u is already
  hazed. It reads as real dense fog rather than as a bug, and FOGGY_SF is the weather that should look like
  that, but it is a large change and it is the user's call.
- Nothing else moved: `draws` 432 in both noon arms, `residency` 1412 MB, `grounded 1`, same pose.

## Verdict (the user, 2026-08-22)

**Arm C rejected** — *"вариант Dante нам не подходит"*. The shots he named as good: `A-floored-h12`,
`A-floored-h21`, `B-unfloored-stock-h12`, `B-unfloored-stock-h21`, `probe3` (same configuration as
`B-…-h12`). No arm-C shot among them. Since arm A and arm B are both in the list at BOTH hours — including
h21, where they read 0 % against 43 % at the camera — the unfloored fog start is accepted and what is
rejected is Dante's authored table.

**Scope of that verdict**: it is about the VALUES in one table, not about the format. Reading a
`timecyc24h.dat` is supported unconditionally (plan 104/01-03, `docs/contracts/mods.md` §2) and nothing in
this A/B changes that — a mod shipping one in the `opensa` layer works whatever we think of Dante's numbers.

## The only cost number: boot parse

`buildTimecyc(ensure24h(parseTimecyc(text)))`, 200 samples after 20 warm-ups, same machine, same session:

| Table | Bytes | mean | median | p95 |
| --- | --- | --- | --- | --- |
| stock `timecyc.dat` (184 rows) | 40 037 | 0.859 ms | 0.845 | 0.934 |
| ours `timecyc_24h.dat` (504) | 95 347 | 1.698 ms | 1.681 | 1.797 |
| Dante `timecyc24h.dat` (552) | 281 915 | **2.016 ms** | 1.983 | 2.218 |

**The 552-row table costs +0.32 ms over the 504-row one, once, at boot.** The plan expected "unmeasurable";
it is measurable and it is irrelevant — 0.3 ms against a boot that streams a gigabyte. Said with the number
rather than as a guess, which is why it was measured.

Note the byte column: Dante's file is 2.96× the size for 1.10× the rows because it is written with heavy
column padding. The parse cost tracks rows (×1.19), not bytes (×2.96).
