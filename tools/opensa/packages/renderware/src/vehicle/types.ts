/**
 * Renderer-agnostic vehicle model (plan 074/08 B5 step 2). The three path builds an `Object3D` tree
 * (`three/build-vehicle.ts`); the own engine needs the SAME lore as flat buffers + part transforms. This is
 * the shared product both renderers' hosts consume.
 */
import type { RWUvAnimation } from '../parsers/binary/types';

/**
 * Per-vertex paint slot, carried in `meta.z`. The engine resolves it to the INSTANCE's colour at draw time,
 * so one uploaded model serves a street of differently-painted cars. (The B2 probe baked carcols straight
 * into vertex colours — with geometry now shared across instances that would force one geometry copy per
 * colour combination, and every parked car on a block would come out the same colour.)
 */
/** Per-vertex lamp tag (`meta.w` LOW nibble): the shader needs to know a lamp texel from a body texel. */
export const LampTag = {
  head: 1,
  none: 0,
  tail: 2,
} as const;

/**
 * Per-vertex material CLASS (`meta.w` HIGH nibble — 074/16 field round 2): paint, chrome and glass are not
 * the same surface and must reflect differently. Classified from the DFF material at build time:
 * carcols paint slots / the `xvehicleenv*` env map → paint (clearcoat + flakes); a chrome texture or the
 * `vehicleenvmap*` env map → chrome (near-mirror, the material's OWN sphere map supplies the authentic SA
 * tint); translucent → glass (sharp, no flakes); `_vlo` LOD meshes, lamps and coefficient-0 materials
 * (tyres, rubber, trim) → matte — excluded from reflections entirely.
 */
export const MaterialClass = {
  chrome: 2,
  glass: 3,
  matte: 0,
  paint: 1,
  /**
   * The two license-plate faces (plan 082/03). They are a material CLASS rather than a flag of their own
   * because this nibble is the only per-vertex channel with room left: the rigid vertex output already
   * stands at 15 of WebGPU's 16 inter-stage locations, so a plate could not have one. Both shade as MATTE
   * — the reflection switch tests `paint`/`chrome` by value, so anything else falls through with amount 0
   * — and both redirect the texture sample: `plateFace` to the generated text atlas, `plateBack` to the
   * three city backgrounds, each at the layer the instance's plate row names.
   */
  plateBack: 4,
  plateFace: 5,
} as const;

export const PaintSlot = {
  none: 0,
  primary: 1,
  quaternary: 4,
  secondary: 2,
  tertiary: 3,
} as const;

export interface VehicleBuildOptions {
  /** Force {@link VehiclePopUpLights} on a `misc_*` component whose faces carry no head-lamp marker — the
   *  build-time `features.txt` → `UP/DOWN_LIGHTS` declaration. Absent = derive from the model alone. */
  popUpLights?: boolean;
  /** `vehicles.ide` wheelScale as [front, rear] — SA scales the axles separately. Absent = [1, 1]. */
  wheelScale?: readonly [number, number];
}

export interface VehicleDoor {
  /** `door_lf` … — the hinge part's name. */
  name: string;
  part: number;
  /**
   * Every part whose frame lives under this door's hinge — the door atomic PLUS any separate glass/trim
   * atomics a mod authors there (SA rotates the whole frame subtree, so they travel with the door). Present
   * only when the subtree carries more than the door part itself; absent = just `part`.
   */
  parts?: readonly number[];
  side: string;
}

export interface VehicleDummy {
  name: string;
  position: [number, number, number];
  rotation: [number, number, number, number];
}

/**
 * The SERIALIZED model — a JSON header over one binary blob (`vehicle.json` + `vehicle.bin`). The lab reads
 * this instead of carrying a DFF parser and a game VFS; the game builds the model in-process and never
 * touches it. Same fields as {@link VehicleModelData}, with the typed arrays replaced by blob offsets.
 */
export interface VehicleFixture {
  doors: VehicleDoor[];
  dummies: VehicleDummy[];
  /** False when the index payload is uint32 — a model past 65 536 vertices. Absent on fixtures written
   *  before the width existed, when uint16 was the only shape the builder emitted. */
  index16?: boolean;
  indexCount: number;
  layout: {
    colors: number;
    indices: number;
    meta: number;
    /** Absent on fixtures built before the night set existed — the reader falls back to the day colours. */
    night?: number;
    normals: number;
    positions: number;
    reflect: number;
    uvs: number;
  };
  name: string;
  parts: VehicleModelPart[];
  /** Absent on models without a retractable-headlight component, and on paks built before it existed. */
  popUpLights?: VehiclePopUpLights;
  submeshes: VehicleModelSubmesh[];
  textures: { height: number; names: string[]; offset: number; width: number };
  /** `'world'` = the submeshes' `array` fields are refs into the SHARED world plan and the file carries no
   *  `TEXS`; absent = a private dictionary rides along, which is what every by-name class ships. */
  textureSource?: 'world';
  /** The UV animations this model's materials reference, model-local (see {@link VehicleModelData}).
   *  Absent when no material references one — which every `.osm` written before 099 also says. */
  uvAnimations?: RWUvAnimation[];
  /** The VehFuncs variant tree (see {@link VehicleModelData}). Absent on models without one, and on every
   *  `.osm` written before it existed — where every variant is drawn at once. */
  variants?: VehicleVariants;
  vertexCount: number;
  wheels: VehicleWheel[];
}

export interface VehicleModelData {
  colors: Uint8Array;
  doors: readonly VehicleDoor[];
  /** Every non-geometry frame, verbatim (headlights/taillights/exhaust/seats/…). */
  dummies: readonly VehicleDummy[];
  /**
   * Triangle indices, uint16 while the model fits and uint32 past 65 536 vertices (hi-poly mod cars do —
   * the field pair was 86 511 and 82 991). Consumers must bind by `BYTES_PER_ELEMENT`, never assume u16.
   */
  indices: Uint16Array | Uint32Array;
  /** Per-vertex slots: x = texture layer, y = lamps-on twin layer (0 = none), z = {@link PaintSlot},
   *  w = {@link LampTag} (low nibble) | {@link MaterialClass} << 4 (high nibble). */
  meta: Uint8Array;
  /**
   * The NIGHT vertex colours — the same RGBA layout as `colors`, replacing them as the day/night factor
   * goes to 1. Authored where the geometry carries SA's extra-vertex-colour set, and otherwise synthesized
   * as day × {@link NIGHT_AMBIENT}, which is exactly what the welded cell path does.
   */
  night: Uint8Array;
  normals: Float32Array;
  parts: readonly VehicleModelPart[];
  /** The retractable-headlight component, if this model has one. */
  popUpLights?: VehiclePopUpLights;
  positions: Float32Array;
  /**
   * Per-vertex REFLECTION slots (B5r), straight from the DFF's material-effect plugins:
   *   x = env-map layer in the texture array (0 = the material is not reflective),
   *   y = env-map coefficient × 255 (RpMatFX strength),
   *   z = SA reflection-plugin intensity × 255,
   *   w = SA specular-plugin level × 255.
   * SA's own env textures are BAKED DAYTIME images (a painted horizon for paint, a sunset photo for glass) —
   * the engine keeps their PATTERN and their settings but takes the reflection's COLOUR from the live sky, so
   * a car does not reflect a sunset at midnight.
   */
  reflect: Uint8Array;
  submeshes: readonly VehicleModelSubmesh[];
  texture: VehicleTextureArray;
  /**
   * UV animations from the DFF's UVAnimDict, keeping ONLY the entries this model's materials actually
   * reference; a submesh names its own by `uvAnim`, an index into THIS list. The world lane registers dict
   * names GLOBALLY across the pak (`resolveUvAnim`, cell-weld) because its cells index one shared manifest
   * array — a rigid model streams in and out on its own, so it carries its animations with it instead.
   * Absent when no material references one, which is every vehicle and nearly every prop.
   */
  uvAnimations?: readonly RWUvAnimation[];
  uvs: Float32Array;
  /**
   * The VehFuncs `f_extras` / `f_class` decision tree, when the model carries one: which optional parts a
   * SPAWN shows is chosen at runtime by walking it (`pickVariants`), the way the plugin does in the SA
   * target — a build-time pick would freeze one set of clutter, ads and body kits into every car in the
   * world. A submesh names the option it belongs to by `variant`.
   */
  variants?: VehicleVariants;
  wheels: readonly VehicleWheel[];
}

export interface VehicleModelPart {
  localRotation: [number, number, number, number];
  localTranslation: [number, number, number];
  name: string;
  /** Column-major mat4 — the mesh relative to the pivot. Doors only (the pivot is their hinge frame). */
  offset?: number[];
  scale?: number;
}

export interface VehicleModelSubmesh {
  /** Which texture ARRAY this submesh samples (opensa-pack 003 phase 5g). Absent means 0 — the single-array
   *  case every runtime build is; only the offline converter, planning from raw TXDs, ever sets it. */
  array?: number;
  /**
   * Part-local AABB of the submesh's triangles. The translucent sort keys on the eye's distance to the
   * NEAREST of its corners: `center − radius` counted a SCATTERED submesh (a mod's gauge cluster, pieces
   * across the whole dash, radius 1.8) as nearer than the equally-distant window sheet in front of it, and
   * the cabin drew OVER the glass. Absent on old fixtures — they fall back to `center`/`radius`.
   */
  bounds?: { max: [number, number, number]; min: [number, number, number] };
  /** Model-space centroid of the submesh's triangles (074/16 round 6) — the engine sorts TRANSLUCENT
   *  submeshes back-to-front by this each frame, or the steering wheel draws over the windscreen. */
  center: [number, number, number];
  /** Pairing key for the `_ok`/`_dam` twins (`door_lf`, `bonnet`, …); null when the part cannot deform. */
  damageGroup: null | string;
  /**
   * The `extraN` frame this submesh belongs to, or null/absent for the ordinary body. SA's optional parts
   * are mutually exclusive and a car shows AT MOST ONE — the choice belongs to the spawn, not to the build,
   * so every alternative ships and the runtime hides the rest per instance (`EngineVehicleHandle`).
   * Absent on fixtures built before that moved, where the builder had already resolved the choice.
   */
  extra?: null | string;
  indexCount: number;
  indexOffset: number;
  /**
   * Visibility group. `body` = the intact mesh (shown); `dam` = its damaged twin (hidden until an impact);
   * `lod` = the `_vlo` low-detail mesh (hidden until the LOD band swaps). All three are one primitive on the
   * engine side — per-submesh visibility — because prod expresses all three as three's `.visible`.
   */
  kind: 'body' | 'dam' | 'lod';
  /** Head/tail lamp tag from the SA marker colours — lamp materials render WHITE and carry this instead. */
  lamp: 'head' | 'tail' | null;
  part: number;
  /**
   * Which face of a license plate this submesh is, from the material's placeholder texture (plan 082/02):
   * `face` = the `carplate` text strip, `back` = the `carpback` city-background quad it is inset into.
   * The two are separate quads in the DFF, and the reversed `CCustomCarPlateMgr` keys on exactly these
   * names. Absent = not a plate, which is also what every `.osm` converted before 082 says — those cars
   * keep the stock placeholder look rather than breaking.
   */
  plate?: 'back' | 'face';
  /** Bounding radius about `center` (074/16 sort fix) — the translucent sort subtracts it so a raked
   *  windscreen counts by its NEAREST extent, not its centre (the wheel drew over the glass overhang).
   *  Optional: old fixtures sort by the centre alone. */
  radius?: number;
  translucent: boolean;
  /** True when this submesh is the WHEEL's rubber (`wheel-tyre.ts` — a geometric test, not a name). Rubber
   *  never reflects, and a damageable tyre will want to find itself later. Absent = not a tyre. */
  tyre?: boolean;
  /** Index into the MODEL's `uvAnimations` (plan 099/01) — this submesh's material scrolls/steps its UV0.
   *  Absent = static UVs, which is the only thing an `.osm` written before 099 can say. */
  uvAnim?: number;
  /**
   * The VehFuncs option this submesh belongs to — a {@link VehicleVariantNode} id — or absent for the
   * ordinary body. Shown only when the spawn's walk of {@link VehicleModelData.variants} chose it.
   */
  variant?: string;
}

/**
 * A retractable headlight assembly (the ZR-350's, and every mod that copies the convention): the `misc_*`
 * component the car parks its lamps in, plus how far it has to pitch UP for those lamps to face where they
 * light. Absent when the model has no such component.
 */
export interface VehiclePopUpLights {
  /** Open angle (rad) about the part's own X axis, DERIVED — see `popUpLights` in the builder. */
  angle: number;
  /** The `misc_*` part index. */
  part: number;
}

export interface VehicleTextureArray {
  height: number;
  layers: number;
  names: string[];
  /** RGBA8 layers, all one size, packed sequentially. */
  rgba: Uint8Array;
  width: number;
}

/**
 * One node of the VehFuncs variant tree — a selector container (`f_extras:2`), an option (`ac:1`,
 * `none[ycc]`, `5[lv]`) or a class tag (`ycc?c1`). Every node is also a selector over its own children:
 * a bare name selects one, `:N` selects N, `:0` none-or-one, `:0+` any number, `:N+` at least N.
 */
export interface VehicleVariantNode {
  children: VehicleVariantNode[];
  /** The `?…` condition VehFuncs evaluates at spawn (`c1` = city LS, `rain`, `h6-18`), verbatim. Carried
   *  so a runtime that learns to evaluate it needs no rebake — the picker treats it as always true today. */
  condition?: string;
  /** Unique within the model (the frame index) — what a submesh's `variant` names. */
  id: string;
  /** The authored name without its `:N`, `[tags]` and `?condition` decorations, lower-cased. */
  name: string;
  /** Class tags this option needs (`name[a,b]` = any of them chosen); absent = always eligible. */
  requires?: string[];
  /** How many children a spawn selects: `[min, max]`, `max` −1 = all of them. */
  select: [number, number];
}

export interface VehicleVariants {
  /** Top-level `f_class*` containers: their chosen children are the spawn's class tags. */
  classes: VehicleVariantNode[];
  /** Top-level `f_extras*` containers, walked after the classes are known. */
  extras: VehicleVariantNode[];
}

export interface VehicleWheel {
  front: boolean;
  part: number;
  radius: number;
}
