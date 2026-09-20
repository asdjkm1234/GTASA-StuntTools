import { buildVer2Buffer, type ImgArchive, openArchive } from '@opensa/renderware/archive/img-archive';
import { convertTo24h, parseTimecyc, stringifyTimecyc } from '@opensa/renderware/parsers/text/timecyc.parser';
/**
 * Reconstruct the real-asset test fixtures (`fixtures/original/`) from a clean, UNMODIFIED GTA San Andreas
 * install under `game-src/original` (default). These are Rockstar assets, so they are NOT committed
 * (`fixtures/original/` is gitignored) — every contributor regenerates them locally on setup, or after
 * changing the manifest:
 *
 *   npm run test:fixtures
 *
 * Custom, non-Rockstar fixtures (`fixtures/custom/`) are a MIRROR of `fixtures-src/` — the curated,
 * version-pinned, mod-derived and golden-snapshot files that have no other source (30 of 37 exist
 * nowhere else on disk: locked models, petro, Shrek, proper-fixes, txds, the cleo trace/listing
 * snapshots). Since 2026-08-17 (the user's call) NOTHING under `tests/` is committed and neither is
 * `fixtures-src/`: it lives locally and is backed up by hand; this script wipes `fixtures/custom/` and
 * copies it in FIRST, then the manifests run. A tree without `fixtures-src/` gets no custom fixtures
 * and the tests that need them skip (`skipIf(!existsSync)`) — loudly, in the summary below.
 * A `committed` fixture READS from `fixtures-src/` (a corpus subject whose mod folder no longer
 * ships it keeps its pristine copy there, so the corpus survives that folder changing under it).
 *
 * Each fixture declares how it is produced:
 *   - copy:    copied verbatim from `game-src/<game>/<from>`
 *   - extract: extracted by name from a `models/*.img` archive
 *   - archive: a one-file stock VER2 `.img` built around an extracted entry
 *   - mod:     copied from `mods-src/original/mods/<from>` — opensa-pack's production input is a MODDED game, and
 *              the mods carry things the stock game barely has (95 % of their textures ship a mip chain)
 *
 * Extend MANIFEST when a test needs a new real-asset fixture, or MOD_MANIFEST when it needs a modded one.
 *
 * `data/timecyc_24h.dat` is generated here (the stock 24h expansion of timecyc.dat, no mod overlay).
 * Curated / version-pinned test models that can't be reproduced from a stock copy live under
 * `fixtures-src/proper-fixes-models/` (mirrored to `fixtures/custom/`) instead.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

type Fixture =
  | { readonly dest: string; readonly entry: string; readonly type: 'archive' }
  | { readonly dest: string; readonly entry: string; readonly type: 'extract' }
  /** Copied from `mods-src/<game>/` (mods/ + vehicles/ subpaths) — see {@link CLEO_MANIFEST}. */
  | { readonly dest: string; readonly from: string; readonly type: 'cleo' }
  /** Copied from a KEPT path (`fixtures-src/…`) — for a corpus entry whose mod no longer ships it.
   *  The pristine copy lives there precisely so the corpus survives the mod folder changing under
   *  it; see the rhino row in {@link CLEO_MANIFEST}. */
  | { readonly dest: string; readonly from: string; readonly type: 'committed' }
  | { readonly dest: string; readonly from: string; readonly type: 'copy' }
  /** Copied from `mods-src/`, not from the game dir — see {@link MOD_MANIFEST}. */
  | { readonly dest: string; readonly from: string; readonly type: 'mod' };

const gameIndex = process.argv.indexOf('--game');
const GAME = gameIndex >= 0 ? process.argv[gameIndex + 1] : 'original';
const ROOT = join('game-src', GAME);
const ARCHIVES = ['models/gta3.img', 'models/gta_int.img', 'models/cutscene.img', 'anim/cuts.img'];
const OUT = 'fixtures/original';
/** The local, uncommitted source of the custom fixtures; mirrored to `fixtures/custom` on every run. */
const CUSTOM_SRC = 'fixtures-src';
const CUSTOM_OUT = 'fixtures/custom';

const copy = (from: string, dest: string): Fixture => ({ dest: `${OUT}/${dest}`, from, type: 'copy' });
const modFile = (from: string, dest: string): Fixture => ({ dest: `${OUT}/${dest}`, from, type: 'mod' });
const extract = (entry: string, dest: string): Fixture => ({ dest: `${OUT}/${dest}`, entry, type: 'extract' });

/**
 * Assets copied from `mods-src/original/mods` rather than the game dir.
 *
 * opensa-pack's PRODUCTION input is not a stock game: mod-installer bakes these mods into the archives
 * before it runs. They also carry things the stock game barely has — 95 % of their textures ship a mip
 * chain (up to 12 levels, 2048 px) — so "the converted dictionary preserves the chain" can only be tested
 * against one of them.
 */
const MOD_MANIFEST: readonly Fixture[] = [
  // A Chinatown building + its dictionary: 19 material textures, several 512² DXT1 with 10 mip levels.
  modFile('Chinatown Project v2 + Chinese Lamps/gta3_img/chinatown_sfe1.dff', 'mods/chinatown_sfe1.dff'),
  modFile('Chinatown Project v2 + Chinese Lamps/gta3_img/chinatownsfe.txd', 'mods/chinatownsfe.txd'),
  // The Map Fixes Pack road tile whose authored normals are winding-CONSISTENT yet face the ground on
  // visible top faces (35 down / 61 sideways of 168 — dark Gouraud wedges in the field): the plan 024
  // Family A real-asset guard for the `badShading` gate check.
  modFile('Map Fixes Pack/gta3_img/lae2_roads17.dff', 'mods/lae2_roads17.dff'),
  // The Map Fixes Pack copy of the Santa Maria beach slab: a re-export whose Struct FACE ARRAY winds all 65
  // road triangles opposite to its BinMeshPLG index data. RenderWare draws the index data, so reading the
  // face array put the slab face-down and single-sided culling deleted it — the "blue strip" (plan 095).
  // A synthetic clump cannot prove this: the whole point is what a real exporter actually writes.
  modFile('Map Fixes Pack/gta3_img/roads32_law2.dff', 'mods/roads32_law2.dff'),
  // The Pacific Park ferris wheel's light ring (plan 099): a UVAnimDict entry `f13d` — 261 keyframes
  // stepping UV0 by 1/13 every 0.225 s — plus the `Frames` material that references it. Nothing in stock
  // SA's vehicle/prop set animates its UVs, so the rigid builder's binding can only be proven on this one.
  // The 24h timecyc in the `timecyc24h.asi` (Dante) shape — the third name a world can carry (plan 104).
  // Taken from the `sa` layer, which ships the plugin's file VERBATIM; the opensa layer's copy is ours now
  // (its fog columns come from stock, 104/04) and is fixtured separately below. This is the only clean
  // 23 × 24 authored table in the corpus: our own generated `timecyc_24h.dat` is 21 × 24 and carries the
  // stock RAINY_COUNTRYSIDE 20h corruption.
  modFile('[24H] Refixed Original Timecycle 1.6/modloader/timecyc24h/timecyc24h.dat', 'data/timecyc24h.dat'),
  // What the opensa target actually SHIPS: Dante's table with `FarClp`/`FogSt` taken from stock. Fixtured
  // so a test can hold that split — re-copying Dante's file over it would otherwise be silent (104/04).
  modFile(
    '[24H] Refixed Original Timecycle (default FarClp + FogSt)/data/timecyc24h.dat',
    'mods/timecyc24h-shipped.dat',
  ),
  modFile('Pacific Park Rotating Ferris Wheel/gta3_img/ferriswheel_lights.dff', 'mods/ferriswheel_lights.dff'),
  modFile('Pacific Park Rotating Ferris Wheel/gta3_img/ferriswheel_lights.txd', 'mods/ferriswheel_lights.txd'),
];

/**
 * The plan 097 CLEO corpus — seven real Sanny-compiled `.cs` mods, copied from `mods-src/<game>/`
 * (plan 097/06 moved them out of `NO_COMMIT/cleo`; paths carry the mods/ vs vehicles/ subfolder).
 * Real scripts falsify what synthetic ones confirm: the `__SBFTR` footer and the native-call
 * encoding were both invisible to a synthetic corpus (097/01 decision 6). `cardoor-coach`/
 * `cardoor-bus` are the same script shipped by two mods — both are fixtured so the decode census
 * stays one line per mod.
 */
const cleoFile = (from: string, dest: string): Fixture => ({ dest: `${OUT}/${dest}`, from, type: 'cleo' });

const CLEO_MANIFEST: readonly Fixture[] = [
  cleoFile('mods/Pacific Park Rotating Ferris Wheel/CLEO/Rotating Ferris Wheel (Junior_Djjr).cs', 'cleo/ferris.cs'),
  cleoFile(
    'vehicles/bus - 1978 Motor Coach Industries MC-9 Crusader-II - stratumx/cleo/Car Left Door.cs',
    'cleo/cardoor-bus.cs',
  ),
  cleoFile(
    'vehicles/coach - 1985 Motor Coach Industries 102A3 - stratumx/cleo/Car Left Door.cs',
    'cleo/cardoor-coach.cs',
  ),
  cleoFile('vehicles/firela - 1986 Sutphen 75 Mid-Mounted Ladder Truck - stratumx/cleo/firela.cs', 'cleo/firela.cs'),
  cleoFile('vehicles/newsvan - 1991 Ford Econoline 350 SA News Van - funky/cleo/van door [SA].cs', 'cleo/vandoor.cs'),
  // The rhino's original script no longer lives in the mod folder — our authored replacement took its
  // place there (plan `cleo/scripts` 001). The corpus still needs it: it is one of the seven real
  // Sanny-compiled decode/trace subjects, AND the integration test uses it to pin that the original
  // does nothing on this model's real rig. So the pristine copy is COMMITTED and read from there;
  // sourcing it from a mod folder that can be edited under us is what made this fixture report
  // MISSING while a stale local copy kept the corpus tests green.
  { dest: `${OUT}/cleo/rhino.cs`, from: `${CUSTOM_SRC}/cleo/rhino.cs`, type: 'committed' },
  // The hotring's original light-killer (plan `cleo/scripts` 002). COMMITTED for the same reason as
  // the rhino's, one step earlier: it ships in the mod's `cleo-skipped/` folder — a folder whose name
  // that plan contemplated renaming — so the corpus must not depend on it still being there under that
  // name. 002's authored replacement was WITHDRAWN (superseded by plan 098/11: the effect is a property
  // of the model now), and this fixture deliberately OUTLIVED it — its value is being a real
  // Sanny-compiled decode / re-encode / listing subject, which never depended on us shipping anything.
  { dest: `${OUT}/cleo/nolights.cs`, from: `${CUSTOM_SRC}/cleo/no_lights.cs`, type: 'committed' },
  // The rhino's MODEL, not a script. A track script is only testable end-to-end against the rig it
  // actually addresses: the original's chain anchor `misc_e` is a dummy the vehicle builder does not
  // emit as a part, which is why it was a silent no-op on our runtime while every headless test on a
  // permissive mock passed (plan `cleo/scripts` 001 step 2).
  cleoFile('vehicles/rhino - GTA 5 Rhino - _F_/rhino.dff', 'vehicles/rhino.dff'),
  // A LOCKED mod DFF (anti-rip container sizes): vehicle-cutscene's clump reader must recover it —
  // half the real vehicle fleet ships this lock (plan 002 step 3 finding).
  cleoFile('vehicles/taxi - 1992 Chevrolet Caprice Taxi - funky/taxi.dff', 'vehicles/taxi-locked.dff'),
  // The Smooth Criminal MTB (plan 002 step 8): the bike variant-subtree policy's real subject —
  // `f_extras:<n>` containers whose chosen subtree carries sub-meshes (brake levers, grips), additive
  // `f_extras:<n>+` containers (both wheel reflectors), template parts shipped as meshless dummies.
  cleoFile(
    'vehicles/mtbike - Smooth Criminal Bicycles 3.0 Mountain Bike - zeneric/mtbike.dff',
    'vehicles/mtbike-smooth-criminal.dff',
  ),
  // The Dinghy HD boat (plan 002 step 9): real adoption subjects — propellers under the transom flaps,
  // movsteer steering under the hull, a details mesh; the hull authored at the origin (shim absorbs).
  cleoFile('vehicles/dinghy - Dinghy HD - michelle works/dinghy.dff', 'vehicles/dinghy-hd.dff'),
  // The alfamodding cabbie: a `f_wheel_1111` container whose wheel is a CHOSEN PATH of two groups
  // (`f_extras:2 → tire:1 → tire` + `rim:1 → hubcap`). The OpenSA builder instanced the first atomic
  // alone and drew four bare tyres with no rim (field 2026-08-17).
  cleoFile('vehicles/cabbie - 1982 Checker Taxicab - alfamodding/cabbie.dff', 'vehicles/cabbie-container-wheel.dff'),
  cleoFile('mods/Wind Farm/CLEO/Wind Farm (Junior_Djjr).cs', 'cleo/windfarm.cs'),
  // The two file kinds the installer learned to read in vehicle-installer plan 012 — authored by hand, by
  // eight and one of the 212 folders, and neither shape is guessable: the tug's ini section addresses its
  // trailers as `{{name}}` placeholders, and the slamvan's GXT lines are `KEY text` with the keys its own
  // `tuning_new_parts.txt` price rows already name. A synthetic copy would only prove our own assumption.
  cleoFile('vehicles/tug - Clark CT-50D Tug - smart/model-variations-extra.txt', 'vehicles/tug-variations.txt'),
  cleoFile('vehicles/slamvan - 1968 GMC Pickup Hammered - alfamodding/text.txt', 'vehicles/slamvan-text.txt'),
  // Plan 013's two, out of the ADDED-cars root (no folder in `vehicles/` ships either yet): the FLA audio
  // line of a trailer, and the one parked spot the fleet authors. Both are hand-written column formats whose
  // real spacing — tabs, runs of blanks, a trailing float — is the thing the merge has to survive.
  cleoFile(
    'add-vehicles/106veh - American Trailer Pack Tanker - blinkman (petrotr)/audio.txt',
    'vehicles/106veh-audio.txt',
  ),
  cleoFile('add-vehicles/001veh - 1971 Chevrolet Vega - alfamodding (manana)/parked.txt', 'vehicles/001veh-parked.txt'),
];

const MANIFEST: readonly Fixture[] = [
  // --- Loose data / config / text files (copied verbatim) ---
  copy('data/gta.dat', 'data/gta.dat'),
  copy('data/object.dat', 'data/object.dat'),
  copy('data/procobj.dat', 'data/procobj.dat'),
  copy('data/surfinfo.dat', 'data/surfinfo.dat'),
  copy('data/surface.dat', 'data/surface.dat'), // the 6×6 adhesion matrix surfinfo's groups index (081/10)
  copy('data/timecyc.dat', 'data/timecyc.dat'),
  copy('data/carcols.dat', 'data/carcols.dat'),
  copy('data/carmods.dat', 'data/carmods.dat'),
  copy('data/cargrp.dat', 'data/cargrp.dat'),
  copy('data/popcycle.dat', 'data/popcycle.dat'),
  copy('parked.json', 'parked.json'),
  // The only accepted exe (@opensa/asi-sdk's SA_FINGERPRINT). @opensa/validation's exe gate is the one check
  // whose failure only shows up in-game, so the ACCEPTED build must be proved to pass, not just the rejects.
  copy('gta_sa.exe', 'gta_sa.exe'),
  copy('data/water.dat', 'data/water.dat'),
  copy('data/vehicles.ide', 'data/vehicles.ide'),
  // The mod shop's two halves: which parts exist and whose they are (the txd column says, 014), and what
  // each is sold for. Both are read by the tuning derivation, so an install test needs them beside the rest.
  copy('data/maps/veh_mods/veh_mods.ide', 'data/maps/veh_mods/veh_mods.ide'),
  copy('data/shopping.dat', 'data/shopping.dat'),
  // The ONE file every stock tuning part's collision comes from — 194 entries, ids 1000-1193. A part with no
  // entry here crashes the mod shop unless its IDE flags carry 0x200000, and that guard needs the real list.
  extract('veh_mods.col', 'col/veh_mods.col'),
  copy('data/txdcut.ide', 'data/txdcut.ide'), // cutscene-TXD txdp dictionary — the vehicle-cutscene census link
  // The vehicle-cutscene golden pairs (plan 002 step 2): three vanilla cutscene rigs covering the three
  // hand-authoring styles (Box01 / wheel_*_node+_hi / axis_*), plus their stock gta3 donors — converting
  // the STOCK donor must reproduce the vanilla cutscene structure (bone ids, hierarchy flags, positions).
  extract('csbobcat92.dff', 'dff/cutscene/csbobcat92.dff'),
  extract('cstaxi92.dff', 'dff/cutscene/cstaxi92.dff'),
  extract('cszr350.dff', 'dff/cutscene/cszr350.dff'),
  extract('csremington92.dff', 'dff/cutscene/csremington92.dff'),
  extract('bobcat.dff', 'dff/cutscene/bobcat.dff'),
  extract('taxi.dff', 'dff/cutscene/taxi.dff'),
  // One-frame-wheel + intermediate-COG template styles (the step-3 real run surfaced them) + donors.
  extract('csglendale92.dff', 'dff/cutscene/csglendale92.dff'),
  extract('csmonster.dff', 'dff/cutscene/csmonster.dff'),
  extract('glendale.dff', 'dff/cutscene/glendale.dff'),
  extract('monster.dff', 'dff/cutscene/monster.dff'),
  // The junk-chassis-transform regression pair (gate-4 field finding): STOCK copcarla's `chassis` mesh
  // frame carries `[0, 1.637, -0.35]` that the game destroys at load — the converter must too.
  extract('cscopcarla92.dff', 'dff/cutscene/cscopcarla92.dff'),
  extract('copcarla.dff', 'dff/cutscene/copcarla.dff'),
  // The rotated-bone golden pair (plan 004 round 15): un-animated frames carry identity rotation at
  // runtime, so the securica's authored rotation has to be baked into the vertices to stand upright.
  extract('cssecurica92.dff', 'dff/cutscene/cssecurica92.dff'),
  extract('securica.dff', 'dff/cutscene/securica.dff'),
  // Two cutscene anims out of `anim/cuts.img` (plan 004 rounds 16 + 20): SMOKE1B poses the wheel corners
  // over a lying bind, SYND_4A drives every wheel channel to ~zero — the wheel stash the installer patches.
  // These four sat in the old fixture tree with no manifest line and were found the day the tree was
  // regenerated from scratch (2026-08-17): a fixture without a manifest line is one `rm -rf` from gone.
  extract('smoke1b.ifp', 'anim/smoke1b.ifp'),
  extract('synd_4a.ifp', 'anim/synd_4a.ifp'),
  // The bike golden pair (plan 002 step 8): the vanilla bike rig has no wheel corners — every part is a
  // mesh bone in the chassis subtree; the stock donor must reproduce it.
  extract('csmtbike92.dff', 'dff/cutscene/csmtbike92.dff'),
  extract('mtbike.dff', 'dff/cutscene/mtbike.dff'),
  extract('mtbike.txd', 'dff/cutscene/mtbike.txd'), // the bike slot's txdp parent in the install e2e
  // The boat golden pair (plan 002 step 9): body boat_hi + transom flaps; donor and vanilla author
  // identical frame positions — the pair reproduces exactly, no shims, no shift.
  extract('csdinghy.dff', 'dff/cutscene/csdinghy.dff'),
  extract('dinghy.dff', 'dff/cutscene/dinghy.dff'),
  extract('bobcat.txd', 'dff/cutscene/bobcat.txd'), // the txdp parent of the closure-check tests
  copy('data/peds.ide', 'data/peds.ide'),
  copy('data/handling.cfg', 'data/handling.cfg'),
  copy('data/info.zon', 'data/info.zon'),
  copy('data/maps/generic/barriers.ide', 'data/barriers.ide'),
  copy('data/maps/interior/int_cont.ipl', 'data/int_cont.ipl'),
  copy('models/effects.fxp', 'models/effects.fxp'),
  copy('models/effectsPC.txd', 'models/effectsPC.txd'),
  copy('text/american.gxt', 'text/american.gxt'),
  // Player character + a second ped, both stock SA peds regenerated from gta3.img (no custom character model
  // is committed): bmypol1 (a cop — the player model the character tests use) + its txd, and army (skeleton
  // frames in a different order than the HAnim hierarchy — the plan 052 ordering guard).
  extract('bmypol1.dff', 'character/bmypol1.dff'),
  extract('bmypol1.txd', 'character/bmypol1.txd'),
  extract('army.dff', 'character/army.dff'),

  // --- Entries extracted from the IMG archives ---
  extract('barriers.col', 'col/barriers.col'),
  extract('countn2_17.col', 'col/countn2_17.col'),
  // A 148-model library — the case mod-installer's partial-`.col` check is about (a mod replacing one of
  // these entries silently deletes the other 147's collision; field-found 2026-08-10 on `ferseat01_LAx`).
  extract('laxref.col', 'col/laxref.col'),
  extract('lae_stream0.ipl', 'ipl_binary/lae_stream0.ipl'),
  // Map-strip fixtures (lod-trees-generator): a text IPL + its companion binary stream share one LOD-index space
  // — a stream's `lod` indexes into its area's text IPL. `lae` is a coupled urban pair (the text has its own
  // internal HD→LOD links AND `lae_stream0` HDs point into it); `countrye` is the canonical countryside case
  // where the text holds tree LOD bigbuildings (`lod_vbg_fir_co`, all `lod -1`) referenced from `countrye_stream1`.
  copy('data/maps/la/lae.ipl', 'ipl_text/lae.ipl'),
  copy('data/maps/country/countrye.ipl', 'ipl_text/countrye.ipl'),
  extract('countrye_stream1.ipl', 'ipl_binary/countrye_stream1.ipl'),
  extract('counxref.ifp', 'dff/anim-clump/counxref.ifp'),
  extract('nt_noddonkbase.dff', 'dff/anim-clump/nt_noddonkbase.dff'),
  // The Burger Shot of LAw — an `anim` clump of TWO atomics (the building at the root, its 5 m burger sign on a
  // child frame at (7.2, −7.3, 1.0)). Its stock LOD row is a plain `objs` atomic, and SA keeps ONE atomic of
  // whatever clump such a row reads: a verbatim clone showed only the sign, at the origin — the "LOD absent"
  // of open issue sa-lod-visibility-budget round 15. The clone must merge the atomics with the frame offset baked.
  extract('burger01_law.dff', 'dff/anim-clump/burger01_law.dff'),
  // Plan 095's two geometry-parity fixtures, both STOCK:
  //   roads32_law2 — the vanilla beach slab, whose face array AGREES with its drawn index data. It is the
  //     control for the mod copy above: same model, same 93 triangles, and the winding must not move.
  //   bloodrb      — one of exactly two SA models carrying the ADC plugin (0x134), a PS2 tristrip whose
  //     parity bits we do not decode. Unwinding it with the PC rule invents triangles (geom 18: 1050 →
  //     1487), so the parser falls back to the face array; without a fixture that guard is untested.
  extract('roads32_law2.dff', 'dff/geometry-parity/roads32_law2.dff'),
  extract('bloodrb.dff', 'dff/geometry-parity/bloodrb.dff'),
  // The opensa-pack `.osm` conversion tests (plan 003 phase 5) run on REAL models, one per asset class, each
  // with the TXD its IDE row names — a converted model must lose nothing against the DFF/TXD build, and a
  // hand-built clump cannot prove that.
  extract('des_xoilfield.txd', 'dff/anim-clump/des_xoilfield.txd'), // nt_noddonkbase's dictionary
  extract('lamppost1.dff', 'dff/topple/lamppost1.dff'), // object.dat uprootLimit 240 — the topple prop
  extract('dynsigns.txd', 'dff/topple/dynsigns.txd'),
  extract('labins01_la.txd', 'dff/breakable/labins01_la.txd'), // binnt08_la's dictionary
  // The two ends of the alpha-CLASS rule (plan 092), as real texels rather than generated histograms:
  // `lae2tempshit` carries the Watts Towers' lattice (a mask with a 23.6 % mid-alpha edge — the field bug)
  // beside an opaque wall texture, and `kmb_keypadx` carries a uniform glass film that must never upgrade.
  extract('lae2tempshit.txd', 'dff/alpha-class/lae2tempshit.txd'),
  extract('kmb_keypadx.txd', 'dff/alpha-class/kmb_keypadx.txd'),
  extract('sjmcacti2.dff', 'dff/clutter/sjmcacti2.dff'), // a procobj.dat species (and a topple prop)
  extract('gta_cactus.txd', 'dff/clutter/gta_cactus.txd'),
  extract('binnt08_la.dff', 'dff/breakable/binnt08_la.dff'),
  extract('washer.dff', 'dff/building/washer.dff'),
  // The rock whose rebuilt BinMesh lost its split ORDER (open issue sa-lod-visibility-budget, round 14): 15
  // splits authored `0..7, 9..14, 8` — material 8 is the vertex-alpha detail layer and must stay LAST through
  // a count-changing re-encode, or the reference install's SkyGfx dual pass smears it over the rock.
  extract('cehollyhil06.dff', 'dff/binmesh-order/cehollyhil06.dff'),
  // Stock SA ships 11 EMPTY TXDs — a valid dictionary chunk in one 2 048-byte sector with nothing inside.
  // `mine` is the awkward one: its material NAMES a texture the empty dictionary cannot supply.
  extract('mine.dff', 'dff/empty-txd/mine.dff'),
  extract('mine.txd', 'dff/empty-txd/mine.txd'),
  // A stock vegetation LOD DFF — the template the lod-trees-generator rebuilds card geometry over. Carries the
  // tristrip flag + an extra-vertex-colour (0x253f2f9) extension, both of which the encoder must scrub (else SA
  // renders the impostor as nothing).
  extract('lodroadscoast02.dff', 'dff/lod-template/lodroadscoast02.dff'),
  extract('esc_step.dff', 'dff/escalator/esc_step.dff'),
  extract('escl_la.dff', 'dff/escalator/escl_la.dff'),
  // The SF fountain (IDE 9833, txd fountain_sfw): a stock model carrying THREE 2dfx type-1 particle anchors
  // (`water_fountain`) — the converter's only real-asset case for welding emitters into a cell (074/06 row 13).
  extract('fountain_sfw.dff', 'dff/particles/fountain_sfw.dff'),
  extract('fountain_sfw.txd', 'dff/particles/fountain_sfw.txd'),
  extract('ws_floodbeams.dff', 'dff/floodbeams/ws_floodbeams.dff'),
  extract('ce_grndpalcst05.dff', 'dff/frame-offset-ignored/ce_grndpalcst05.dff'),
  extract('skullpillar01_lvs.dff', 'dff/particle/skullpillar01_lvs.dff'),
  // A refinery chimney carrying BOTH a 2dfx particle emitter (smoke) AND light coronas — the `stripParticleEffects`
  // fixture (drops the smoke, keeps the coronas). Also has day + night vertex colours.
  extract('refchimny01.dff', 'dff/particle/refchimny01.dff'),
  // A stock HD tree with day + night vertex colours — the night-tint fixtures (lod-trees `computeNightTint` and the
  // lod-procobj mesh night-colour carry).
  extract('cedar1_hi.dff', 'dff/night-colours/cedar1_hi.dff'),
  // The LV strip's neon-rope palm (vegaxref 3509): the rope's night set is saturated red (255/49/49) over a
  // flat grey day (81/81/81) — Rec709 luma reads it DARKER than day, the case that broke the luma-delta
  // emissive rule (the rope never glowed; map-object round 2026-07-22).
  extract('vgsn_nitree_r01.dff', 'dff/night-colours/vgsn_nitree_r01.dff'),
  extract('vgsn_nitree.txd', 'dff/night-colours/vgsn_nitree.txd'),
  extract('dyntraffic.txd', 'dff/trafficlight-backface-culling/dyntraffic.txd'),
  extract('admiral.dff', 'dff/vehicle/admiral.dff'),
  extract('squalo.dff', 'dff/vehicle/squalo.dff'),
  // infernus: the vehicle-optimizer scale test fixture — a hierarchical rig (dummies) + embedded COL3 collision.
  extract('infernus.dff', 'dff/vehicle/infernus.dff'),
  extract('admiral.dff', 'vehicles/admiral.dff'),
  // zr350: the ONE stock car with a pop-up headlight pod (`misc_a` holding head-lamp faces) — the
  // real-asset guard for the retractable-headlight derivation.
  extract('zr350.dff', 'vehicles/zr350.dff'),
  extract('zr350.txd', 'vehicles/zr350.txd'),
  // A SECOND car, so a modloader test can prove the mod's GEOMETRY won rather than just its texture kind.
  extract('cheetah.dff', 'vehicles/cheetah.dff'),
  extract('cheetah.txd', 'vehicles/cheetah.txd'),
  // the world-adapter integration test's vehicle pair + the loose generic vehicle dictionary
  extract('admiral.txd', 'vehicles/admiral.txd'),
  copy('models/generic/vehicle.txd', 'models/generic/vehicle.txd'),
  extract('junk.txd', 'txd/junk.txd'),
  extract('compfukhouse3.dff', 'world/compfukhouse3.dff'),
  extract('mcstraps_LAe2.dff', 'world/mcstraps_LAe2.dff'),
  // Two co-located San Fierro crack-factory shells that share boundary geometry — the map-optimizer seam-weld
  // (plan 016) real-asset pair: a genuine cross-model prelit seam (~455 boundary groups, differing prelit).
  extract('cf_ext_dem_sfs.dff', 'world/cf_ext_dem_sfs.dff'),
  extract('crackfact_sfs.dff', 'world/crackfact_sfs.dff'),
  // A Vegas road ramp meeting a junction slab — the map-optimizer gap-stitch (plan 017, retired) real-asset
  // pair: their boundaries meet at a few points (variant A) then diverge, a genuine cross-model geometry seam.
  extract('vegassroad0522a.dff', 'world/vegassroad0522a.dff'),
  extract('vgssspagjun08.dff', 'world/vgssspagjun08.dff'),
  // SF Chinatown victorian whose night set is dark at the median (~19) with the window glow in the p95 tail —
  // the map-optimizer prelight (plan 019) "tail glow" class that motivated only-mode `nightMax` (capNightSet).
  extract('newvic1_sfw.dff', 'world/newvic1_sfw.dff'),

  // --- Scoped texture resolution (lod-common plan 004): a bush whose texture NAME (`newtreeleaves128`)
  // exists in many TXDs with different pixels — its def TXD (badlands, vegepart.ide) vs the flat-index
  // first-wins winner (gta_proc_bush). ---
  extract('sm_bush_large_1.dff', 'world/sm_bush_large_1.dff'),
  extract('badlands.txd', 'txd/badlands.txd'),
  extract('gta_proc_bush.txd', 'txd/gta_proc_bush.txd'),

  // --- Derived: a stock VER2 archive holding a single extracted vehicle ---
  { dest: `${OUT}/img/admiral.img`, entry: 'admiral.dff', type: 'archive' },
];

let archives: ImgArchive[] | null = null;

function extractEntry(name: string): null | Uint8Array {
  for (const archive of openArchives()) {
    const data = archive.get(name);
    if (data) {
      return new Uint8Array(data);
    }
  }

  return null;
}

function openArchives(): ImgArchive[] {
  archives ??= ARCHIVES.map((rel) => openArchive(new Uint8Array(readFileSync(join(ROOT, rel)))));

  return archives;
}

/** The subfolders a `mods-src/<game>/<subject>` may hide its folders in (mod layers · vehicle layers). */
const MODS_SRC_LAYERS: readonly string[] = ['common', 'sa', 'opensa', 'models', 'new'];

/** `fixtures-src/` → `fixtures/custom/`, wiped first. Null when the source folder is absent (nothing touched). */
function mirrorCustomFixtures(): null | number {
  if (!existsSync(CUSTOM_SRC)) {
    return null;
  }
  rmSync(CUSTOM_OUT, { force: true, recursive: true });
  let count = 0;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const from = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(from);
        continue;
      }
      if (!entry.isFile() || entry.name === '.DS_Store') {
        continue;
      }
      const dest = join(CUSTOM_OUT, relative(CUSTOM_SRC, from));
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(from, dest);
      count += 1;
    }
  };
  walk(CUSTOM_SRC);

  return count;
}

/**
 * Resolve `<subject>/<folder>/<rest…>` inside `mods-src/<game>`, by the folder's NAME.
 *
 * Neither half of that path is stable, and both moved under this manifest without a test failing —
 * committed copies keep the corpus green while the sources drift:
 *
 * - the **number** is a position, not an identity: `renumber-mods` compacts it whenever a mod is deleted
 *   (`60. Pacific Park…` is `59.` today), so it is matched loosely and left out of the manifest;
 * - the **layer** is a build decision: `mods/` became `common/` + `sa/` (mod-installer plan 011) and
 *   `vehicles/` became `models/` + `new/` (vehicle-installer plan 007), so every layer is searched.
 *
 * The NAME is what the author gave the mod, and it is what the manifest states.
 */
function modsSrcPath(subject: string, relative: string): string {
  const [folder, ...rest] = relative.split('/');
  const wanted = withoutModNumber(folder ?? '');
  for (const root of [
    join('mods-src', GAME, subject),
    ...MODS_SRC_LAYERS.map((l) => join('mods-src', GAME, subject, l)),
  ]) {
    if (!existsSync(root)) {
      continue;
    }
    const match = readdirSync(root, { withFileTypes: true }).find(
      (entry) => entry.isDirectory() && withoutModNumber(entry.name) === wanted,
    );
    if (match) {
      return join(root, match.name, ...rest);
    }
  }

  throw new Error(`no folder named '${wanted}' under mods-src/${GAME}/${subject} (or its layers)`);
}

function produce(fixture: Fixture): null | Uint8Array {
  switch (fixture.type) {
    case 'archive': {
      const data = extractEntry(fixture.entry);

      return data ? buildVer2Buffer([{ data, name: fixture.entry }]) : null;
    }
    case 'cleo': {
      const [subject, ...rest] = fixture.from.split('/');

      return new Uint8Array(readFileSync(modsSrcPath(subject ?? '', rest.join('/'))));
    }
    case 'committed': {
      return new Uint8Array(readFileSync(fixture.from));
    }
    case 'copy': {
      return new Uint8Array(readFileSync(join(ROOT, fixture.from)));
    }
    case 'extract': {
      return extractEntry(fixture.entry);
    }
    case 'mod': {
      // `mods-src/<game>/mods` — the per-game layout (plan 079); the old flat `mods-src/mods` path made
      // every mod fixture report MISSING while stale copies from the previous layout masked it. The mod is
      // found by NAME (see {@link modsSrcPath}) — its number and its layer both move without notice.
      return new Uint8Array(readFileSync(modsSrcPath('mods', fixture.from)));
    }
  }
}

/** `60. Pacific Park Rotating Ferris Wheel` → `pacific park rotating ferris wheel`. */
function withoutModNumber(folder: string): string {
  return folder.replace(/^\d+(?:\.\d+)?\.\s*/, '').toLowerCase();
}

let written = 0;
const missing: string[] = [];

// The custom mirror goes FIRST: `committed` manifest entries read from it, and a wipe-and-copy keeps a
// file deleted from the source from surviving in the mirror (the persistent-`--out` lesson).
const customCount = mirrorCustomFixtures();

for (const fixture of [...MANIFEST, ...MOD_MANIFEST, ...CLEO_MANIFEST]) {
  let data: null | Uint8Array = null;
  try {
    data = produce(fixture);
  } catch {
    data = null;
  }
  if (!data) {
    missing.push(fixture.dest);
    continue;
  }
  mkdirSync(dirname(fixture.dest), { recursive: true });
  writeFileSync(fixture.dest, data);
  written += 1;
}

// Generated: the stock 24-hour timecyc (convertTo24h of timecyc.dat), no RealVision/mod overlay — the
// game build's `npm run timecyc` keeps its own enhanced merge; this fixture stays a plain stock expansion.
try {
  const timecyc = readFileSync(join(ROOT, 'data', 'timecyc.dat'), 'utf8');
  const dest = `${OUT}/data/timecyc_24h.dat`;
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, stringifyTimecyc(convertTo24h(parseTimecyc(timecyc))));
  written += 1;
} catch {
  missing.push(`${OUT}/data/timecyc_24h.dat`);
}

console.log(
  `test:fixtures (${GAME}): wrote ${written}/${MANIFEST.length + MOD_MANIFEST.length + CLEO_MANIFEST.length + 1} into ${OUT}/`,
);
if (customCount === null) {
  console.error(
    `\n  NO ${CUSTOM_SRC}/ — ${CUSTOM_OUT}/ was not (re)built; the tests that need a custom fixture will SKIP.` +
      ` The folder is local and uncommitted (see .gitignore): restore it from your backup.`,
  );
} else {
  console.log(`test:fixtures (custom): mirrored ${customCount} from ${CUSTOM_SRC}/ into ${CUSTOM_OUT}/`);
}
if (missing.length > 0) {
  console.error(`\n  MISSING ${missing.length} — source not found in ${ROOT}:`);
  for (const dest of missing) {
    console.error(`    - ${dest}`);
  }
  console.error(`\n  Ensure game-src/${GAME} is a complete, unmodified GTA San Andreas install.`);
  process.exitCode = 1;
}
