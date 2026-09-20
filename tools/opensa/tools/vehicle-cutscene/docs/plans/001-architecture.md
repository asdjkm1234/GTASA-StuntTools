# 001 — vehicle-cutscene architecture

**Status: PLANNED 2026-08-12.** A standalone tool that converts installed **vehicle mods** into their
**cutscene counterparts** — the `cs*` models in `models/cutscene.img` — so the real game's cutscenes show
the same custom cars the player drives. Sibling of `vehicle-installer` (same CLI contract, same
real-game output discipline) and of `vehicle-optimizer` (same "focused vehicle tool" scope).

## Why a separate project

Cutscene vehicles are a **different asset class** with their own rig contract (HAnim skeleton, flattened
hierarchy, baked paint — see the research record below). No existing tool owns that transform:
`vehicle-installer` installs gameplay models and data rows; `vehicle-optimizer` edits a single DFF's scale
and material effects. This tool reads what they install and derives the cutscene twin. Output is standard
RenderWare for the **real game** — the OpenSA engine is never involved.

## CLI (mirrors vehicle-installer)

```
tsx tools/vehicle-cutscene/src/cli.ts --game <path> --in <vehicles-dir> --out <path> [--only <model,model>] [--inspect]
  --game   base game tree (data/vehicles.ide + data/txdcut.ide + models/cutscene.img + models/gta3.img)
  --in     folder of vehicle mods (immediate subfolders: <model>.dff/.txd + <model>.settings.txt) — the
           same folder vehicle-installer consumes (mods-src/original/vehicles)
  --out    output game tree (base copied, models/cutscene.img rebuilt, data/txdcut.ide patched)
  --only   restrict to specific slots while iterating
  --inspect  report the census + per-pair readiness, write nothing
  --no-base-copy  write ONLY the three outputs below into --out; no base copy, and --out is not wiped
```

## Shape (flat `src/`, like vehicle-installer)

```
vehicle-cutscene/
  src/
    cli.ts          # arg parsing + validation (vehicle-installer pattern)
    census.ts       # derive the cs* ↔ vehicles.ide mapping from the --game tree (never a hardcoded list)
    template.ts     # extract the per-slot TEMPLATE from the vanilla cs model (bone ids, root name, rebase)
    rig/            # the three transform branches: car.ts, bike.ts, boat.ts + shared frame surgery
    materials.ts    # carcols paint bake into paint-marker materials; the translucency/pane classifiers
    hanim.ts        # HAnim plugin (0x11E) emit — frame bone ids + root hierarchy table
    txd.ts          # empty-TXD emit + texture-name closure check; txdcut.ide row patching
    plate.ts        # readable license-plate bake into the cs TXD (plan 003)
    anim-poses.ts   # read wheel-bone poses out of anim/cuts.img (the anims override a lying bind)
    seats.ts        # where the DONOR says a person sits, in cutscene space (plan 005)
    stash-patch.ts  # SCENE-VALUE pass: sink a wheel stash (plan 004 round 20)
    seat-patch.ts   # SCENE-VALUE pass: lift a riding actor onto the donor's seat (plan 005)
    install.ts      # game → out (base copy, or the three files alone), rebuild cutscene.img (EditableImg)
  docs/plans/       # 001 architecture · 002 implementation · 003 plates · 004 sweep · 005 seats
```

**The tool writes THREE outputs, not two.** `models/cutscene.img` and `data/txdcut.ide` are the models;
`anim/cuts.img` is the third, and it exists because some defects live in the SCENE rather than in any
model — R\* hides a repair scene's wheels by animating them to the origin, and R\* seats every cutscene
actor at their own car's `ped_frontseat`. Neither can be answered by model data: the wheels' one shim
must serve both poses, and the actor is not in the car's clump at all. Both passes are therefore
surgical edits to the scene VALUES (12 and 4 bytes per channel, chunk sizes untouched), they CHAIN
through one buffer and one write, and each reports what it touched. On the current fleet exactly 2 of
444 entries differ from vanilla.

**Those three are also the whole output under `--no-base-copy`** (plan 006): no base copy, `--out` left
otherwise untouched, and the emitted bytes identical to what the copy run produces from the same inputs
— which is what lets the pmb pipeline (which wants a game tree) and the standalone app (which wants a
delivery folder) share one converter. Reads come from `--game` in both modes.

## Principles

- **Byte-faithful chunk surgery, never re-encode geometry.** All writes go through `rw-codec`'s
  `readRw`/`writeRw` chunk round-trip: geometry, material-effect and texture chunks of the mod are moved,
  not rebuilt — the mod's own data (and its latent bugs) survive verbatim, the mod-installer principle.
  `@opensa/renderware` parsers are used READ-ONLY for analysis.
- **The vanilla cs model is the TEMPLATE, per slot.** Bone ids, root frame name, which parts exist, and the
  vertical rebase convention are all hand-authored and inconsistent across the 23 vanilla models (measured:
  `Box01` vs `wheel_lf_node` vs `axis_lf` vs `wheelLFNode`; chassis bone 9 vs 1; ground-rooted bobcat vs
  origin-rooted remington). They are **read from the vanilla file at run time**, never generated by a
  uniform rule — the cutscene animations target those exact bone ids.
- **Everything derives from the assets** (CLAUDE.md rule: no per-car constants). Wheel positions come from
  the mod's `wheel_*_dummy` frames, wheel radius from its wheel geometry bbox, paint from `carcols.dat`,
  the ground plane from the vanilla pair. A model swap on any slot keeps working.
- **Real-game output** — standard RenderWare DFF/TXD + a VER2 `cutscene.img`; no OpenSA-specific data.
- **Fail loud** — a part the template needs but the mod lacks, or a texture the closure check cannot
  resolve, is a reported error for that slot, never a silent skip.

## Research record (measured 2026-08-12, `game-src/original`)

### The census: 634 entries in cutscene.img, 23 of them vehicles, 21 distinct slots

Matched against `data/vehicles.ide` (212 rows) and `data/txdcut.ide` (the game's own cs-TXD → parent-TXD
`txdp` dictionary, 23 rows):

| cutscene model | vehicles.ide slot | own TXD bytes | txdcut.ide row |
| --- | --- | --- | --- |
| csbobcat92 | bobcat (422) | empty (2 048) | yes |
| csbravura | bravura (401) | 114 688 | yes |
| csburrito92 | burrito (482) | empty | yes |
| cscopcarla | copcarla (596) | empty | **typo: `csopcarla`** (dead row) |
| cscopcarla92 | copcarla (596) | 131 072 | yes |
| cscopcarsf | copcarsf (597) | 59 392 | **missing** |
| csdinghy | dinghy (473, boat) | 43 008 | **missing** |
| csfirela | firela (544, ladder truck) | 110 592 | yes |
| csglendale92 | glendale (466) | empty | yes |
| csgreenwood | greenwoo (492) | empty | yes |
| csmonster | monster (444, mtruck) | empty | yes |
| csmothership | camper (483; Truth's van) | 114 688 | yes |
| csmtbike92 | mtbike (510, bmx) | empty | yes |
| csremington92 | remingtn (534) | empty | yes |
| cssabre92 | sabre (475) | empty | yes (duplicated row) |
| cssadler | sadler (543) | empty | yes |
| cssavanna | savanna (567) | empty | yes |
| cssecurica92 | securica (428) | empty | yes |
| cstaxi92 | taxi (420) | empty | yes |
| csvoodoo | voodoo (412) | 114 688 | yes |
| cswashington | washing (421) | empty | yes |
| cszr350 / cszr350b | zr350 (477) | ~100 K each | yes (both) |

Traps found while matching: **`csho` is a ped** (biped skeleton), not hotknife; **`csandrom92`** is a dead
txdcut row (no model in cutscene.img or gta3.img — cut content); slot names are the **8-char IDE names**
(`csremington92` ↔ `remingtn`, `cswashington` ↔ `washing`), so naive prefix matching misses them; the
`la` suffix is ambiguous (`csfirela` = `firela` the slot, NOT `firetruk` + `la` the city).

### The rig contract (bobcat/taxi/zr350/remingtn pairs diffed frame-by-frame)

- **Flattened tree**: all `*_dam` twins, `chassis_vlo`, `ug_*` tuning parts and service dummies (`ped_*`,
  `engine`, `exhaust`, `headlights`, `taillights`, `petrolcap`) are gone. Movable parts hang directly off
  `chassis`, and each part frame carries its former `*_dummy` hinge transform verbatim (positions equal to
  the thousandth).
- **HAnim skeleton over the whole tree**: every frame has a bone id; the skeleton root (named per-car:
  `bobcat_dummy`, `taxi`, `zr350`, `remingtn`) carries the hierarchy table. Geometry is NOT skinned —
  rigid parts on bones. Bone id assignment is hand-made and inconsistent per car.
- **Wheels are four full geometry copies** under per-wheel nodes placed at the game rig's `wheel_*_dummy`
  positions, one bone each. Wheel geometry is authored at final size (bobcat wheel bbox radius 0.349
  byte-equal between gta3 and cutscene); frames carry no scale. Left wheels are presumed 180°-z-rotated
  (verify matrices at implementation).
- **Vertical rebase is a per-slot convention**: csbobcat92 is ground-rooted (+0.900 = 0.550 axle drop +
  0.349 wheel radius), csremington92 is not. Derivable per slot from the vanilla pair.
- **Paint is baked**: carcols paint markers (60,255,0 primary / 255,0,175 secondary) are replaced with
  fixed colours — the cutscene system does not apply carcols. `carplate`/`carpback` materials remain on
  bumpers.
- **TXDs are mostly empty** and resolve through `txdp` (txdcut.ide) plus the resident generic
  `vehicle.txd` — vanilla proves generics resolve inside cutscenes. Own TXDs exist only where the slot has
  no txdcut row (cscopcarsf, csdinghy — R*'s own workaround for their typo'd/missing rows) or a unique-era
  livery.
- **Bike rig** (csmtbike92): `chassis`, `wheel_rear`, `chainset`, `pedal_l/r`, `handlebars`,
  `forks_front`, `wheel_front` — same part names as the gameplay bike rig. **Boat rig** (csdinghy):
  `boat_hi` + `boat_rearflap_left/right`. Both are the same transform shape with different part
  vocabularies.

### The hand-made reference pack (`NO_COMMIT/cutscene-custom`, 19 cars)

Ground truth that the engine tolerates what the tool will emit: vanilla bone ids preserved **per part
name** for kept parts, partial hierarchies accepted (9 of 19 bones), wheels baked into the chassis
accepted, 70 k verts / 81 materials per cutscene car accepted (on the OLA+FLA target), self-contained TXDs
with upscaled generics accepted. The pack also shows the failure the tool avoids: 4.9 MB DFF + 11.5 MB TXD
per car of duplicated textures, where the empty-TXD + txdp route ships kilobytes.

## Decisions taken (user, 2026-08-12)

1. Duplicate slots get the same donor with no exceptions: cscopcarla + cscopcarla92 both from the
   `copcarla` mod; cszr350 + cszr350b both from `zr350`. The '92-era look and the `b` variant are
   REPLACED by the modern model — expected behaviour, not a loss.
2. **csmothership is converted from the `camper` mod** — the hippy livery is not preserved.
3. **Bike and boat branches are in scope for v1** (csmtbike92, csdinghy).
4. Plan 098 (all-land-vehicles, engine side) is NOT a prerequisite — zero code overlap; shared substrate
   (`rw-codec`, `tool-kit`, `@opensa/renderware`) already exists as packages.

## Restrictions check (`docs/restrictions/sa-target.md`)

Cutscene models are loaded by name into transient special slots — no vehicles.ide ids, no IPL rows, no new
TXD-pool entries (all 23 TXD names already exist; the tool only replaces bytes and adds two txdcut.ide
data rows). None of the target's pool ceilings are implicated. The one budget to record is
`cutscene.img` size growth (mod DFFs are MB-scale where vanilla cs DFFs are ~200 KB) — measured in plan
002, not guarded, since IMG VER2 addressing is untouched.
