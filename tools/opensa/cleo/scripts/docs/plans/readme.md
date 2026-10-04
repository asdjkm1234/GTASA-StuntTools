# cleo/scripts — plan chain (authored replacements for the two corpus scripts)

Author OUR versions of the two shipping corpus scripts on the SDK (`cleo/sdk`): `rhino tracks.cs`
and `no_lights.cs`. One source, two runtimes — every authored script stays a conformance test of
the VM against real CLEO, and both replacements are measurably better than the originals (smaller,
cheaper per frame, and for rhino: a real chance to fix the tracks-don't-rotate defect).

**Provenance of the call (2026-08-06):** for rhino this RESTORES a recorded intent — the 097/07
ledger (defect row 7) already said *"User's call 2026-08-05: SKIP — 097/08 authors our own track
script instead"* — which the 097/08 scope-cut paragraph then contradicted ("rhino tracks stays the
author's script"). For no_lights it REVERSES the 2026-08-05 skip (the native light-damage recipe in
[`docs/postmortem/097-hotring-hotknife-intake.md`](../../../../docs/postmortem/097-hotring-hotknife-intake.md)
remains the engine half of plan 002, not an alternative to it). The superseded scope-cut lines in
the SDK chain's readme now point here (that scope-cut text moved into
[`cleo/sdk/docs/plans/readme.md`](../../../sdk/docs/plans/readme.md) on 2026-08-12, when
`docs/plans/097-cleo-basic/08-authoring-sdk.md` was deleted as a duplicate of the shipped SDK chain).

## The chain

| #   | Plan                                    | Delivers                                                                                                                                      | Status  |
| --- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | [001 — rhino tracks](001-rhino-tracks.md) | authored track script: `0AE2` walk, per-link loop, frames addressed BY NAME (`track_1`…`track_12`) — bypassing the sibling-order hack; both-runtime field proof | CLOSED - both runtimes field-proven |
| 2   | [002 — no_lights](002-no-lights.md)     | authored hotring light-killer + the engine half that makes it visible on OpenSA (atlas row for `SetLightStatus`, smashed-lamp state in vehicle-lamps) | engine half SHIPPED; the SCRIPT was WITHDRAWN 2026-08-07 - superseded by plan 098/11 |
| 3   | [003 — cutscene override](003-cutscene-override.md) | a real-SA debug instrument: `cutscene-override.ini` names a scene → it plays at new game (or save load) in place of sitting through the intro; the ini's comment head lists every vehicle cutscene, generated offline by vehicle-cutscene's tooling (census + the ANPK channel reader). Rewritten 2026-08-13 (user's call) from the cheat-code viewer — no cycling, no key polling. **Single-target by design** (`target: 'sa-only'` — OpenSA has no cutscene system) — the dual-target bar does not apply | CLOSED 2026-08-13 — all three field verdicts passed (scene plays in-world with warp+preload, ini is the knob, empty = inert); 12 field rounds, four recorded traps (boot race, missionless intro, byte-offset globals, ini reads corrupting vars) |

001 first: it exercises the SDK loop/name-lookup surface 002 reuses. It was planned as "script-only,
zero engine changes" and that assumption did not survive the field — writing the script was the
SMALL half. Three engine/VM defects had to be fixed before a correct script could do anything
visible, and none of them was findable from the script side:

- native-call argument order (`0AA5`-`0AA8` were reversed — `docs/edge-cases/cleo-vm.md`);
- the engine published no live wheel roll into the script-visible part state, so any script reading
  a wheel frame read a frozen angle;
- the wheel-fitting rule inflated a model's flat MARKER wheel 23.5x (`docs/contracts/vehicles.md`).

The lesson to carry into 002: **budget for the runtime under the script, not just the script.**
002 carries one deliberate engine seam (the smashed-lamp state) — that state is derived from damage
STATE, never from a model id, so any CLEO mod smashing lights benefits, not just this script.

## What "done" means for the chain

Each authored script: (a) compiles dual-target under the whitelist gate, byte-deterministic;
(b) headless story green within its declared per-frame budget, measured better than the original
it replaces (numbers in the plan ledger); (c) field-proven on OpenSA AND under real CLEO on the
canonical SA 1.0 US exe (Wine, manual verdict); (d) ships in the pak build in place of the
author's original, with the author's mod files in `mods-src/` left byte-untouched.

**002's script no longer exists**, so the bar below applies to 001 alone. The withdrawal is not a
failure of the chain's method: the script was correct, measured 19.7x cheaper than the original and
field-proven — it simply turned out to be treating a symptom the ENGINE should never have produced. The
reasoning and the numbers are in [002's ledger](002-no-lights.md); the replacement rule is
[`docs/plans/098-all-land-vehicles/11-model-derived-lamps.md`](../../../../docs/plans/098-all-land-vehicles/11-model-derived-lamps.md).

**(d) is waived for 001 (user's call 2026-08-07)** — the artifact is placed by hand and the
automated substitution is not built. The recipe and what a pmb rebuild does to it are in 001's
step-4 ledger entry. The waiver is per-plan, not for the chain: 002 keeps the full bar.
