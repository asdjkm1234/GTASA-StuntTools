# External links

Every external resource the project has used or keeps an eye on, in one place.
Rule (also in `CLAUDE.md`): when an external resource proves useful, add it here.

## GTA SA reverse engineering & modding

- <https://gtamods.com/wiki/IMG_archive> — the IMG format and, usefully, the ARCHIVE-COUNT limit stated
  plainly ("max of 8 archives … 3 standard … and 5 defined within default.dat or gta.dat"). Used in 2026-08-15
  to corroborate `TOTAL_IMG_ARCHIVES` independently of the address arithmetic — see
  `docs/gta-sa-original/img-archive-limit.md`.
- <https://github.com/gta-reversed/gta-reversed-modern> — reversed GTA SA source (the active repo; the
  catalogue's provenance lines cite it); the reference for engine internals (pools, `CIplStore`,
  streaming) behind our int16/pool guards and the `asi/` plugin work.
- <https://github.com/in0finite/SanAndreasUnity> — **the other own-engine SA**: a C# / Unity
  reimplementation that loads the player's own game assets, with the world, peds, vehicles and multiplayer
  running. The closest thing to a peer project, so read it for the DECISIONS it had to take — how it split
  streaming, what it kept from the original's structure and what it threw away — and for a second opinion
  whenever we are about to conclude "SA's data cannot express X". **Not a source of truth**: its answers are
  shaped by Unity's constraints the way ours are shaped by our own, and what SA's data MEANS still comes from
  `gta-reversed`.
- <https://github.com/gennariarmando/rubbish-sa> — a small C++ mod porting GTA III's blowing-rubbish system
  into San Andreas (and letting you shoot it). Useful twice over: as a worked example of an ASI adding an
  ambience system to the real game — the shape `asi/city-life` takes — and as a candidate for the ambience
  itself, since SA dropped a system III had.
- <https://github.com/JuniorDjjr/CLEOPlus> — CLEO extension reference (opcode surface for plan 097).
- <https://github.com/cleolibrary/CLEO4> — CLEO 4's own source. `source/CCustomOpcodeSystem.cpp` is the
  ground truth for how `0AA5`-`0AA8` marshal their parameters (the push loop that makes the LAST listed
  parameter the FIRST C argument — see `docs/edge-cases/cleo-vm.md`).
- <https://github.com/sannybuilder/library> — the Sanny Builder opcode DB (`sa/sa.json`, 3 739 commands
  with arities) — vendored + pinned by plan 097/01; also the recon disassembler's source of truth.
- <https://github.com/gta-android/gta-reversed-android> — reverse of GTA:SA **2.10 Android**. Consulted
  2026-08-04 for the mobile-asset question: the Android release stores its textures in the OpenGL/PVR
  Texture Native layout (PVRTC/ETC), not the D3D8/D3D9 one, so its `.txd` files are NOT an input this
  project can read (`packages/renderware/src/parsers/binary/txd.ts` handles D3D only and skips what it does
  not understand). Useful if that ever needs to change.
- <https://github.com/in0finite/SanAndreasUnity> — open reimplementation of the SA engine in Unity, with
  Android builds; development halted. Like every project of its kind it READS a copy of the game and does
  not ship one, which is the answer to "where do the assets come from" for all of them.
- <https://github.com/JuniorDjjr/SA-MixSets> — per-feature SA tweaks reference.
- <https://github.com/JuniorDjjr/VehFuncs> — vehicle function extensions (useful for vehicle features
  parity: extras, wheels, steering parts). The wiki page
  `[EN]-Recursive-Extras` is the source for the `f_extras` / `f_class` naming rules our runtime honours
  (`:N`, `:0`, `:0+`, `:N+`, `[tag]`, `?condition`) — `packages/renderware/src/vehicle/variants.ts`.
- <https://github.com/JuniorDjjr/skygfx> — the maintained skygfx fork; vehicle reflection / graphics
  reference (informed plan 030 and the stochastic-texturing survey).
- <https://github.com/aap/skygfx> — the original PS2-graphics-on-PC restoration; the ground truth for SA
  render behaviour (vehicle env-map, prelit handling).
- <https://github.com/Kiminaze/VehicleDeformation> — vehicle deformation reference (ideas 0.6.0/01
  vehdeform).
- <https://libertycity.ru/files/gta-san-andreas/237577-san-andreas-advanced-handling-s-a-a-h.html> —
  **S.A.A.H (San Andreas Advanced Handling)**: a 210-car realism re-tune of `handling.cfg`. Used as a
  MEASURING CORPUS, not a target (plan 081/01): `scripts/debug/handling-diff.ts` against it showed that
  **58 % of a calibrated table's edits never reach our physics** — the author moves the centre of mass on
  65 % of the fleet and the suspension on 61 %, and the engine reads neither.

## Assets

- <https://www.gtainside.com/en/sanandreas/skins/144069-endoskeleton-terminator-t800/> — the T800 ped mod
  used as the material-maps test case (`docs/improvements/character-material-maps.md`).

## 3D map engines & geospatial formats

Surveyed 2026-08-06 for [plan 202](./plans/202-pcad-dispatch/readme.md). **We take ideas and formats from
these, never code** — they are WebGL/three.js and we have our own WebGPU renderer, so nothing here is
linkable even where the licence allows it (Apache-2.0 Cesium, BSD-3 MapLibre, MIT deck.gl/Giro3D). This is a
reading map: what each one answers, so the survey is not re-derived.

- <https://github.com/CesiumGS/cesium> — the reference for two things we need. **Screen-space error**
  (`maximumScreenSpaceError`): a tile loads when its projected error exceeds N pixels, which is the correct
  LOD rule for a camera with no player to ring-stream around. And **classification / ground primitives** —
  how to drape a shape on the ground without tessellating it to the terrain mesh: render a volume and
  classify the fragments it covers. That is the technique behind every clamp-to-ground need we have
  (annotations, data layers, unit trails).
- <https://docs.ogc.org/cs/22-025r4/22-025r4.html> — **3D Tiles** (OGC). Not a format we adopt, but the
  concept we were missing: every tile declares the **geometric error** introduced by drawing it instead of
  its children, and refinement is `ADD` or `REPLACE`. Screen-space-error LOD consumes exactly that number,
  and our pak does not carry one — see [201/1](./plans/201-dispatch-console/1-the-map-profile/readme.md).
- <https://github.com/CesiumGS/3d-tiles> — the schemas beside the spec, and **CZML**: entity properties as
  functions over an interval, driven by a clock. The shape behind
  [201/8](./plans/201-dispatch-console/8-the-time-axis/readme.md) — time as an axis rather than a field.
- <https://deepwiki.com/maplibre/maplibre-native/3.3-symbol-placement-and-collision-detection> — **MapLibre's
  symbol placement**: collision detection, sort-key priority, allow-overlap, variable placement. The best
  documented answer to "150 labels at city zoom" and the reference for
  [201/3](./plans/201-dispatch-console/3-the-operator-surface-on-a-phone/readme.md)'s declutter budget.
  **Built 2026-08-22** (`apps/dispatch/src/map/labels.ts`): the grid-bucketed index, the rank and the
  variable placement are theirs; the rank's terms are this product's (selection, worst call, committed unit,
  nearest) and the budget is derived from the viewport rather than configured.
- <https://deck.gl/docs/developer-guide/base-maps/using-with-maplibre> — **deck.gl**: the layer model over a
  base map, and interleaved rendering into an existing context. The pattern for data layers restyled at
  runtime over a world whose look is baked.
- <https://www.win.tue.nl/~vanwijk/zoompan.pdf> — **Van Wijk & Nuij, _Smooth and efficient zooming and
  panning_ (InfoVis 2003)**: the optimal path between two views when the cost is measured in SCREENFULS
  rather than metres — the camera pulls up, crosses, settles, and the DURATION falls out of the path instead
  of being a constant somebody liked. MapLibre's `flyTo` is this paper (its `curve` is the paper's ρ, its
  `speed` the screenfuls per second), and so is
  [201/7-02](./plans/201-dispatch-console/7-the-operator-map/readme.md)'s (`apps/dispatch/src/map/fly.ts`).
  Its ρ = 1.42 is not fitted by us: it is the value the paper's own user study settled on.
- <https://github.com/giro3d-org/Giro3D> — **Giro3D** (successor of iTowns, IGN/Oslandia, three.js): a
  geospatial scene with operator tools — measurement, annotation, cross-sections, elevation profiles. The
  closest existing thing to what [201/7](./plans/201-dispatch-console/7-the-operator-map/readme.md) needs.
- <https://github.com/protomaps/PMTiles> — **PMTiles**: a whole tile pyramid in **one file** on static
  storage, read by HTTP range requests, Hilbert-ordered so neighbours are near each other in the file. The
  right container for the flat-2D mode's tiles
  ([201/6](./plans/201-dispatch-console/6-display-modes/readme.md)) — our pak is already served as static
  range-friendly files, and this removes tile hosting entirely.
- <https://github.com/ikkentim/SanMap> (Unlicense) — a **GTA-SA → tile-coordinate projection** and a tile
  cutter. The zoom/tile scheme for the flat-2D mode, proven and free.
- <https://github.com/AmyrAhmady/samap> — a 48000×48000 satellite-style raster of San Andreas. **Reference
  only, not a dependency**: it covers stock SA (this engine exists to run total conversions) and its imagery
  is credited to gtagmodding rather than owned by the repo publishing it.

Surveyed and set aside, so nobody re-checks them: globe engines (OpenGlobus, NASA WorldWind, VTS) — we
decided against real-world geography, so a globe and its CRS machinery buy nothing; point-cloud stacks
(Potree, COPC) — no use case here.

## Dispatch / CAD systems (the product's field)

- <https://github.com/SnailyCAD/snaily-cadv4> (MIT) — the open-source benchmark for roleplay CAD/MDT:
  self-hosted, TypeScript monorepo, Docker, Discord role sync, realtime state. The feature checklist the
  product half is measured against. Its map is a [separate 2D integration](https://github.com/SnailyCAD/live-map).
  **It ships a real design system**, `@snailycad/ui` (read 2026-08-26, v1.80.2): tsup-built, published,
  with Storybook and Chromatic visual regression. Built on **React Aria / React Stately** (~30 packages)
  plus four Radix primitives, `class-variance-authority` + `tailwind-merge`, `formik`, `next-intl`,
  `react-dnd` and Monaco — and **`next` as a peer dependency**. Worth reading and worth DEPENDING on for a
  list-first CAD; not forkable into `apps/dispatch`, which is Vite, Tailwind-free and ships as an
  embeddable widget with zero runtime dependencies. Their choice of React Aria over Radix is the
  interesting part: it is the deeper answer for comboboxes, date pickers and listboxes, which is the CAD
  half's problem rather than the map's.
- <https://sonorancad.com/fivem> — the commercial leader for FiveM, and **it ships a 3D live map for GTA V**
  (a `2D / 2.5D / 3D` switch in the Live Map window, a camera pad, bodycam previews on unit markers).
  Corrected 2026-08-26: this entry, and [202 §2](plans/202-pcad-dispatch/readme.md), previously said its 3D
  map existed only for a Roblox game. Both it and SnailyCAD are FiveM, which is why SA-MP/open.mp is the
  opening — and its world is stock Los Santos, which is why a total conversion still is.
  Its dispatch screen is worth reading directly: four operator-selectable THEMES over one fixed 2x2
  quadrant layout, with a status tally in each panel header. `sonorancad.com/images/homepage/themes/` holds
  the four, captured 2026-08-26.
- <https://resgrid.com/apps/dispatch> and <https://resgrid.com/apps/bigboard> (Apache-2.0) — the largest
  open-source real-world CAD. Its Dispatch app keeps the intake FORM expanded permanently and leaves the map
  a card measuring 475x302 of 1665x947 — **9.1 % of the screen**, measured off their own published
  screenshot. BigBoard is the field's only configurable widget grid, and the reference for a future wall
  mode.
- <https://crowdcad.org> / <https://github.com/evanqua/crowdcad> (AGPL-3.0) — a browser-based CAD for event
  medical teams, and the only one in the field built on **Next.js + Tailwind + shadcn/ui**. Its "Lite Mode"
  runs the whole app in the browser with no backend, which makes it the easiest console in this list to
  inspect live. Panes resize via `react-resizable-panels` (a 25/75 splitter); they do not move.
- <https://openises.sourceforge.net/> / <https://github.com/khoegenauer/tickets-cad> — Tickets CAD, for
  volunteer fire, ARES/RACES, CERT and campus security. **Recorded with a warning:** as of 2026-08-26
  `ticketscad.org` serves a ParkLogic domain-parking page, the reachable repository is legacy (Travis CI,
  Scrutinizer), and a widely-repeated spec for a "v4 NewUI" on Bootstrap 5 + GridStack + Leaflet could not
  be verified from any reachable source. Do not build on it without checking it yourself.
## References the user wants watched before work starts

- <https://www.youtube.com/watch?v=1dwufRp71EY> — **must be shown to the user before ANY work on the City
  Life chain begins** (his call, 2026-08-11; he will say afterwards what it changes). The gate itself lives
  at the top of
  [`docs/roadmap/0.5.0/plans/06-city-life/readme.md`](roadmap/0.5.0/plans/06-city-life/readme.md).
- <https://www.youtube.com/watch?v=R24KBNuOiR4> — **must be shown to the user before any work starts from the
  original-game defect list** (his call, 2026-08-11). Gate at the top of
  [`docs/improvements/original-game-defects.md`](improvements/original-game-defects.md).
- <https://libertycity.net/files/gta-san-andreas/239321-ultimate-first-person-beta.html> — "Ultimate First
  Person (beta)". **Must be downloaded and studied before any work on the first-person camera idea** (his
  call, 2026-08-11): prior art for the open questions that idea carries — head hiding without near-plane
  clipping, weapon aim, vehicle interiors. Gate at the top of
  [`docs/ideas/first-person-camera/readme.md`](ideas/first-person-camera/readme.md).

## The original game's own bugs

- <https://github.com/CookiePLMonster/SilentPatch> — the community's bug-fix patch for the 3D-era games; its
  SA changelog
  (<https://github.com/CookiePLMonster/SilentPatch/blob/dev/CHANGELOG-SA.md>) is the closest thing to a
  catalogue of what is broken in stock San Andreas. **Read it as a defect inventory, not a fix list** — and
  note our reference install already runs it, so its fixes are present on the `sa` target and absent in our
  own engine. Used as a seed for
  [`docs/improvements/original-game-defects.md`](improvements/original-game-defects.md).

## Articles & techniques

- <https://discourse.threejs.org/t/starry-shader-for-sky-sphere/7578> — starfield shader survey (fed the
  night-sky work in plan 032; the ideas carried over to the own engine's sky).
- <https://discourse.threejs.org/t/complete-sky-system-for-three-js-skybox-sun-moon-day-night-cycle-clouds-stars-lensflares/88311>
  — full sky-system survey (same arc).
- <https://kellylougheed.medium.com/3d-starry-night-with-three-js-7f9191bbcb84> — starry-night walkthrough.
- <https://andreasrohner.at/posts/Web%20Development/JavaScript/Random-starfield-generator-for-THREE-js/> —
  random starfield generator.

## Tools

- <https://mermaid.live> — quick preview for the architecture diagrams (`npm run arch` output).
