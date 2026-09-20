/**
 * `.osm` → an engine-ready model, for every host that has the bytes (201/5-04).
 *
 * This lived in `packages/game/src/adapters/vehicle-osm.ts` until the dispatch console needed it. It is not
 * game logic — there is no ECS, no player and no frame in it, only the inverse of opensa-pack's
 * `packVehicleFixture`: three section reads and some `subarray` views. What made it move is the rule the
 * console is the proof of, that **a non-game surface reaches the game layer through the environment driver
 * alone** (`docs/restrictions/architecture.md`), and the precedent 201/5-03 set when `zoneAt` moved out of
 * `ZoneNameSystem`: move the rule to where every consumer can reach it rather than widen the import.
 *
 * It lands HERE — beside {@link openLazyVer2}, which is how a browser gets these bytes out of an archive —
 * rather than in `@opensa/engine-formats`, which owns the container and says so: *"sections are opaque byte
 * ranges here; what is inside each one is the asset class's business"*. That, plus its zero-dependency
 * promise (this reader needs the fixture type), is why the decode is a loader's job and not a format's.
 *
 * The point of the whole format: the work the unoptimized path does at spawn (parse the DFF in a worker, walk
 * the chunk tree for the embedded COL on the main thread, decode a TXD, bucket it into an array) already
 * happened offline, and the texture payload stays compressed all the way to `createVehicleModel`. The
 * `DESC`/`GEOM` split is what makes that cheap: `COLL` is read without touching geometry, so the double
 * consumption of the DFF does not come back.
 */
import type { VehicleModelData } from '@opensa/renderware';
import type { VehicleFixture } from '@opensa/renderware/vehicle/types';

import {
  decodeOsm,
  decodeOsmCollision,
  decodeOsmTextures,
  type OsmCollision,
  osmSection,
  OsmSectionTag,
} from '@opensa/engine-formats';

/** Byte strides of the `GEOM` sections, matching what `packVehicleFixture` reserved. */
const STRIDE = { colors: 4, index: 2, meta: 4, normals: 12, positions: 12, reflect: 4, uvs: 8 };

/** What every converted rigid model carries: the engine-ready upload, its fixture, and collision if any. */
export interface OptimizedModel {
  /** Present only when the class bakes one (vehicles do; a clutter species does not). */
  collision?: OsmCollision;
  fixture: VehicleFixture;
  model: RigidModelInit;
}

/**
 * The engine's rigid-model upload shape. Structural on purpose: a producer must not import `@opensa/engine`
 * types just to describe an argument, and the engine must not learn RenderWare types.
 */
export interface RigidModelInit {
  colors: Uint8Array;
  /** False when `indices` is uint32 — a model past 65 536 vertices. Absent = the historical uint16. */
  index16?: boolean;
  indexCount: number;
  indices: Uint8Array;
  meta: Uint8Array;
  /** NIGHT vertex colours (same layout as `colors`) — SA's extra-vertex-colour set, or a synthesized one. */
  night: Uint8Array;
  normals: Uint8Array;
  parts: VehicleModelData['parts'];
  positions: Uint8Array;
  reflect: Uint8Array;
  submeshes: VehicleModelData['submeshes'];
  /** One per texture ARRAY; a submesh's `array` indexes it. Runtime-built models always carry exactly one. */
  textures: readonly RigidTextureInit[];
  /** Model-local UV animations a submesh's `uvAnim` indexes (plan 099/01). Absent = nothing animates. */
  uvAnimations?: VehicleModelData['uvAnimations'];
  uvs: Uint8Array;
  vertexCount: number;
}

/** Mirrors the engine's `ModelTextureInit` — our optimized `.ostex`, or RGBA8 layers from a runtime parse. */
export type RigidTextureInit =
  | { bytes: Uint8Array; kind: 'ostex' }
  | { height: number; kind: 'rgba'; layers: number; rgba: Uint8Array; width: number };

/**
 * Read any converted rigid model — geometry, dictionary and description in one container, engine-ready.
 *
 * `COLL` is NOT required — vehicles carry it, a clutter species does not. Every class the converter emits
 * shares `DESC`/`GEOM`/`TEXS`; the class-specific sections are read by their own callers.
 */
export function readModelOsm(name: string, osm: Uint8Array): OptimizedModel {
  const sections = decodeOsm(osm);
  const section = (tag: number, label: string): Uint8Array => {
    const bytes = osmSection(sections, tag);
    if (!bytes) {
      throw new Error(`${name}.osm is missing its ${label} section`);
    }

    return bytes;
  };
  const fixture = JSON.parse(new TextDecoder().decode(section(OsmSectionTag.DESC, 'DESC'))) as VehicleFixture;
  const geom = section(OsmSectionTag.GEOM, 'GEOM');
  // A car is one array; a map object is routinely several (one array is one size AND format AND mip count),
  // and each submesh names the one it samples. All of them come through — dropping the tail here is how a
  // building would render every wall in whatever texture happened to land in array 0.
  // A map object points into the SHARED world plan instead of carrying a dictionary: its submeshes' `array`
  // fields are refs into the arrays the cells already stream, so there is no `TEXS` to read and nothing to
  // upload. Every other class ships its own.
  const texs = fixture.textureSource === 'world' ? null : section(OsmSectionTag.TEXS, 'TEXS');
  const dictionaries = texs ? decodeOsmTextures(texs).arrays : [];
  if (texs && dictionaries.length === 0) {
    throw new Error(`${name}.osm carries no texture array`);
  }
  const collisionBytes = osmSection(sections, OsmSectionTag.COLL);

  const at = (offset: number, length: number): Uint8Array => geom.subarray(offset, offset + length);
  const { layout, vertexCount } = fixture;

  return {
    ...(collisionBytes ? { collision: decodeOsmCollision(collisionBytes) } : {}),
    fixture,
    model: {
      colors: at(layout.colors, vertexCount * STRIDE.colors),
      // A fixture written before the width existed is uint16 — that was the only shape the builder emitted.
      index16: fixture.index16 ?? true,
      indexCount: fixture.indexCount,
      indices: at(layout.indices, fixture.indexCount * ((fixture.index16 ?? true) ? STRIDE.index : 4)),
      meta: at(layout.meta, vertexCount * STRIDE.meta),
      // A fixture from before the night set simply has no darker twin: the day colours stand in, which
      // makes the vertex stage's day → night mix a no-op rather than a black model.
      night:
        layout.night === undefined
          ? at(layout.colors, vertexCount * STRIDE.colors)
          : at(layout.night, vertexCount * STRIDE.colors),
      normals: at(layout.normals, vertexCount * STRIDE.normals),
      parts: fixture.parts,
      positions: at(layout.positions, vertexCount * STRIDE.positions),
      reflect: at(layout.reflect, vertexCount * STRIDE.reflect),
      submeshes: fixture.submeshes,
      textures: dictionaries.map((bytes) => ({ bytes, kind: 'ostex' }) as const),
      // Absent on every `.osm` written before 099 and on every model whose materials animate nothing —
      // the same "no animation" the builder means by omitting it.
      ...(fixture.uvAnimations?.length ? { uvAnimations: fixture.uvAnimations } : {}),
      uvs: at(layout.uvs, vertexCount * STRIDE.uvs),
      ...(fixture.variants ? { variants: fixture.variants } : {}),
      vertexCount,
    },
  };
}
