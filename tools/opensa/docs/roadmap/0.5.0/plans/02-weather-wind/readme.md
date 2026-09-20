# 02 — Weather-driven wind (deferred from the 074 own-engine chain)

Deferred on 2026-07-12 (user decision, recorded in
[074/06 notes](../../../../plans/074-opensa-engine/06-world-effects-parity.md)): vegetation wind sway shipped
in the own engine (074/06 row 10) with a CONSTANT `windStrength` — the missing half is driving it from the
weather so bad weather reads windy.

## What already exists (nothing blocks this)

- Per-vertex sway amplitudes baked in metres (`nightPrelit.a`; opensa-pack `--wind` overlay dirs, to be
  embedded into the perfect-map-builder pipeline).
- Engine knobs: `Environment.windStrength` (multiplier, 0 = still air) + the wind clock in the frame UBO;
  lab override `?wind=N`.
- The environment drivers already sample timecyc per (hour, weather) — the rule slots in right there.

## The work

- Map weather IDs → wind strength (and possibly clock speed): sunny ≈ 0.8–1, overcast/fog ≈ 1.2, rain ≈ 1.6,
  storm/sandstorm ≈ 2+ — tune in the field; consider a short cross-fade on weather change (no snapping).
- Optional refinement carried from the 074 ledger note: per-kind sway SPEED (prod used palm 0.9 / tree 1.6;
  one shared speed shipped in v1 — no per-vertex speed byte in the format).
- Acceptance: `?weather=8` (storm) visibly windier than `?weather=0`; no pop when the weather blends.
