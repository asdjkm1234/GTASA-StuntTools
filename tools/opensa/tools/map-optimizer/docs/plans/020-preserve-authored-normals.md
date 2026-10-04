# 020 — Preserve authored normals (sanity-gated, auto-detected)

**Status: DONE — built 2026-07-15, closed 2026-08-11 on the user's field verdict** (no shading problems across
four weeks of rebuilds; the scripted A/B was never run, see the last task). Implements option 1 of
the 0.4.0 normals-smoothing idea (graduated here, idea doc deleted) (plans 020–023 are the normals batch).

## Measured (vanilla `game-src/original`, 2026-07-15 probe — the phase-0 numbers)

Of 11 462 world models the optimizer processes, **103 carry authored normals** on at least one triangle mesh
(plan 17's "960 of 12 964" counted a wider model set). Gate verdicts at `repairFraction` 0.05:

| verdict                            | models                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| preserved (all vertices pass)      | **83**                                                                        |
| point-repaired (isolated failures) | **15** (369 verts total)                                                      |
| mass failure → full recompute      | **5** (`lodport01_lvs`, `crack_int1`, `y_generator`, `cardboardbox`, `rack2`) |

So 80 % of authored intent was being destroyed for nothing — now preserved byte-identical; actual garbage
still rebuilds. Note plan 17 measured all stored normals as unit-length: the 20 flagged models fail on the
WINDING check (normals pointing into the surface), which unit-length screening cannot see.

## Problem

`smooth-normals` rebuilds normals **unconditionally** on every mesh that has them
(`plugins/smooth-normals.ts` — only the `!mesh.normals && !addWhereAbsent` case skips). On the vanilla map
~960 of 12 964 world models ship authored normals — the only place an author expressed curvature intent.
The 45° crease rebuild destroys that intent: surfaces authored smooth across dihedrals > 45° (rounded kerbs,
pipes, arches, canopies) come back faceted. The 2026-07-15 full-map run confirms the blast radius: all
11 462 processed models were rewritten by `smooth-normals`.

## Detection is automatic — no curated lists

A model either carries a normals block or it doesn't (`mesh.normals !== null`); the gate below is pure
geometry. (Curated lists stay a prelight-only concept, where statistics genuinely can't tell "lights off by
design" from a broken export. Normals have a geometric ground truth.)

## Design

Per-vertex sanity checks on meshes that ship normals:

1. **Unit-ish**: length in [0.9, 1.1]; rejects zeroed blocks (dirty re-exports — the gta3-pf `casroyale`
   family, plan 037 runtime lesson) and NaN/Inf.
2. **Winding agreement**: normal vs the area-weighted average of incident face normals; dot < 0 (points
   "into" the surface, > 90° off) = broken. Vertices whose incident faces fully cancel (two-sided coplanar
   pairs) have no face evidence — treat as _unverifiable_, keep the authored value.

Per-mesh verdict from the failing fraction:

- **all pass** → keep the authored block verbatim (mesh stays byte-identical on this pass);
- **isolated failures** (≤ `repairFraction`, default 5 %) → point-repair only the failing vertices with
  their smooth-group normal (rebuild internally, apply selectively; no vertex splits for kept vertices);
- **mass failure** (> `repairFraction`) → full smooth-group rebuild as today.

Meshes without normals are untouched by this plan (`addWhereAbsent` path unchanged).

## Report

`applied` log + run report gain counters: `normals preserved / repaired / recomputed` (models and vertices).
The full-map numbers go into this doc after each phase (standing rule).

## Tasks

- [x] Phase 0 — map-wide verdict probe (numbers above). The screenshot-location fixture walk was replaced by
      the statistical probe + the 5-model recompute sample; per-location fixtures move to 021/022 where the
      look actually changes.
- [x] Sanity gate + per-mesh verdict: `tool-kit/mesh/validate-normals.ts` (`validateNormals` — unit-ish +
      winding agreement; two-sided cancellation/faceless = unverifiable → trusted), policy in the
      `smooth-normals` plugin (`gateAuthoredMesh`, `repairFraction` default 0.05; negative = pre-020
      always-rebuild).
- [x] Point-repair path: `repairNormalsInPlace` in the tool-kit core (smooth-group normal of the first
      incident face's group, applied ONLY to failing vertices, never splits).
- [x] Counters: per-asset `context.log` line + run-level `SmoothNormalsStats` printed by `run.ts`
      (`normals — preserved / point-repaired / recomputed / created`).
- [x] Tests: `validate-normals.test.ts` (7) + plugin gate cases (5) — 196 green across
      map-optimizer/tool-kit/opensa-lod-generator; tsc + eslint clean.
- [x] **Verification in the field — CLOSED 2026-08-11 on the user's verdict: the normals are fine, and have
      been through many rebuilds since.** No A/B session was ever run as scripted; what closed it is that the
      gate has shipped in every build the field has judged for four weeks (the map has been rebuilt whole
      several times, most recently 2026-08-11) and no shading complaint has ever come back. **That is a weaker
      instrument than the planned A/B and it is recorded as such** — it can only say "nothing visible went
      wrong", never "the repair helped". If a shading question ever arises, the A/B this box asked for is
      still the right first move: the 5 recomputed models against a few preserved ones at noon N·L.

## Non-goals

HD→LOD normal transfer (06 option 4) stays in the LOD generators' court. Per-material crease overrides are
plan 023.
