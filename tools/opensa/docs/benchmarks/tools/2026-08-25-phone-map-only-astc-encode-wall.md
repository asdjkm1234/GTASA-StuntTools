# 2026-08-25 — the phone's map-only convert: the weld is 2.7 %, the ASTC encode is the rest

**Tool:** `opensa-pack`, driven by `scripts/phone.sh` through the phone console's **Map only** button
(`MODELS=0 BAKE=0`).
**Inputs:** `game-src/original`, district `los-santos-wide` (rect `4,-8,7,-5` — 16 grid cells, four times the
pinned district's four), `--textures astc --astc-threads 1 --max-texture 256 --no-ao --platforms mobile`,
heap 4096 MB.
**Machine:** the development phone (Huawei `MGA-LX3`, ARM Bifrost, Termux). Every earlier row in this family
was measured on a desktop — **this one is not comparable to them** and is not meant to be; it is the first
tool-build timing taken on the device the console is aimed at.

Recorded before being read, per the standing rule. Source: `build/.phone/panel-jobs.log`, the panel's own
job log ([201/3](../../plans/201-dispatch-console/3-the-operator-surface-on-a-phone/readme.md) — it exists
because this device kills the panel that used to hold the only copy).

## The run, as logged

| at | line | Δ |
| --- | --- | ---: |
| 23:23:11 | job started | — |
| 23:23:19 | wake lock held; convert begins | 8 s |
| 23:23:29 | `loading game dir …` | 10 s |
| 23:23:54 | `plan: 1 chunks / 16 grid cells (chunk 6², bake ring 0)` | 25 s |
| 23:25:11 | `chunk 1/1 [4,-8,7,-5]: done in 76.6s — 16/16 cells (100 %)` | **76.6 s** |
| 23:25:11 | `encoding texture arrays …` | — |
| 23:28:32 | `astc: array 1/26 — 4.2/56.5 M texels, elapsed 198s, eta ~2469s` | 201 s |
| 23:29:36 | `astc: array 3/26 — 5.2/56.5 M texels, elapsed 262s, eta ~2556s` | 64 s |
| — | **killed by Android here**, 6 m 25 s into the run | — |

(The log stamps were UTC in this run and the device runs UTC+3; they are local from the commit that files
this row.)

## What it says

**The weld is not the cost. The encode is.** 16 cells welded in **76.6 s** — the whole geometry half of a
map-only convert, done in under a minute and a half. Then the ASTC pass reported **26 arrays / 56.5 M texels**
and an ETA that climbed as it went: **~2 469 s after the first array, ~2 556 s after the third**. Taking the
encoder at its word, the run was **~77 s of weld and ~2 550 s of encode — the encode is 97.1 % of it**.

**`--astc-threads 1` is why, and it is not a mistake.** The cap exists because the default (one worker per
core) spawns a V8 isolate per worker, each reserving its own code range, and three phone converts died at
exactly this stage with it ([the note in `astc-encode.ts`](../../../tools/opensa-pack/src/astc-encode.ts)).
So the encode runs on the main thread, and 56.5 M texels through one thread on a Bifrost-class phone is
roughly **45 minutes**.

**The kill came at 6 m 25 s**, which is well inside any of the three battery settings' patience — so on this
device an ASTC convert of this district cannot finish, and no OEM setting changes that arithmetic. The
lever is the encode, not the killer.

## What it changes

- **`TEXTURES=rgba8` removes 97 % of this run.** Same weld, no encode; the district's textures ship
  uncompressed (56.5 M texels ≈ 226 MB at RGBA8 against ≈ 56 MB at ASTC 4×4, before `--max-texture 256`).
  For getting a map on screen on this device that is the trade, and it is the A/B's other side anyway
  ([200/2-02](../../plans/200-platform-reach/readme.md)).
- **The pinned district is a quarter of this.** `los-santos-centre` is 4 cells against 16, so ~14 M texels —
  a weld around 20 s and, at RGBA8, a convert that finishes in a couple of minutes.
- **The weld checkpoints save 77 s of 2 630.** `phone.sh` journals every weld chunk and resumes from it, but
  the encode happens after the chunk loop and is not checkpointed at all — so for THIS shape of run the
  resume covers 2.9 % of the wall clock. It is worth what it is worth on a bake-and-models convert, where
  the weld dominates; it is close to worthless on a map-only ASTC one. Filed as
  [`docs/in-reserve/opensa-pack-encode-checkpoints.md`](../../in-reserve/opensa-pack-encode-checkpoints.md)
  with the condition that makes it real work.
