# 06·3·04 — ASI peds: sidewalk life inside real San Andreas

[← chain](../readme.md) · prev (engine twin): [03 ped sim](03-ped-sim.md) · needs: 2/05 machinery live (tick, factories pattern, catalogue)

Peds return to the suppressed streets (1/01) under our simulation. Follows 2/05's staging philosophy
and reuses everything it built (the ASI's sim tick, `ThePaths` ped-graph reading, the Wine ladder);
this plan is the ped-specific RE + the ped ring bridge.

## Staging

1. **v1 — ring 0 only**: materialize real `CPed`s near the player from our sidewalk agents through
   SA's own factories, walking our links via SA task primitives (bring-up), then via direct heading/
   speed control if tasks fight us (the 2/05 v2a→v2b pattern; decide by RE findings, record which).
   SA remains animation + collision host — its ped anim system is exactly right for ring 0 and free.
2. **v2 — far silhouettes (optional, measured first)**: SA has no instanced crowd path; drawing
   hundreds of far peds through its renderer is a cost we must MEASURE before designing (RE: the
   sprite/billboard seams the corona work uncovered, or lightweight `CObject`-class puppets). If the
   honest answer is "not worth SA's frame", ring-0-only ships as the SA host's final ped shape and the
   decision is recorded here — far ped life is worth less than far traffic light rivers by every AAA
   reference anyway.

## The ped-specific compatibility questions (answered by RE before v1 ships)

- Provenance: our peds must be invisible to mission logic the way ambient peds are (script sweeps,
  `Decision/` reactions, gang/cop counting) — catalogue how CPopulation tags ambient vs scripted and
  land on the ambient side of every check.
- Pool budget: CPed pool headroom counted against the install's FLA ini (never bisected); our ring-0
  ped cap derives from it with stated margin.
- The wanted system: cops are NOT ours (1/01 leaves police response vanilla); our peds must not
  register as crime witnesses/victims incorrectly — RE the witness seams, validate with a
  crime-near-our-peds Wine scenario.

## Goals gate

1. *Authored data:* same densities/mixes as the engine track, via the same fixtures.
2. *Original:* CPopulation replaced as a feature, its mission-facing semantics preserved.
3. *Better:* sidewalks alive with signal-obeying crossers in a game whose vanilla peds jaywalk;
   demonstrated in the twin capture (same seed, same street, engine vs SA).
4. *Cost:* SA frame delta measured per stage under Wine; v2 gated on its own measurement.
5. *Contract:* ini-gated (`peds` section in `city-life.ini`); removal restores vanilla.

## Tasks

- [ ] RE session: CPed factory/ownership/cleanup, task or control seams, provenance + witness checks —
      catalogue rows per the two-source rule.
- [ ] v1 bridge (materialize/demote on the ASI tick) + fixture parity for walk positions.
- [ ] Wine ladder incl. the crime-witness scenario and a mission sample with heavy scripted-ped
      missions.
- [ ] v2 measurement → build or record the skip with numbers.
- [ ] Twin capture; docs (catalogue, features entry, this file's numbers).

## Measured numbers

- Ring-0 ped cap vs pool headroom: —
- SA frame delta v1: —
- Parity divergence per fixture: —
