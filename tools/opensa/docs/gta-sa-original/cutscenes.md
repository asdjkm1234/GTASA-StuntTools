# The original's cutscene system — what the vehicle-cutscene work measured

Facts about REAL GTA:SA discovered while building `tools/vehicle-cutscene` (2026-08-12; the field
evidence lives in that tool's [plan 002](../../tools/vehicle-cutscene/docs/plans/002-implementation.md)
gate records). Everything here is the ORIGINAL game's behaviour, measured off `game-src/original` and
the reference install — not OpenSA.

## The models (`models/cutscene.img`, 634 entries)

- **23 vehicle DFFs across 21 `vehicles.ide` slots** (`cszr350`+`b`, `cscopcarla`+`92` share donors);
  the rest are cutscene peds and props. Traps: `csho` is the ped "Ho", not hotknife; `csandrom92` is
  CUT CONTENT (a txdcut row with no model anywhere); slot stems are the 8-char IDE names
  (`csremington92` ↔ `remingtn` — an INTERIOR letter is dropped, no prefix rule can link them);
  `csfirela` is slot `firela`, not `firetruk`+`la`.
- **Every cutscene vehicle is a hand-made HAnim rig** and the authoring is inconsistent per car: wheel
  nodes are `Box01` / `wheel_lf_node` / `axis_lf` / `wheelLFNode` / `dummywheel_rr` / single mesh
  frames at the corners; parts are `_ok` or `_hi_ok`; roots are the model name, `<model>_dummy`,
  `Root`, `Dummy01`, `Monster92`; csmonster inserts a `COG` frame between root and chassis; cssadler
  ships its own `winscreen_ok` typo. Bone ids are DFS-sequential per model; hierarchy node flags follow
  one rule everywhere: `(siblings follow ? 2 : 0) | (leaf ? 1 : 0)`.
- **Junk mesh-frame transforms are real, and the game's collapse rule is NARROW**: only a
  `<part>_ok/_dam` frame under its own `<part>_dummy` has its transform destroyed at load
  (`PreprocessHierarchy`/`CollapseFramesCB`); every other frame KEEPS its transform — stock copcarla's
  `chassis` carries `[0, 1.637, −0.35]` and its geometry is authored in that space. Components are
  keyed by the DUMMY, which is why a mod shipping `door_lr_ok` under `door_rr_dummy` (the taxi mod's
  copy-paste misname) works in gameplay.

## The TXDs (`data/txdcut.ide` + txdp)

- txdcut.ide is the cs-TXD → parent-TXD `txdp` dictionary. Stock ships **one typo row**
  (`csopcarla, copcarla` — the model is `cscopcarla`), **two missing rows** (`cscopcarsf`,
  `csdinghy` — exactly the two slots whose cs TXDs carry their own textures, R*'s own workaround),
  one duplicated row (`cssabre92`) and one dead row (`csandrom92`).
- Resolution order at runtime: the model's OWN TXD first, then the txdp parent, then the resident
  generic `models/generic/vehicle.txd` — vanilla's empty cs TXDs prove the chain, and shipping a
  same-named texture in the own TXD overrides the chain (the plate-bake trick, tool plan 003).

## The animations (`anim/cuts.img`, 444 entries = ~148 scenes × .ifp/.cut/.dat)

- Cutscene IFPs are the OLD **ANPK** format (the gameplay `anim.img` is ANP3): 4-byte-aligned chunks,
  `NAME` = the OBJECT the following `DGAN` drives, `CPAN`→`ANIM` = one bone channel (28-char name +
  frame count), keyframe block as the next sibling (`KRT0` = rot+trans, `KR00` = rot only). Reader:
  `scripts/debug/cutscene-anim-channels.ts`.
- **Binding is by frame NAME** (`CAnimBlendAssociation` via `CCutsceneMgr`), and the anims carry a
  channel for EVERY bone of the vanilla model — 2-frame static `KRT0`s included — so an animated
  bone's local transform is fully anim-owned; a converted model's own frame locals only survive on
  frames the anim has no channel for. **Binding is NOT first-match-only** (field-measured 2026-08-13,
  DESERT9): a SECOND frame carrying a bound name is driven too — the channel's local applied under
  that frame's own parent, a double transform. **And scenes carry channels for frames NO vanilla
  model has** (DESERT9 drives `windscreen_ok` on csbobcat92, which ships none — R* authored anims
  against a richer rig; the channel is simply unbound in vanilla). Both are why the converter
  renames every adopted mod mesh (`_ad`).
- **KRT0 keyframe layout: 8×f32 per frame** — quat x,y,z,w · trans x,y,z · time (decoded 2026-08-13
  against known bind locals; KR00 omits the translation). A 1-frame channel is a static POSE — the
  scene may hold a door OPEN with it, so "static" never means "bind pose". Wheels spin via `KR00` on the MESH bones; wheel NODES get static
  `KRT0` translations. In SA (unlike III/VC) main.scm only loads-by-name and starts; the scene's
  OBJECT list is the IFP's `NAME` chunks themselves (one per `DGAN`, mixed-case: `CsCopcarSF`,
  `CsFirela`), and the `<name>.dat` beside it is CAMERA data — zoom/FOV keyframe rows, no model
  names anywhere (measured 2026-08-13; this line previously claimed the object list came from the
  `.dat`).
- **`csdinghy` AND `cscopcarla` are driven by NO cutscene**: across the 35 scenes that animate cs
  vehicles, 21 of the 23 census models appear (corrected 2026-08-13 by an exact-name scan — the first
  count read `cscopcarla92` hits as covering both slots). The boat is cut content like `csandrom92`'s
  dead txdcut row; `cscopcarla` shares its donor and conversion byte-for-byte with `cscopcarla92`,
  so only the slot NAME goes unexercised.
- **Car wheels DO spin in scenes** (multi-frame `KR00` on the wheel MESH bones — cstaxi92's `wheel`
  carries 42 frames in PROLOG1); the BIKE's one scene (`STRP4B2`) is static except its 67-frame root
  channel, so bike wheel/pedal animation is exercised by no scene in the game (measured 2026-08-13).
- **The intro's vehicles live in `prolog1.ifp`/`prolog3.ifp`, not `intro*.ifp`** (intro1a drives
  csbat/csplay/props only).
- License plates: `CCustomCarPlateMgr` generates plate textures for GAMEPLAY vehicles only — cutscene
  objects render the raw placeholders, so **vanilla cutscene cars have blank white plates** (the
  user's gate-7 vanilla A/B screenshot is the recorded evidence). The plate art all sits uncompressed
  RGBA8888 in `vehicle.txd`: `platecharset` 32×256, `plateback1/2/3` 64×32, `carplate` 16×16.
- **One scene hides wheels by ANIMATING them into the model origin** (synd_4a, the only such site
  in all 148 scenes — measured 2026-08-14): the four cswashington `wheel*` channels drive to
  (0,0,0) while the `Axis_*` channels hold the corners (the authored bare-hub repair look); the
  vanilla body + the ground conceal the stashed wheels. The trick is tuned to the vanilla body — a
  converted mod's fatter, shim-offset wheels poke out, which is why the vehicle-cutscene installer
  ships a surgically sunk `anim/cuts.img` (wheel-stash channels to z −0.6; plan 004 round 20).
- **The runtime rewrites EVERY frame's local rotation each tick on an animated clump** (gta-reversed
  `FrameUpdateCallBackNonSkinned`, reached via `CCutsceneObject` → `RpAnimBlendClumpInit`): a frame
  with a bound channel gets the summed anim quaternion; a frame with NO channel sums to a zero
  quaternion which `CQuaternion::Normalise` turns into IDENTITY. Only the frame's POSITION survives
  un-animated (`FramePos`, snapshotted from the DFF local at clump init; `KeyFramesIgnoreNode*`
  flags exist but nothing in the game sets them). Consequence for converted rigs: an un-animated
  frame (shim, adopted mesh) may carry translation but NEVER rotation — a stored rotation renders
  fine in every offline tool and is silently erased in game (plan 004 round 15: cssecurica92's
  rotated-bone rig stood the whole truck on its tail; vanilla never trips this because every vanilla
  bone has a channel and every vanilla non-bone frame is identity-rotation).

- **The cutscene-object render setup, address-verified in the accepted exe (2026-08-14)** — the path
  the perfect-cutscene ASI rides, cross-checked between gta-reversed-modern and the bytes at each
  address (SHA1 `8c23ceff…`; VAs at image base 0x400000):
  - `CCutsceneObject::SetModelIndex` **0x5B1B20** — the single door EVERY cutscene object enters:
    `CEntity::SetModelIndex` → (clump only) `RpAnimBlendClumpInit` → `SetupCarPipeAtomicsForClump`,
    then forces the model's alpha to 0xFF. thiscall, `this` in ecx, modelId on the stack; entry is
    `push esi / push edi / mov edi,[esp+0xc]`.
  - `CCutsceneObject::SetupCarPipeAtomicsForClump` **0x5B1AB0** — hashes the model's key against six
    cached `CKeyGen::GetUppercaseKey` values (`0xBC4040`, built once behind the flag at `0xBC4058`)
    and, on a hit, runs `CCarFXRenderer::CustomCarPipeAtomicSetup` over EVERY atomic of the clump.
    Anything else returns without touching the clump — which is why a general cutscene-vehicle fix
    cannot hook here.
  - The six names (`ms_sCutsceneVehNames`, **0x8D0F68**, `NUM_CUTSCENE_VEHS = 6`) as literally
    spelled in the exe: `cscopcarla92`, `cscopcarsf`, `csbravura`, **`CsFireLa`**, `csmothership`,
    **`CsVoodoo`** — mixed case, which never matters to the game (the compare is on the uppercased
    hash) and always matters to anyone grepping for them.
  - `CCarFXRenderer::CustomCarPipeAtomicSetup` **0x5D5B20** is a `jmp` thunk; the real body is at
    **0x5DA610** (`push esi / mov esi,[esp+8]` — the `RpAtomic*`). What it does: writes
    `[atomic+0x6C] = [0xC02D24]` and stamps pipeline id **`0x53F2009A`** (the vehicle pipe) on the
    atomic. Applied to EVERY atomic of a blessed-six clump, translucent ones included — vanilla can
    afford that because vanilla cutscene DFFs carry no pipeline stamp of their own AND their glass
    never renders. On a converted fleet whose glass does render, the vehicle pipe's static env map
    it is also, in the reference install, what makes that glass look RIGHT: suppressing the stamp for
    a converted cutscene car left every window looking worse and changed nothing about the matte
    windscreen it was aimed at (ASI plan 001 step 4, field-rejected 2026-08-14). Note this is the
    RUNTIME stamp; the DFF `PipelineSet` plugin our converter writes is a different mechanism and
    behaves differently (plan 004 rounds 5-9, where stamped panes vanished).
- **SA's vehicle pipe reads a material's alpha; RW's default pipe needs the geometry to say so.** The
  flag is `rpGEOMETRYMODULATEMATERIALCOLOR` (0x40 in the geometry's flags word): with it clear, the
  default pipeline ignores the material colour entirely, alpha included, and a translucent material
  renders solid. The vehicle pipe does not consult it — which is why a vehicle mod can ship glass
  without the flag, look right in gameplay for years, and turn matte the moment the same mesh renders
  through the default pipe in a cutscene (measured 2026-08-14 on `copcarla`'s windscreen, whose door
  glass carries the flag and whose windscreen does not; plan 004 round 21).
- **A cutscene CAR and a cutscene ACTOR are indistinguishable by model type** (measured in the field
  2026-08-14): every cutscene model is streamed into the shared `CUTOBJ` clump slots, so
  `CBaseModelInfo::GetModelType()` reports 5 (`MODEL_INFO_CLUMP`) for cars, actors and props alike —
  a run of RIOT_4B logged ids 300–303 all as type 5. The engine's own way to tell them apart is
  structural, not by type or name: `GetAnimHierarchyFromSkinClump(clump)` (`0x734A40`) is non-null
  only for a SKINNED clump, and `CCutsceneMgr` branches on exactly that when attaching particle
  effects (bone index for a skinned actor, frame name for anything else). Cutscene actors are
  skinned; cutscene cars and props are not.
- **Gameplay vehicles are drawn last in the frame, by design** — the fact behind the cutscene
  glass-over-actors bug: `CRenderer::RenderEverythingBarRoads` (`0x553AA0`) does not render a vehicle
  entity inline at all; it hands it to `CVisibilityPlugins::InsertEntityIntoSortedList` (`0x734570`)
  and lets `CRenderer::RenderFadingInEntities` (`0x5531E0`) draw the list back-to-front after the
  whole pass. A cutscene car is an OBJECT, so it renders inline in sector-scan order instead — and
  the per-atomic alpha list (`InitAlphaAtomicList` / `RenderAlphaAtomics` around one entity's render
  inside `RenderOneNonRoad` `0x553260`) is per-VEHICLE-entity, not per frame: it exists so a car can
  layer its own glass over its own occupants, and nothing flushes it for a non-vehicle entity.

## The script API (measured off the bottle's main.scm + gta-reversed, 2026-08-13)

- main.scm plays every one of its 135 cutscenes with the same sequence (PROLOG1 @ 0x43300,
  PROLOG3 @ 0x434f7): `04BB SET_AREA_VISIBLE <area>` → `02E4 LOAD_CUTSCENE 'NAME'` → loop until
  `06B9 HAS_CUTSCENE_LOADED` → `02E7 START_CUTSCENE` → `016A DO_FADE` in → loop until
  `02E9 HAS_CUTSCENE_FINISHED` → fade out (`016A` + `016B IS_FADING` wait) → `02EA CLEAR_CUTSCENE`
  → `04BB` restore. All waits are condition-driven; no fixed sleeps.
- `02E4` alone loads the `.ifp` anims (whose `NAME` chunks are the object list) and the `.dat`
  camera from cuts.img; the III/VC-era
  `02E5 CREATE_CUTSCENE_OBJECT`/`02E6 SET_CUTSCENE_ANIM` are `is_nop` in SA (Sanny SA library).
- **`06B9` is mandatory before `02E7`**: gta-reversed's `CCutsceneMgr::StartCutscene` on
  not-yet-loaded data flips play status but SKIPS camera setup and widescreen — a silent degraded
  start, not an error.
- `CCutsceneMgr` itself sets widescreen on start and fades in; main.scm's fades are framing only.
  Scene names are stored UPPERCASE in main.scm, compared case-insensitively by the manager.
- The interior AREA comes from main.scm, not the `.dat`: `PROLOG3=0`, `PROLOG1=14`, `INTRO1A=3`,
  `INTRO2A=2` (adjacent-byte decode reaches 54/135 sites; histogram
  `{0:3, 1:21, 2:11, 3:8, 5:4, 6:1, 10:1, 11:3, 12:1, 14:1}`).
- The ONMISSION global in SA's main.scm is `$409` (`0180 SET_ON_MISSION_FLAG` @ 0xdce4); it is one
  of the three globals documented safe for CLEO scripts (`$PLAYER_CHAR`, `$PLAYER_ACTOR`,
  `$ONMISSION`).

## The reference install (cutscene angle)

The bottle runs **CLEO 4.4.4** (version string in `CLEO.asi`; cleo.log confirms `IniFiles.cleo`
loads → the `0AF0`/`0AF4` INI opcodes are served). Its `data/script/main.scm` is 3 079 599 B.
The bottle streams `models\cutscene.img` DIRECTLY (modloader.log) and its modloader tree carries no
`.img` overrides — its `cutscene.img`/`data/txdcut.ide` were byte-identical to stock 1.0 when measured
(2026-08-12), so a drop-in of those two files is a clean, fully reversible cutscene-only A/B (the
gate-4/7 delivery method; originals kept beside as `.vanilla`). The ProperFixes row in
[reference-install-config.md](reference-install-config.md) lists `cuts.img`/`cutscene.img` as part of
the PACKAGE's distribution — the installed selection does not include them.
