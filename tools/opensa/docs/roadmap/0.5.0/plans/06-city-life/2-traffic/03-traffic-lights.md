# 06·2·03 — Traffic lights & rail barriers (real controller logic)

[← chain](../readme.md) · prev: [02 driver AI](02-driver-ai.md) · next: [04 far rendering](04-far-rendering.md)

Intersections are the arbitration points: agents obey the node's controller, never negotiate pairwise —
the sim stays O(agents). One controller owns the phase; every consumer (our bulbs, our drivers, our
peds, and in 2/05 SA's own bulbs and residual AI) reads the SAME state (decision D6).

## Controllers

- Per-intersection **phase table**: phase → green links, durations, all-red gaps, ped walk phases.
  Advanced by the game clock, deterministic city-wide (same time → same phase — synchronized avenues
  come free, and the ASI twin lands on identical state by construction).
- Source: sidecar records (1/04) where authored; otherwise **auto-derived at load** from the graph —
  light-flagged nodes (1/02 full flag decode) grouped by proximity, phases split by approach heading
  (the NS/EW split SA's global timer approximated, computed per junction instead of globally). The
  auto-derivation is what makes the sidecar optional.
- Real-light behaviours the original never had (each a one-line justified improvement): amber interval
  derived from approach speed class, all-red clearance, ped walk/flash phases, deadlock breaker
  (a starved approach eventually gets its green).
- Rail crossings: state machine `open → warn → closing → closed → opening`, driven by train presence
  windows (4/01 schedules) with lookahead so barriers close BEFORE arrival; the gated road links carry
  a virtual red + "do not block" zone (the 2/02 box-junction rule). Barrier arms animate via the
  anim-objects part-transform path (the windmill/garage-door template — no physics, no moving collider;
  the ring-0 gate is the virtual red, not the arm's collision).

## Visuals (the engine truth)

2dfx light anchors are in the pak but today an anchor cannot be told apart from a street lamp: the DFF
parser reads the 2dfx `flags` byte and `coronaTexture` name and the weld DROPS them (`OscellLight`
keeps color/farClip/owner/position/size only). So:

- `.oscell` MINOR bump: carry `flags`, `coronaTexture`, and the owning model id for light anchors
  (minors add optional sections — the streaming-formats contract).
- Import-time binding: traffic-light-model anchors ↔ nearest controller node within a radius, colour
  role (red/amber/green head) resolved from anchor colour + local offset; editor-overridable (1/05).
- Runtime: a per-corona override channel in the corona pass (phase → which head is lit). Distant
  junctions read as breathing red/green — the night-city payoff. Corona bulb cycling closes the
  standing gap recorded in `docs/features/night-and-time.md` and `docs/edge-cases/engine-rendering.md`.

## Goals gate

1. *Authored data:* light-flagged nodes, light-model 2dfx anchors, barrier models' pivot dummies — all
   read as authored.
2. *Original:* a global 16 s timer split by world axis; recovered as the MEANING of the light flag,
   replaced as execution (per-junction controllers).
3. *Better:* the real-light behaviours above + one phase owner; demonstrated by the field acceptance
   (junction cycles correctly at any hour; zero light-runner defects chargeable to phase skew).
4. *Cost:* controllers are a few hundred table advances per second (noise); the corona override rides
   the existing instanced pass; budget stated in the 2/04 GPU gate.
5. *Contract:* sidecar intersection schema is 1/04's; the `.oscell` minor + new fields recorded in
   `docs/architecture/world-streaming.md` formats table.

## Verification

- Unit: phase advancement determinism (same clock → same phase), starvation-freedom, crossing
  lookahead math (train at v arrives after barrier closed + margin), auto-derivation on the fixture
  junctions.
- Field: one LS grid junction + one highway crossing observed over 10+ cycles at two hours of day —
  bulbs match controller state (debug overlay shows both), queues form and drain, no starved approach;
  barrier closes ahead of every train (4/01 integration), reopens after.

## Tasks

- [ ] Controller runtime + phase query API (link → phase, with approach position for stop-line math).
- [ ] Auto-derivation from flags + headings; sidecar override path.
- [ ] `.oscell` minor bump (flags/texture/model for light anchors) + weld changes + pack version note.
- [ ] Corona per-phase override channel; bind at cell load.
- [ ] Rail crossing state machine + virtual red + barrier arm animation.
- [ ] Field acceptance above; record numbers.
- [ ] Docs same change: features/night-and-time.md gap closed, world-streaming formats row,
      edge-cases updates (bulb cycling), contracts if any new name appears.

## Measured numbers

- Controller tick cost (city-wide, ms): —
- Corona override GPU delta: —
- Field cycle observations: —
