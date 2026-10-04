import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { readRw, type RwChunk, writeRw } from '@opensa/rw-codec/chunk';
import { collectGeometries } from '@opensa/rw-codec/dff';

/** What the copy did — the CLI prints it, because a run that changes nothing has to say so. */
export interface CopyEffectsResult {
  bytes: Uint8Array;
  /** Materials whose reference value came from a SHARED TEXTURE NAME rather than the median. */
  byTexture: number;
  /** Env-map coefficients written. */
  coefficients: number;
  /** True when the target had no env-map-marked material and every reflection-plugin one was retuned instead. */
  fellBack: boolean;
  /** Reflection intensities written. */
  intensities: number;
  /** Materials seen in the target. */
  materials: number;
  /** Materials touched at all. */
  patched: number;
  /** The prototype's representative (median) value, used wherever no texture name matched. */
  reference: ReflectionValue;
  /** Specular levels written. */
  speculars: number;
}

/**
 * Transfer **only the reflection strength** — the MatFX env-map `coefficient` and the SA reflection plugin's
 * `intensity` — from a well-tuned reference (prototype) vehicle onto a target whose reflection is overdone
 * (plan 003). Nothing else changes: textures, colour, geometry, even *which* materials reflect are left
 * alone — we only retune the numbers on the target's **existing** reflective materials, so the worst case is
 * a part a touch too shiny/matte.
 *
 * **Three terms, three markings — and the one a field report usually means is the SPECULAR** (measured
 * 2026-08-18 on the reported car): its `level` (`0x253f2f6`) sat at 0.26-0.56 where a tasteful donor carries
 * 0.05, and the install's SkyGfx vehicle pipe multiplies it by 3 while multiplying the reflection intensity by
 * 8 — so an intensity retune from 0.5 to 0.16 is saturated at both ends and invisible, and the highlight is
 * what the eye was reading all along (`docs/gta-sa-original/skygfx-fork-vehicle-pipe.md`). The specular level is
 * therefore retuned wherever it is non-zero, on its own marking, while the reflection intensity stays on the
 * env-map-marked set because that is the only place the pipe reads it.
 *
 * **WHICH materials are the reflective ones is the env-map's answer, not the reflection plugin's** (measured
 * 2026-08-18, after a field report). An exporter attaches the MatFX env-map only to the materials meant to
 * mirror the world — body panels, glass, chrome — while the SA reflection plugin sits on nearly EVERY material
 * (yankee 116 of 116, walton 180 of 180). So the env-map-marked set is the author's own marking of "this
 * reflects", and it is the set to retune; widening the retune to every plugin-carrying material spreads the
 * reference's body value onto tyres, dirt and interior and reads as a uniformly matte car.
 *
 * A tree with NO env-map at all falls back to its reflection-carrying materials, so a car built that way is
 * still serviceable instead of refused.
 *
 * A value of **0 is "not reflective" and stays 0** on both sides: it is neither retuned on the target nor
 * counted into the reference median, so the copy can never make a matte part shiny (stock admiral carries 19
 * env-map chunks at zero — they used to be written to).
 *
 * The prototype is read with the engine `parseDff` (read-only) — so it works even for anti-rip-locked
 * references like `walton.dff`. The target is read+patched with map-optimizer's byte codec (a standard DFF
 * being fixed), writing the new floats straight into its env-map / reflection plugin chunks.
 *
 * **Matching cascade** (per target reflective material): by shared base **texture name**, else the
 * prototype's **representative** value (median across its reflective materials) — so it works across
 * different vehicles with different material counts, never throwing on a mismatch.
 */
export function copyMaterialEffects(
  targetBytes: Uint8Array,
  prototypeBytes: Uint8Array | undefined,
  override: { coefficient?: number; reflection?: number; specular?: number } = {},
): CopyEffectsResult {
  const reference = referenceFrom(prototypeBytes, override);
  if (!reference) {
    throw new Error(
      'nothing to copy: the prototype DFF has no reflective materials (no env-map coefficient and no reflection ' +
        'intensity above 0) and no --coefficient/--reflection was given — pick a reference whose reflection is ' +
        'the look you want, or state the level outright',
    );
  }

  const file = readRw(targetBytes);
  const lists = materialLists(file);
  const targetMaterials = lists.flatMap(({ chunks }) => chunks.filter((chunk) => chunk.type === MATERIAL));
  const summary = {
    byTexture: 0,
    coefficients: 0,
    fellBack: false,
    intensities: 0,
    materials: 0,
    patched: 0,
    speculars: 0,
  };
  summary.materials = targetMaterials.length;
  // Two markings, two terms: the env-map marks which surfaces MIRROR the world, the specular chunk marks which
  // ones take a highlight — and a car carries far more of the second. A material joins the run if it has either.
  const marked = targetMaterials.filter((material) => {
    const values = reflectiveValues(material);

    return values.coefficient !== null || values.specular !== null;
  });
  summary.fellBack = marked.length === 0;
  for (const material of summary.fellBack ? targetMaterials : marked) {
    patchReflection(material, reference, summary);
  }
  if (summary.patched === 0) {
    throw new Error(
      "the target DFF has no reflective materials to retune — it doesn't parse as a standard SA vehicle DFF, " +
        'or every one of its materials has a zero env-map coefficient and a zero reflection intensity',
    );
  }

  for (const { chunks, leaf } of lists) {
    leaf.data = writeChunks(chunks);
  }

  return { bytes: writeRw(file), reference: reference.representative, ...summary };
}

const MATERIAL_LIST = 0x08;
const MATERIAL = 0x07;
const TEXTURE = 0x06;
const STRING = 0x02;
const EXTENSION = 0x03;
const MATERIAL_CONTAINERS = new Set([EXTENSION, MATERIAL, TEXTURE]);
/** MatFX env-map (0x120): effectType, slotType, then `coefficient` f32 at offset 8. */
const ENVMAP = 0x120;
const ENVMAP_COEFFICIENT_OFFSET = 8;
/** SA reflection (0x253f2fc): scale.xy, offset.xy, then `intensity` f32 at offset 16. */
const REFLECTION = 0x253f2fc;
const REFLECTION_INTENSITY_OFFSET = 16;
/** SA specular (0x253f2f6): `level` f32 at offset 0, then char[24] texture name. */
const SPECULAR = 0x253f2f6;
const SPECULAR_LEVEL_OFFSET = 0;
const HEADER_BYTES = 12;

/** A re-parsed chunk inside a Material List (container ⇒ `children`, leaf ⇒ `data`). */
interface MatChunk {
  children?: MatChunk[];
  data?: Uint8Array;
  type: number;
  version: number;
}
/** Running counts {@link patchReflection} fills in. */
interface PatchSummary {
  byTexture: number;
  coefficients: number;
  fellBack: boolean;
  intensities: number;
  materials: number;
  patched: number;
  speculars: number;
}

/** The reflection values to apply, plus a per-texture lookup for name matching. */
interface ReflectionProfiles {
  byTexture: ReadonlyMap<string, ReflectionValue>;
  representative: ReflectionValue;
}

interface ReflectionValue {
  coefficient: null | number;
  intensity: null | number;
  specular: null | number;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

/** Each geometry's Material List leaf + its re-parsed chunk tree (edit in place, then re-serialize the leaf). */
function materialLists(file: ReturnType<typeof readRw>): { chunks: MatChunk[]; leaf: RwChunk }[] {
  const lists: { chunks: MatChunk[]; leaf: RwChunk }[] = [];
  for (const geometry of collectGeometries(file.chunks)) {
    const leaf = geometry.children?.find((child) => child.type === MATERIAL_LIST && child.data);
    if (leaf?.data) {
      lists.push({ chunks: parseChunks(leaf.data), leaf });
    }
  }

  return lists;
}

/** The base texture name on a parsed Material chunk (Texture → first String), lowercased; '' if untextured. */
function materialTexture(material: MatChunk): string {
  const texture = material.children?.find((child) => child.type === TEXTURE);
  const name = texture?.children?.find((child) => child.type === STRING)?.data;

  return name ? readCString(name) : '';
}

/** The median of a non-empty list (lower-middle for an even count) — a robust "typical" reflection value. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function parseChunks(bytes: Uint8Array): MatChunk[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: MatChunk[] = [];
  let pos = 0;
  while (pos + HEADER_BYTES <= bytes.length) {
    const type = view.getUint32(pos, true);
    const size = view.getUint32(pos + 4, true);
    const version = view.getUint32(pos + 8, true);
    const bodyStart = pos + HEADER_BYTES;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > bytes.length) {
      break;
    }
    const body = bytes.subarray(bodyStart, bodyEnd);
    chunks.push(
      MATERIAL_CONTAINERS.has(type) ? { children: parseChunks(body), type, version } : { data: body, type, version },
    );
    pos = bodyEnd;
  }

  return chunks;
}

/**
 * Retune one target material's reflection strength in place. A material counts as reflective when it carries a
 * NON-ZERO env-map coefficient or a non-zero reflection intensity — either chunk on its own is enough, and a
 * zero is left as the author wrote it. The reference value comes from a shared texture name when there is one,
 * else from the prototype's median, and each of the two floats is written only where both sides have it.
 */
function patchReflection(material: MatChunk, reference: ReflectionProfiles, summary: PatchSummary): void {
  const { coefficient, envView, intensity, reflView, specular, specView } = reflectiveValues(material);
  // A zero is the author saying "this part does not reflect" — retuning it would ADD reflection.
  const hasEnv = coefficient !== null;
  const hasRefl = intensity !== null;
  const hasSpec = specular !== null;
  if (!hasEnv && !hasRefl && !hasSpec) {
    return;
  }

  const texture = materialTexture(material);
  const matched = reference.byTexture.get(texture);
  const value = matched ?? reference.representative;
  let wrote = false;
  if (hasEnv && envView !== undefined && value.coefficient !== null) {
    envView.setFloat32(ENVMAP_COEFFICIENT_OFFSET, value.coefficient, true);
    summary.coefficients += 1;
    wrote = true;
  }
  // The reflection intensity is only read where the env-map marks the surface as reflective (the pipe gates on
  // it), so writing it elsewhere would edit bytes nothing consults.
  if (hasEnv && hasRefl && reflView !== undefined && value.intensity !== null) {
    reflView.setFloat32(REFLECTION_INTENSITY_OFFSET, value.intensity, true);
    summary.intensities += 1;
    wrote = true;
  }
  // The specular HIGHLIGHT is its own term and its own marking: the pipe multiplies it by 3 and it sits on
  // nearly every material, so it is retuned wherever it is non-zero rather than only on env-map-marked ones.
  if (hasSpec && specView !== undefined && value.specular !== null) {
    specView.setFloat32(SPECULAR_LEVEL_OFFSET, value.specular, true);
    summary.speculars += 1;
    wrote = true;
  }
  if (wrote) {
    summary.patched += 1;
    summary.byTexture += matched === undefined ? 0 : 1;
  }
}

/** Read a null-terminated, lowercased string from raw chunk bytes. */
function readCString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);

  return new TextDecoder().decode(bytes.subarray(0, end === -1 ? bytes.length : end)).toLowerCase();
}

/**
 * Read the prototype's reflective materials via the engine parser (handles anti-rip-locked references):
 * per material with an env-map, its `coefficient` (+ optional reflection `intensity`), keyed by base texture
 * name, plus a representative (median) value for materials with no name match. Null when none are reflective.
 */
function readReflectionProfiles(bytes: Uint8Array): null | ReflectionProfiles {
  const clump = parseDff(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const byTexture = new Map<string, ReflectionValue>();
  const coefficients: number[] = [];
  const intensities: number[] = [];
  const speculars: number[] = [];
  const materials = clump.geometries.flatMap((geometry) => geometry.materials);
  // The specular level has its own population: it sits on nearly every material, so taking it from the
  // env-map-marked few would report the paint's highlight as if it were the whole car's.
  for (const material of materials) {
    const level = material.effects?.specular?.level ?? 0;
    if (level !== 0) {
      speculars.push(level);
    }
  }
  // The env-map-marked materials ARE the reference's reflective surface; only a tree with none of them falls
  // back to whatever carries the reflection plugin.
  const marked = materials.filter((material) => (material.effects?.envMap?.coefficient ?? 0) !== 0);
  for (const material of marked.length > 0 ? marked : materials) {
    const value = referenceValue(material);
    if (value === null) {
      continue;
    }
    if (value.coefficient !== null) {
      coefficients.push(value.coefficient);
    }
    if (value.intensity !== null) {
      intensities.push(value.intensity);
    }
    const texture = material.texture?.name?.toLowerCase();
    if (texture && !byTexture.has(texture)) {
      byTexture.set(texture, value);
    }
  }
  if (coefficients.length === 0 && intensities.length === 0 && speculars.length === 0) {
    return null;
  }

  return {
    byTexture,
    representative: {
      coefficient: coefficients.length > 0 ? median(coefficients) : null,
      intensity: intensities.length > 0 ? median(intensities) : null,
      specular: speculars.length > 0 ? median(speculars) : null,
    },
  };
}

/**
 * The values to apply: the prototype's profiles with any EXPLICIT override written over both the per-texture
 * entries and the representative, or an override-only reference when no prototype was given. An explicit
 * number is what a modder reaches for when no donor carries the level they want — and unlike a median it says
 * exactly what will land in the file.
 */
function referenceFrom(
  prototypeBytes: Uint8Array | undefined,
  override: { coefficient?: number; reflection?: number; specular?: number },
): null | ReflectionProfiles {
  const forced: ReflectionValue = {
    coefficient: override.coefficient ?? null,
    intensity: override.reflection ?? null,
    specular: override.specular ?? null,
  };
  const nothingForced = forced.coefficient === null && forced.intensity === null && forced.specular === null;
  const profiles = prototypeBytes === undefined ? null : readReflectionProfiles(prototypeBytes);
  if (profiles === null) {
    return nothingForced ? null : { byTexture: new Map(), representative: forced };
  }
  if (nothingForced) {
    return profiles;
  }
  const merge = (value: ReflectionValue): ReflectionValue => ({
    coefficient: forced.coefficient ?? value.coefficient,
    intensity: forced.intensity ?? value.intensity,
    specular: forced.specular ?? value.specular,
  });

  return {
    byTexture: new Map([...profiles.byTexture].map(([texture, value]) => [texture, merge(value)])),
    representative: merge(profiles.representative),
  };
}

/**
 * What one prototype material contributes to the reference, or null when it does not reflect at all. Zero on
 * either channel means "not reflective": it must not enter the median, or one matte part would drag the whole
 * target's shine down.
 */
function referenceValue(material: {
  effects?: { envMap?: { coefficient: number }; reflection?: { intensity: number }; specular?: { level: number } };
}): null | ReflectionValue {
  const coefficient = material.effects?.envMap?.coefficient ?? 0;
  const intensity = material.effects?.reflection?.intensity ?? 0;
  const specular = material.effects?.specular?.level ?? 0;
  if (coefficient === 0 && intensity === 0 && specular === 0) {
    return null;
  }

  return {
    coefficient: coefficient === 0 ? null : coefficient,
    intensity: intensity === 0 ? null : intensity,
    specular: specular === 0 ? null : specular,
  };
}

/**
 * One target material's live reflective state: the two plugin views plus their CURRENT values, `null` where the
 * chunk is absent or its value is zero (which is the author saying "this part does not reflect").
 */
function reflectiveValues(material: MatChunk): {
  coefficient: null | number;
  envView: DataView | undefined;
  intensity: null | number;
  reflView: DataView | undefined;
  specular: null | number;
  specView: DataView | undefined;
} {
  const extension = material.children?.find((child) => child.type === EXTENSION);
  const view = (type: number): DataView | undefined => {
    const data = extension?.children?.find((child) => child.type === type)?.data;

    return data ? new DataView(data.buffer, data.byteOffset, data.byteLength) : undefined;
  };
  const envView = view(ENVMAP);
  const reflView = view(REFLECTION);
  const specView = view(SPECULAR);
  const coefficient = envView?.getFloat32(ENVMAP_COEFFICIENT_OFFSET, true) ?? 0;
  const intensity = reflView?.getFloat32(REFLECTION_INTENSITY_OFFSET, true) ?? 0;
  const specular = specView?.getFloat32(SPECULAR_LEVEL_OFFSET, true) ?? 0;

  return {
    coefficient: coefficient === 0 ? null : coefficient,
    envView,
    intensity: intensity === 0 ? null : intensity,
    reflView,
    specular: specular === 0 ? null : specular,
    specView,
  };
}

function writeChunks(chunks: readonly MatChunk[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const chunk of chunks) {
    const body = chunk.children ? writeChunks(chunk.children) : (chunk.data ?? new Uint8Array(0));
    const header = new Uint8Array(HEADER_BYTES);
    const view = new DataView(header.buffer);
    view.setUint32(0, chunk.type, true);
    view.setUint32(4, body.length, true);
    view.setUint32(8, chunk.version, true);
    parts.push(header, body);
  }

  return concat(parts);
}
