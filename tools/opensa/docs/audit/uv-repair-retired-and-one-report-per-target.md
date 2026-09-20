# Audit — the field retires the UV repair; the merge; one report per target (2026-08-11, session 3)

The session that closed the 025 arc. Three moves, in the order the user called them: the `repair-uv-stretch`
pass — built the previous session, shipped for less than a day — was reversed by his first before/after look
and RETIRED; `025-world-visibility` was merged into main; and pmb plan 005 (one report per target) was
implemented the same afternoon, unblocked by that merge.

Commits: `a3013fce` (retire the pass) · `f5c1e2ac` (postmortem + docs) · fast-forward merge → main ·
`825d2d8a` (plan 005) · `288bfef8` (open-issues entry). Tests **4 101 → 4 105 → 4 106**, all green.

## 1. The repair died at the only gate it had never faced

The user walked the repaired intersection and reversed it in one sentence: *"we only made it worse"*. The
before was a soft continuous smear; the after was sharp triangular wedges of crisply mis-set texture. Both
halves are structural, not bugs — the full reasoning is
[`postmortem/uv-stretch-repair.md`](../postmortem/uv-stretch-repair.md):

- every split vertex the pass appended is a hard UV seam, so a partial repair (roads: 16–21 % coverage) of a
  CONTINUOUS defect is patchwork by construction;
- the mapping it wrote is invented — there is no authored frame to restore into (model fit residual ~1.8 UV),
  and per-face anisotropy cannot see "helps the metric, looks worse".

Retired the same hour, his call: pass + test + gate list deleted, ledger plumbing unwound, plan 025 CLOSED
with the diagnosis standing (it IS R\*'s data; the optimizer moves 0 UVs), postmortem written, the
restriction rewritten — a repair of authored data must be demonstrated **to the eye**, and if the only
honest test is a field round, the field round comes BEFORE the pass ships in a build the user will judge.
The problem itself is shelved, not solved: the living entry is
[`open-issues/texel-smear-authored-uv.md`](../open-issues/texel-smear-authored-uv.md) (127 models / 134
placements; the known-viable exit is hand-authored UV fixes as a data mod, shape undecided).

**What it cost / what it bought.** Cost: one build's worth of a pass that shipped and was deleted, plus a
`build/original/opensa` that still carries the repaired models until the next rebuild. Bought: a proof by
field that this defect class is unrepairable without authored intent — recorded in three places (postmortem,
restriction, open issue) so the circle is not walked again — and the previous session's diagnosis machinery
(scanner, world gates) intact and rerunnable.

## 2. Plan 005 — planned in the morning, shipped in the afternoon

The merge unblocked it (its own text said "lands after that merge"). What landed (`825d2d8a`):

- **`<out>/report-<target>.json` per target that runs** — the runner collects typed fragments a chain stage
  RETURNS (`ChainOutcome`; today only `optimize` produces one: totals + isolated failures), and each target
  branch assembles its report at the end of its chain. `sa` — which ships to the real game and never had a
  machine-readable summary — now records its census, FLA pools, lift requirements and asi sha.
- **The root `report.json` is gone, and it broke nothing — measured, not assumed**: it was byte-identical to
  `opensa/pak/report.json` (852 651 B both), and every code consumer (`crosstxd-fix`, `txd-retune`, the
  engine-lab bench) reads the pak-side report. The pack fragment is a summary + pointer, never a copy.
- **`.work-<target>`** — building one target no longer deletes the other's kept stages under `--keepWork`.
  The legacy shared `.work` is still cleared (it was wiped every run by contract). En route the overlap
  guard's prefix check turned out to read `.work-opensa` as inside `.work` — segment-aware now, with a test.
- Deliberate scope cuts, stated in the plan: `build-timings.json` keeps its name (benchmarks reference it;
  the timings are also embedded per report), and a run stopped in the common chain writes no report — no
  target finished.

Verification: 12 new tests in `pipeline.test.ts` (the overwrite regression, `.work` coexistence, legacy
clear, stopped-early, the fragment path through a mocked optimizer). No frame path was touched, so no
benchmark; the build-side numbers land with the first real rebuild, which was starting as this audit was
written — its `report-opensa.json` / `report-sa.json` are the live check.

## What would have made it cheaper

- **The repair should never have shipped in a build ahead of its field round.** The restriction file had
  already said the field labels are the gate; the pass still went into `build/original` before anyone looked
  at a repaired road. One comparator session earlier and the retirement would have cost a branch revert
  instead of a shipped-and-deleted pass plus a poisoned build.
- The plan-005 consumer audit took minutes because the root report had NO readers — but that was luck found
  by grep, not design. The habit worth keeping: measure who reads an artifact before renaming it, every time.
