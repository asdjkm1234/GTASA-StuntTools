# 06 — City Life (THE flagship feature chain)

> ## ⛔ STOP — step 0, before ANY work on this chain
>
> **Show the user this video and wait for his direction. Do not plan, do not research, do not write code
> until he has seen it and said what it changes:**
>
> **https://www.youtube.com/watch?v=1dwufRp71EY**
>
> Set by the user on 2026-08-11, with the note that he will correct this entry afterwards — so what is
> written below is provisional against whatever he takes from the video. This gate applies to every file in
> the chain, not just this readme: reaching any of them is reaching this gate.

**The most important system we will build (user, 2026-07-12; re-scoped 2026-08-02):** a living city —
traffic and pedestrians with real routes, real trains, traffic lights and rail barriers, visible into the
distance — running on the OpenSA engine **AND inside real GTA San Andreas through our own ASI**, with 100 %
compatibility with the original game, its missions and its mods.

> **REWORKED 2026-08-02** — the original 8-file chain (written 2026-07-12, before the engine rewrite closed
> and before plans 059/091 delivered their verdicts) was rewritten into the subfolder tree below. What
> changed and why is in the [decision log](#the-decision-log). The old files are gone; git history keeps
> them.

## What this chain delivers (the six commitments)

1. **Real-SA compatibility is a first-class track, not an afterthought.** A new `asi/city-life` plugin
   (perfect-map's toolchain and discipline, a fresh RE catalogue) starts by cleaning the streets of the
   vanilla ambient population — provably mission-safe and mod-safe — and then grows our systems step by
   step inside the original game.
2. **Pedestrians get a LOD chain** even though SA ped models ship none — generated silhouette LODs
   (dark, untextured, instanced) with a field A/B against the duplicate-the-original alternative.
3. **Traffic lights get real controller logic** — per-intersection phase tables, deterministic from the
   game clock, driving both our renderer and (hooked) SA's own light rendering.
4. **The original path files stay canonical.** We build an editor FOR them, and everything they cannot
   express lives in a sidecar extension file. No `.ospath` replacement format (decision D2).
5. **The original's driver idiocy is fixed, not ported** — obstacle braking, light compliance, rail
   yield, one-way discipline. "That is what SA's driver does" is never the answer (goals directive 3).
6. **The end state is a full city** — streets that read as populated as GTA V's, measured, in both hosts.

## The two hosts, and who leads

| Host | Role | Why |
| --- | --- | --- |
| OpenSA engine | The design lab: sim semantics, controllers, LOD chains are proven here first — fast iteration, tests, benches | The ASI debugging loop is ~10× slower (perfect-map experience) |
| Real SA via `asi/city-life` | Starts IMMEDIATELY with population suppression (1-preparation/01), which depends on nothing; each later ASI phase ports a proven engine result | Suppression is standalone value ("clean streets" mode) and de-risks the RE work early |

The ASI track is interleaved, not appended: `1-preparation/01` is the FIRST plan of the whole chain.

## Ring architecture (updated to the measured engine)

Simulation LOD rings around the player, agent identity preserved across rings — every agent is
`(seed, route)` and re-materializes identically on promotion:

```
Ring 0  FULL       0 – ~150 m     real vehicles (Rapier raycast vehicle) with our driver AI; skinned peds.
                                  Bounded by collisionDrawDistance (150) — a dynamic body may only exist
                                  where static collision exists (restrictions/architecture.md).
Ring 1  KINEMATIC  ~150 – 500 m   graph-followers, no physics, no collision; rendered through a NEW
                                  instanced far-vehicle path (the engine has none today) and ped LODs.
Ring 2  FLOW       0.5 – 2.4 km   agents are SoA data (segment, s, speed, seed); rendered as corona
                                  light streams / silhouettes. Hard ceiling: fogCutDistance 2400 is a CULL.
```

- Promotion/demotion: hysteresis + per-frame budgets; ring 0 promotion is predictive (time-to-contact,
  not distance — a car closing at 30 m/s must be a real body before the player can touch it).
- The intersection is the unit of traffic logic: agents obey node controllers, never negotiate pairwise.
- One graph, one sim semantics, two implementations (TS + C++), parity-tested on shared fixtures.

## The decision log

| # | Decision | Rejected alternative and why |
| --- | --- | --- |
| D1 | **ASI track starts first** (suppression), engine remains the semantics lab | Old order shipped the ASI last; suppression needs no sim and is the compatibility proof we need earliest |
| D2 | **Original `nodes*.dat`/`tracks*.dat` stay the authored source**; extensions in a sidecar; the engine parses at boot (they are loose `data/paths/*` files, ~3.5 MB, already shipped); the ASI reads SA's own in-memory graph (`ThePaths`) — automatically consistent with ANY mod's path files | The old `.ospath` replacement format: real SA must keep valid original files anyway (police/mission AI read them), so a second format is a divergence risk and a converter tax with no consumer that needs it. Revisit only if boot-parse cost is measured to matter |
| D3 | **Ped far-LODs are generated silhouettes** (2–3 body classes decimated from the real roster via the lod-common HD→LOD core, untextured, dark, instanced in one draw), field-A/B'd against per-model duplicated LODs before committing | Imposter atlases (old plan): a new offline bake + atlas pipeline for a look we can get from meshes we already know how to generate; keep as fallback if the A/B fails |
| D4 | **Suppression via the game's own density seams** (the multipliers mission scripts already set through opcodes 01EB/03DE), re-asserted per frame; ambient-only — scripted/mission entities, police response, parked car generators and (v0) trains untouched | Early-outing spawn function bodies: more RE surface, and mission-safety would be OUR claim instead of the game's own proven semantics |
| D5 | **Two sim implementations, one spec + shared fixtures** (TS for the engine, C++ in the ASI; both walk the same `(area, nodeId)` graph so parity is testable) | A shared WASM core: a toolchain the repo doesn't have, for array math small enough to write twice |
| D6 | **Traffic-light state has one owner (our controller)** in both hosts; in SA the `CTrafficLights` query functions are hooked so SA's own bulbs and any remaining vanilla AI see OUR phases | Driving only our visuals: two clocks disagreeing at one junction is worse than vanilla |
| D7 | **Traffic = land vehicles in 0.5.0** (cars first; bikes/buses arrive via [docs/plans/098-all-land-vehicles](../../../../plans/098-all-land-vehicles/readme.md)); boats/planes are out (that chain excludes air & water); trains are ours (4-trains) | — |

## The tree

| Folder | Plan | What |
| --- | --- | --- |
| 1-preparation | [01 ASI clean streets](1-preparation/01-asi-clean-streets.md) | `asi/city-life` v0: suppress vanilla ambient cars+peds, prove mission/mod safety |
| | [02 path graph import](1-preparation/02-path-graph-import.md) | ped nodes, navi/lane/direction decode, full flags, `tracks*.dat` — the data gate for everything |
| | [03 population data](1-preparation/03-population-data.md) | popcycle ped columns, real zone→zone-type table, pedgrp — density truth |
| | [04 path sidecar & contracts](1-preparation/04-path-sidecar-and-contracts.md) | the extension file (lights, densities, schedules), its contract |
| | [05 path editor](1-preparation/05-path-editor.md) | viewer-family app editing the ORIGINAL files + sidecar |
| 2-traffic | [01 sim core](2-traffic/01-sim-core.md) | SoA agents, rings, promotion, routes |
| | [02 driver AI](2-traffic/02-driver-ai.md) | the not-an-idiot driver; retires the autopilot-gains hack |
| | [03 traffic lights & barriers](2-traffic/03-traffic-lights.md) | controllers, phases, 2dfx bulb binding, rail barriers |
| | [04 far rendering](2-traffic/04-far-rendering.md) | NEW instanced far-vehicle path, vlo arena, corona streams |
| | [05 ASI traffic](2-traffic/05-asi-traffic.md) | our traffic inside real SA (far coronas → driven CVehicles → lights sync) |
| 3-peds | [01 ped rendering](3-peds/01-ped-rendering.md) | multi-instance skinned path (engine has a single ped slot today) |
| | [02 ped LODs](3-peds/02-ped-lods.md) | the silhouette chain (commitment 2) |
| | [03 ped sim](3-peds/03-ped-sim.md) | sidewalk agents, crossings, idles; retires the ped-route hack |
| | [04 ASI peds](3-peds/04-asi-peds.md) | peds inside real SA |
| 4-trains | [01 trains (engine)](4-trains/01-trains-engine.md) | tracks import, kinematic trains, schedules, crossings |
| | [02 ASI trains](4-trains/02-asi-trains.md) | scheduled trains inside real SA (stretch — mission-train risk) |
| 5-city | [01 the full city](5-city/01-full-city.md) | density scaling to "reads like GTA V", the acceptance program |

## Order & dependencies

```
1/01 ASI clean streets ────────────────────────────────┐ (independent — starts first)
1/02 path import → 1/03 population → 1/04 sidecar → 1/05 editor
        │
        └→ 2/01 sim core → 2/02 driver AI → 2/03 lights ─→ 2/04 far rendering → 5/01 full city
                  │                            │                    │
                  │                            └→ 4/01 trains ──────┤
                  └→ 3/01 ped rendering → 3/02 ped LODs → 3/03 ped sim ──┤
                                                                          │
        ASI track: 1/01 → 2/05 ASI traffic → 3/04 ASI peds → 4/02 ASI trains
                          (each ASI phase ports its proven engine twin)
```

Hard gate: **no traffic drives before 1/02 lands direction data** — today the parsed graph has 0 one-way
links out of 30,587 vehicle nodes (direction lives in the unparsed navi nodes), and wrong-way traffic is
worse than no traffic.

## Performance gates (set now, measured per plan)

- Sim tick ≤ **2 ms** for the full ring set (ring 2 target: 5,000 agents ≤ 1 ms, flat array math).
- Far rendering ≤ **+1.5 ms GPU at 2× retina**, sim feed ≤ 0.5 ms CPU. Budgets are stated in
  `gpuMs.pass` and draw counts — plan 091 proved cars cost GPU, not spawn CPU (per-instance spawn tail
  0.2–0.3 ms; the 25 ms per-type ceiling is a teleport-bench shape only).
- Ring 0 vehicle count budgeted against the measured physics slice (~8 µs/car/fixed step; 0.605 ms at 80).
- Zero steady-state GC pressure; a `?soak=30` run stays clean (`heapFlat`, `residencyFlat`).
- Zero added collision casts per frame at steady state — the ≤ 5 casts/frame budget is already spoken for.

## Standing rules that bind every plan in this chain

- Every population source prints its size at boot (`[traffic] agents seeded: N` — the 059 lesson: an
  empty map looks exactly like a full one).
- A dynamic body only where static collision already exists; spawn gates on the collision radius.
- Games without `data/Paths` (gostown, anderius, carcer) get city-life **disabled, checked, loudly** —
  `loadRouteGraph` returns `null` and every consumer must handle it.
- Models chosen by data files (cargrp/pedgrp/tracks) must be registered with the install-source loaders
  (`build-vfs.ts`, the `procObjModelRefs` pattern) or they are silently absent in the browser.
- Field verification per phase: the field-drive ritual + `slow-frame-census.ts` + a bench row
  (`docs/development/benchmarks.md`); numbers recorded in the plan doc and `docs/benchmarks/` before analysis.
- ASI phases follow perfect-map discipline verbatim: two-source RE (gta-reversed + real exe bytes), typed
  catalogue → generated header, byte-verify + defer loudly, exact-exe guard, FLA/OLA coexistence,
  Wine validation ladder. **No address ships on memory or decompiler-only evidence.**
- Docs in the same change: `contracts/` for every new name, `features/` per shipped phase,
  `restrictions/`+`edge-cases/` for every discovered limit, `hacks/` retirement moves when
  `autopilot-gains` and `pedestrian-route-on-a-vehicle-graph` are replaced.
