# Session 5 audit — five chains closed, and a delta that cannot exist

**2026-08-12.** Nine commits, **33 files** (three source, two test, the rest record). Suite **4 106 → 4 110
green / 454 files**, coverage 91.92 / 82.6 / 92.09 / 92 against floors 86 / 77 / 88 / 86. Continues session
4's plan audit: that session swept 178 phantom tasks out of ten chains, this one finished the seven that were
left unverified.

## What the session was

The user's order from session 4's close: finish the plan audit, then a new plan. The audit was the whole
session. Seven chains were named as unverified — `079`, `082`, `085`, `097`, `099`, `100`, `102` — and the
method was session 4's: **read the status banner first, then verify one claim against the tree, then strike
or keep.** Six of the seven were closed. What they cost tells the story better than the count:

| Chain | Boxes claimed open | What they actually were |
| --- | --- | --- |
| 079 | 1 | already satisfied; one lint + coverage run away, and an empty ledger that had to stay empty |
| 082 | 4 | 2 phantom, 2 real work — shipped this session |
| 085 | 5 | 4 phantom (answered elsewhere in the same file), 1 real field check — the user drove it |
| 097 | 7 | 6 a duplicate of a chain that shipped beside its code, 1 superseded by a user decision |
| 099 | 2 | both real measurements — taken, except one that cannot be taken at all |
| 100 | 0 | closed, but with no banner and one stale verdict row |
| 102 | 0 | genuinely closed; both cited commits verified present |

**Nineteen of the twenty-one boxes were record, not work.** Two were work, and both were in 082.

## The work that shipped (082, the only source change)

- **F2 → Vehicles → "Plate (blank = auto)"**: type a plate for the next spawns. Up to the eight cells a
  plate has, upper-cased, stored ON THE PLACEMENT so a LOD respawn re-applies it. `PlatePlacement.plate` and
  `VehiclePlacement.plate` already existed — the new code is the input, a widened
  `spawnVehicle(model, plate?)`, and one spread into the placement. The override still resolves through the
  same `resolvePlate` every other spawn path uses.
- **The damage/detach lifetime claim, pinned from both ends.** `engine.plates.test.ts` hides the `_ok`
  submeshes and hands a part its own world matrix (what `detachPart` does), asserts zero writes to the
  `vehicle-plates` buffer, then forces a capacity grow and asserts the row returns — proof the state was
  RETAINED, not merely unwritten. `vehicle-damage.system.test.ts` drives the real system through hit →
  deform → hit → detach → past `FALL_TTL` against a real `PlateSlots`, then shows the atlas has nothing
  evictable and the car's own raster still hits without recomposing. If a release is ever wired into the
  detach path, that is the test that fails.
- **Plus the pass-through the audit itself asked for** (added in this audit, not before it):
  `engine-debug-actions.test.ts` now pins that an empty field spawns with the argument ABSENT — not `''`,
  which would give the car a blank plate instead of its deterministic one.

## The finding worth keeping: a broken handoff reads exactly like a decision

082's "Left unmeasured" deferred four field measurements to the 0.5.0 vehicle round on 2026-08-01, naming
098. **098 carried no plate task at all** — grep-empty. For eleven days "deferred to 098" and "dropped" were
the same state, and nothing in either document could tell them apart. They are now a row in
[098/08](../plans/098-all-land-vehicles/08-acceptance-close.md).

The general shape: **a deferral is only real when the receiving document says so.** A pointer out is a
claim about another file, and this session found two of them false in different directions — this one, and
100's verdict row (below) which claimed something was NOT done that had been done the same day.

## 099 — the measurements, and the one that cannot exist

Taken, off the BUILT fixture rather than the source:

- **Observed cadence = authored cadence.** The engine's own walker steps the ferris strip **130 times across
  the 29.25 s loop — 0.225 s exactly**. The per-gap spread (0.2167–0.2333 s) is one sampling tick either
  side; raising the sampler to 240 Hz tightens it to 0.2208–0.2292, which is the instrument's own self-check.
- **Advance cost 128–132 ns/call** over 2 000 000 calls with the real 261-keyframe `f13d`, plus one 16-byte
  write — 0.0016 % of an 8.33 ms frame, for the one animated model the world has.
- **An 8-scene sweep** on the 2026-08-11 pak, recorded as the standing frame number of the day.

**The before/after guard cannot be built on this build, and that is a result rather than a gap.** Two
attempts, both recorded so nobody repeats them: reverting the commit onto HEAD conflicts with later engine
work (including an unrelated `drawClutter` signature change — a hand-merged arm is the instrument this
project has been misled by before); and a worktree at the commit pair BOOTS but renders **zero frames**, both
sides dying identically on `texture array 5 not loaded`. The incompatibility is engine-era vs pak-era and
says nothing about the lane. What replaced the delta is a bound stated as one: **one integer compare per
rigid submesh bind**, no allocation, no per-frame write, no extra rebind for a model that animates nothing.

## What the audit itself produced (the meta-work)

- **`scripts/debug/uv-anim-measure.ts` was written as a throwaway and then kept** — it produced two of the
  numbers that closed 099, which is the repo's own definition of a debug script worth keeping. Row added to
  `docs/debug/README.md`. Writing it as `.tmp-` first and only then noticing was the mistake; the rule reads
  "when a script proves useful", and it had.
- **Two silent traps recorded in `docs/development/benchmarks.md`.** A worktree that symlinks the repo's
  `node_modules` resolves `@opensa/*` back into the MAIN checkout, so the "old" arm runs today's engine and
  the A/B measures nothing — it announced itself only as a Vite path warning. And a zero-frame arm still
  emits complete-looking `[bench]` rows (`avgMs: 0`, `frames: 0`), so `frames` must be read before any
  column.
- **097's paperwork moved beside its code.** `08-authoring-sdk.md` was a second copy of a chain that shipped
  on 2026-08-06 as `cleo/sdk/docs/plans/`; what lived ONLY in it (the goals check, six decisions, the
  why-now, out-of-scope, the chain ledger) moved into that chain's readme and five inbound references were
  repointed. `docs/plans/097-cleo-basic/` now holds the engine side only.

## What it cost, and what it bought

**Cost:** one session, three source files touched (all of them the debug spawner's path), 33 files total. No
behaviour outside the F2 panel changed — the suite moved only by the four tests added.

**Bought:** the plan record now answers "what is left" correctly. Before this session and session 4, that
question returned 199 boxes across seventeen chains; **the honest answer today is one chain (`101`,
unverified) and one PLANNED chain (`098`) that has not started.** Two documents that pointed at each other
and disagreed were made to agree. And 082's deferred field work exists in the place that will actually run
it, instead of in a sentence pointing at a folder that had never heard of it.

## The lesson this session adds

**A cross-reference is a claim about a file you have not opened.** Session 4's lesson was that the banner
outranks the checkbox; this one is its neighbour: when document A says "deferred to B" or "not done, see B",
B is where the truth is, and B disagreed twice out of two here. The check is cheap — one grep — and it was
the difference between "deferred" and "dropped" in one case and between "open plan" and "closed plan" in the
other.
