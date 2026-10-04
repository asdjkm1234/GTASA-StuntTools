/**
 * Carcols paint + lamp-marker bake (plan 002 step 5; plan 004 round for BCESAR4). The cutscene system
 * never applies carcols, so the Kam's/ZModeler paint MARKER colours render raw (the gate-4 green/pink).
 * Vanilla cs models ship their paint baked into the material colours; this pass does the same: every
 * paint-marker material gets the model's first carcols combo, alpha preserved. LAMP markers (the four
 * per-lamp ID colours on `vehiclelights*` materials) are engine metadata the gameplay renderer swaps out
 * per frame — the cutscene renderer swaps nothing, so they render raw too (BCESAR4's green/amber lenses).
 * Vanilla cs models bake them to WHITE with the authored alpha kept (measured across the fleet; the three
 * models that kept raw markers — csbobcat92/cslegend566/cssabre92 — are R* slips, not a rule), so this
 * pass does the same.
 *
 * The patch is surgical: material Struct colour bytes are rewritten IN PLACE on a copy of the DFF —
 * chunk sizes never change, everything else stays byte-identical.
 */
import type { VehicleColours } from '@opensa/renderware/parsers/text/carcols.parser';

import { readRw, RW_CLUMP, RW_GEOMETRY, RW_GEOMETRY_LIST, RW_STRUCT, type RwChunk } from '@opensa/rw-codec/chunk';

const RW_MATERIAL_LIST = 0x08;
const RW_MATERIAL = 0x07;

/** The model's four paint colours: primary, secondary, tertiary, quaternary. */
export type PaintColours = [Rgb, Rgb, Rgb, Rgb];

/** RGB triple (0–255). */
export type Rgb = [number, number, number];

/** Kam's/ZModeler carcols paint markers → paint slot 0..3 (mirrors `build-vehicle-model.ts`). */
const PAINT_MARKERS = new Map<string, number>([
  ['0,255,255', 2],
  ['60,255,0', 0],
  ['255,0,175', 1],
  ['255,255,0', 3],
]);

/** SA per-lamp ID colours (mirrors `build-vehicle-model.ts` LAMP_MARKERS): FL / FR / RL / RR. */
const LAMP_MARKERS = new Set<string>(['0,255,200', '185,255,0', '255,60,0', '255,175,0']);

const RW_TEXTURE = 0x06;
const RW_STRING = 0x02;

/**
 * The window-pane classifier feeding the render-order pass (`finalizeAtomics`): a WINDOW pane is
 * classified by data, never name — translucent below {@link WINDOW_ALPHA_CEILING}, off the lamp atlas,
 * and either dark-tinted (luminance < 128) or in R*'s bright-glass alpha range (≤ 128, the vanilla
 * `255,255,255,26..128` recipes). Lenses/decals ride bright colours at alpha 150+ or `vehiclelights*`.
 * The pane's ALPHA itself stays the mod's authored gameplay tint (plan 004 round 7): an earlier round
 * clamped it to the vanilla twin's floor chasing the stacked-window opacity, but the true mechanism was
 * round 5's render order — once panes draw last they composite exactly as the sorted gameplay pipeline
 * does, and the clamp only erased the tint and sheen the mod carries in gameplay.
 */
const WINDOW_ALPHA_CEILING = 200;

/**
 * Replace every paint-marker material colour with the model's paint, alpha preserved. Returns the baked
 * copy + the number of materials touched. Throws when the model carries markers but `colours` is null
 * (no carcols row) — a marker the game would render raw is an error, not a silent green car.
 */
export function bakePaintMarkers(dff: Uint8Array, colours: null | PaintColours): { baked: number; bytes: Uint8Array } {
  const bytes = dff.slice();
  const clump = readRw(bytes).chunks.find((chunk) => chunk.type === RW_CLUMP);
  const geometryList = clump?.children?.find((chunk) => chunk.type === RW_GEOMETRY_LIST);
  let baked = 0;
  for (const geometry of geometryList?.children ?? []) {
    if (geometry.type === RW_GEOMETRY) {
      baked += bakeGeometry(geometry, colours);
    }
  }

  return { baked, bytes };
}

/**
 * Whether a geometry chunk BODY carries ANY translucent material (alpha < 255) — the pipeline pass
 * keeps such atomics on the DEFAULT pipeline (plan 004 round 9): the vehicle pipe drops translucents
 * outside a real CVehicle, and lamp lenses / decals / badges sit ABOVE the window band (alpha 200+),
 * so the round-8 pane-only exception still lost them (the burrito's tail lights).
 */
export function geometryBodyHasTranslucency(body: Uint8Array): boolean {
  const materialList = readRw(body).chunks.find((chunk) => chunk.type === RW_MATERIAL_LIST);
  for (const { struct } of listMaterialStructs(materialList)) {
    if (struct.data![7] < 255) {
      return true;
    }
  }

  return false;
}

/** `rpGEOMETRYMODULATEMATERIALCOLOR` — without it RW's DEFAULT pipeline ignores the material colour. */
const RP_GEOMETRY_MODULATE_MATERIAL_COLOR = 0x40;

/** Byte offset of the geometry flags word inside a geometry chunk BODY (past the Struct chunk header). */
const GEOMETRY_FLAGS_OFFSET = 12;

/**
 * Set `rpGEOMETRYMODULATEMATERIALCOLOR` on a geometry that carries a translucent material, IN PLACE.
 *
 * Without that flag RW's default pipeline never reads the material colour — so a material alpha of 115
 * is simply not applied and the surface renders fully opaque. A mod can ship a window like that and
 * never notice: in GAMEPLAY vehicle glass is drawn by SA's vehicle pipe, which takes the material alpha
 * itself and does not consult the flag. Cutscene translucents sit on the DEFAULT pipe (round 9), where
 * the flag decides — so the same pane that is transparent while driving is a solid sheet in a cutscene.
 *
 * Field-measured on PROLOG3 (plan 001, 2026-08-14): the sheriff car's windscreen and rear screen read as
 * matte from every angle. `copcarla` is the ONLY mod of the 23 whose translucent geometries lack the
 * flag — `windscreen_ok`, `body_windows`, `glass`, `f_steer` — and they are exactly the panes the field
 * called out; its door glass carries the flag and looked right all along.
 *
 * Only geometries that already carry translucency are touched: on an opaque geometry the flag would
 * change how the material colour tints the texture, which is not ours to decide.
 */
export function ensureModulateMaterialColour(body: Uint8Array): boolean {
  if (!geometryBodyHasTranslucency(body)) {
    return false;
  }
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const flags = view.getUint32(GEOMETRY_FLAGS_OFFSET, true);
  if ((flags & RP_GEOMETRY_MODULATE_MATERIAL_COLOR) !== 0) {
    return false;
  }
  view.setUint32(GEOMETRY_FLAGS_OFFSET, flags | RP_GEOMETRY_MODULATE_MATERIAL_COLOR, true);

  return true;
}

/**
 * Whether a geometry chunk BODY (its children stream: Struct / MaterialList / Extension) carries at
 * least one window-pane material — the render-order pass moves such atomics last, mirroring vanilla's
 * windscreen_ok-last layout (the cutscene path draws clump atomics in file order with z-write on, so an
 * early pane erases everything drawn behind it).
 */
export function geometryBodyHasWindowPane(body: Uint8Array): boolean {
  const materialList = readRw(body).chunks.find((chunk) => chunk.type === RW_MATERIAL_LIST);
  for (const { material, struct } of listMaterialStructs(materialList)) {
    if (isWindowPane(material, struct)) {
      return true;
    }
  }

  return false;
}

/**
 * The model's first carcols combo as four RGBs. `car` rows carry two colours; slots 3/4 fall back to
 * palette 0 (black) — the game zero-initialises the extra colours the same way. Returns null when the
 * model has no row at all.
 */
export function paintColoursFor(carcols: VehicleColours, model: string): null | PaintColours {
  const name = model.toLowerCase();
  const four = carcols.cars4.get(name)?.[0];
  const two = carcols.cars.get(name)?.[0];
  const combo = four ?? (two ? [two[0], two[1], 0, 0] : null);
  if (!combo) {
    return null;
  }
  const rgb = (index: number): Rgb => carcols.palette[index] ?? [0, 0, 0];

  return [rgb(combo[0]), rgb(combo[1]), rgb(combo[2]), rgb(combo[3])];
}

function bakeGeometry(geometry: RwChunk, colours: null | PaintColours): number {
  const materialList = geometry.children?.find((chunk) => chunk.type === RW_MATERIAL_LIST);
  if (!materialList?.data) {
    return 0;
  }
  let baked = 0;
  for (const material of readRw(materialList.data).chunks) {
    if (material.type !== RW_MATERIAL || !material.data) {
      continue;
    }
    const struct = readRw(material.data).chunks.find((chunk) => chunk.type === RW_STRUCT);
    if (!struct?.data || struct.data.length < 8) {
      continue;
    }
    const key = `${struct.data[4]},${struct.data[5]},${struct.data[6]}`;
    // In-place: `struct.data` is a view into the copied buffer; the alpha byte survives.
    if (LAMP_MARKERS.has(key)) {
      [struct.data[4], struct.data[5], struct.data[6]] = [255, 255, 255];
      baked += 1;
      continue;
    }
    const slot = PAINT_MARKERS.get(key);
    if (slot === undefined) {
      continue;
    }
    if (!colours) {
      throw new Error('model carries carcols paint markers but has no carcols row');
    }
    [struct.data[4], struct.data[5], struct.data[6]] = colours[slot];
    baked += 1;
  }

  return baked;
}

function isLampAtlas(material: RwChunk): boolean {
  return textureName(material)?.toLowerCase().startsWith('vehiclelights') ?? false;
}

/** The shared window-pane classifier (see {@link WINDOW_ALPHA_CEILING}'s doc for the derivation). */
function isWindowPane(material: RwChunk, struct: RwChunk): boolean {
  const alpha = struct.data![7];
  if (alpha === 0 || alpha >= WINDOW_ALPHA_CEILING || isLampAtlas(material)) {
    return false;
  }

  return luminance(struct.data!) < 128 || alpha <= 128;
}

function* listMaterialStructs(materialList: RwChunk | undefined): Generator<{ material: RwChunk; struct: RwChunk }> {
  if (!materialList?.data) {
    return;
  }
  for (const material of readRw(materialList.data).chunks) {
    if (material.type !== RW_MATERIAL || !material.data) {
      continue;
    }
    const struct = readRw(material.data).chunks.find((chunk) => chunk.type === RW_STRUCT);
    if (struct?.data && struct.data.length >= 8) {
      yield { material, struct };
    }
  }
}

/** Rec.601 luminance of the material Struct colour at `data[4..6]`. */
function luminance(data: Uint8Array): number {
  return 0.299 * data[4] + 0.587 * data[5] + 0.114 * data[6];
}

/** The material's diffuse texture name, or null when untextured. */
function textureName(material: RwChunk): null | string {
  if (!material.data) {
    return null;
  }
  const texture = readRw(material.data).chunks.find((chunk) => chunk.type === RW_TEXTURE);
  if (!texture?.data) {
    return null;
  }
  const name = readRw(texture.data).chunks.find((chunk) => chunk.type === RW_STRING);
  if (!name?.data) {
    return null;
  }
  const end = name.data.indexOf(0);

  return new TextDecoder('ascii').decode(name.data.subarray(0, end < 0 ? name.data.length : end));
}
