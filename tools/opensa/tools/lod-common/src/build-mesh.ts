import type { RWClump, RWGeometry } from '@opensa/renderware/parsers/binary/types';

import type { MergedMesh, Vec3 } from './mesh';

const IDENTITY_BASIS = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const ZERO: Vec3 = [0, 0, 0];

/**
 * How a source geometry's vertices map into the merged mesh's target space. Kept abstract so each caller supplies
 * its own maths **exactly** (no lossy conversion): opensa-lod-generator rotates by the conjugated IPL quaternion +
 * offsets to the cell centre; sa-procobj-placement applies the DFF frame matrix (model-local).
 */
export interface VertexTransform {
  /** Rotate a normal into target space (rotation only, no translation). */
  normal(x: number, y: number, z: number): Vec3;
  /** Map a position into target space (rotation + translation). */
  point(x: number, y: number, z: number): Vec3;
}

/**
 * Accumulate transformed source geometry into one {@link MergedMesh} — the shared "real HD → LOD geometry" core
 * used by every merged-copy LOD tool (opensa cell merge, lod-procobj per-model). Triangles bucket by texture name;
 * missing prelit → opaque white; normals ride along (rotated) or zero for a downstream normals pass; the **night**
 * set is carried per vertex (source night, else day prelit, else white) and only emitted when some source geometry
 * actually had one — so day-at-night fallback still applies where none did.
 */
export class MeshBuilder {
  private readonly colors: number[] = [];
  private readonly groups = new Map<string, { color?: readonly [number, number, number, number]; indices: number[] }>();
  private hasNight = false;
  private readonly nightColors: number[] = [];
  private readonly normals: number[] = [];
  private readonly positions: number[] = [];
  private readonly uvs: number[] = [];

  /** Append one geometry, its vertices mapped by `transform`; `textureName` maps each raw material texture
   *  name into the bucket key (scoped per-TXD names — lod-common plan 004; identity when omitted). */
  add(geometry: RWGeometry, transform: VertexTransform, textureName?: (raw: string) => string): void {
    const base = this.positions.length / 3;
    const count = geometry.positions.length / 3;
    const uv = geometry.uvLayers[0] ?? null;
    const prelit = geometry.prelitColors;
    const night = geometry.nightColors;
    const norm = geometry.normals;
    if (night) {
      this.hasNight = true;
    }
    for (let i = 0; i < count; i += 1) {
      const [px, py, pz] = transform.point(
        geometry.positions[i * 3],
        geometry.positions[i * 3 + 1],
        geometry.positions[i * 3 + 2],
      );
      this.positions.push(px, py, pz);
      if (norm) {
        const [nx, ny, nz] = transform.normal(norm[i * 3], norm[i * 3 + 1], norm[i * 3 + 2]);
        this.normals.push(nx, ny, nz);
      } else {
        this.normals.push(0, 0, 0);
      }
      this.uvs.push(uv ? uv[i * 2] : 0, uv ? uv[i * 2 + 1] : 0);
      this.pushRgba(this.colors, prelit, i, [255, 255, 255, 255]);
      // Night per vertex: the source night set when present, else this geometry's day prelit (SA's own day-at-night
      // fallback), else white — so a cell/model mixing night/no-night parts keeps each part's correct dark value.
      this.pushRgba(this.nightColors, night ?? prelit, i, [255, 255, 255, 255]);
    }
    for (const tri of geometry.triangles) {
      const material = geometry.materials[tri.materialIndex];
      // The texture's name with its CASE INTACT. What we write here is what the LOD's materials will ask the
      // dictionary for, and the real game matches those names exactly — stock SA never once spells a texture
      // differently in a DFF than in the TXD it lives in. Lowercasing here (and in the clone dictionaries)
      // matched only by accident, and only for the models that took this re-encode path (2026-08-16).
      // `registerScopedName` lowercases what it resolves by, so the scoped path is unaffected.
      const raw = material?.texture?.name ?? '';
      const texture = raw.length > 0 && textureName ? textureName(raw) : raw;
      this.group(texture, material?.color).push(base + tri.a, base + tri.b, base + tri.c);
    }
  }

  finish(): MergedMesh {
    return {
      colors: Uint8Array.from(this.colors),
      groups: [...this.groups.entries()].map(([key, group]) => ({
        indices: Uint32Array.from(group.indices),
        texture: key.split('|')[0],
        ...(group.color ? { color: group.color } : {}),
      })),
      normals: Float32Array.from(this.normals),
      positions: Float32Array.from(this.positions),
      uvs: Float32Array.from(this.uvs),
      ...(this.hasNight ? { nightColors: Uint8Array.from(this.nightColors) } : {}),
    };
  }

  /** Triangles bucket by texture + material tint (white tints collapse to the plain texture bucket). */
  private group(texture: string, color?: readonly [number, number, number, number]): number[] {
    const tinted =
      color !== undefined && (color[0] !== 255 || color[1] !== 255 || color[2] !== 255 || color[3] !== 255)
        ? color
        : undefined;
    const key = tinted ? `${texture}|${tinted.join(',')}` : texture;
    let group = this.groups.get(key);
    if (!group) {
      group = tinted ? { color: tinted, indices: [] } : { indices: [] };
      this.groups.set(key, group);
    }

    return group.indices;
  }

  private pushRgba(
    out: number[],
    src: null | Uint8Array,
    i: number,
    fallback: readonly [number, number, number, number],
  ): void {
    if (src) {
      out.push(src[i * 4], src[i * 4 + 1], src[i * 4 + 2], src[i * 4 + 3]);
    } else {
      out.push(fallback[0], fallback[1], fallback[2], fallback[3]);
    }
  }
}

/**
 * Build a **model-local** {@link MergedMesh} from a whole clump — each atomic placed by its DFF **frame** transform
 * (right/up/at basis + translation), so multi-atomic / frame-offset models assemble correctly. The verbatim
 * per-model LOD geometry; the instance's world placement is applied later by the IPL `inst`. Shared by
 * sa-procobj-placement (its LODs) and sa-lod-generator (the future mesh path of a per-object clone).
 */
export function buildClumpMesh(clump: RWClump): MergedMesh {
  const builder = new MeshBuilder();
  for (const atomic of clump.atomics) {
    const geometry = clump.geometries[atomic.geometryIndex];
    if (!geometry) {
      continue;
    }
    const frame = clump.frames[atomic.frameIndex];
    builder.add(geometry, frameTransform(frame?.rotation ?? IDENTITY_BASIS, frame?.position ?? ZERO));
  }

  return builder.finish();
}

/** Per-geometry frame transforms of a clump (identity where a geometry has no atomic/frame) — the same placement
 *  rule {@link buildClumpMesh} uses, exported so 2dfx entry positions can ride the same maths (plan 003, Phase 5). */
export function clumpFrameTransforms(clump: RWClump): VertexTransform[] {
  const identity = frameTransform(IDENTITY_BASIS, ZERO);
  const transforms = clump.geometries.map(() => identity);
  for (const atomic of clump.atomics) {
    const frame = clump.frames[atomic.frameIndex];
    if (frame && transforms[atomic.geometryIndex]) {
      transforms[atomic.geometryIndex] = frameTransform(frame.rotation, frame.position);
    }
  }

  return transforms;
}

/** The vertex map for one atomic's frame: a 3×3 rotation basis (right/up/at flatten) + translation. */
function frameTransform(r: readonly number[], t: Vec3): VertexTransform {
  return {
    normal: (x, y, z): Vec3 => [
      r[0] * x + r[3] * y + r[6] * z,
      r[1] * x + r[4] * y + r[7] * z,
      r[2] * x + r[5] * y + r[8] * z,
    ],
    point: (x, y, z): Vec3 => [
      r[0] * x + r[3] * y + r[6] * z + t[0],
      r[1] * x + r[4] * y + r[7] * z + t[1],
      r[2] * x + r[5] * y + r[8] * z + t[2],
    ],
  };
}
