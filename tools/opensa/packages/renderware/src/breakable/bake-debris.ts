/**
 * The renderer-agnostic half of prop debris (plan 045, ported to the own engine as 074/08 B7·a step 4).
 *
 * A break turns the prop's RW Breakable shatter mesh into a cloud of per-triangle shards. Neither renderer
 * simulates them: every shard gets a velocity, a spin and a precomputed landing time, and the whole flight is
 * an analytic function of age evaluated in the VERTEX shader — a break costs nothing per frame. That baking is
 * pure arithmetic and belongs here, shared, so the two renderers cannot drift apart (they already did once,
 * over a heat-haze rule in the FX baker).
 *
 * Geometry is baked in WORLD space at break time (GTA Z-up), so gravity is a literal −Z and the mesh sits at
 * identity.
 */
import type { RWBreakable } from '../parsers/binary/types';

/** Seconds a break lives before it despawns (the fade occupies the tail). */
export const DEBRIS_LIFETIME = 5;
export const DEBRIS_FADE = 1.4;
/** The shards' gravity — the shaders integrate this same constant analytically. */
export const DEBRIS_GRAVITY = 9.81;

/** Flat, de-indexed shard soup — upload verbatim. Per-VERTEX (all three of a shard share its flight). */
export interface BakedDebris {
  /** Shard spin axis × speed (rad/s). */
  angular: Float32Array;
  /** Shard centroid in world space — the pivot it spins about and the point that flies the arc. */
  center: Float32Array;
  /** RGBA 0..1, the shatter mesh's own colours × the material ambient. */
  color: Float32Array;
  groups: DebrisGroup[];
  /** Age (s) at which the shard's centroid reaches `groundZ`; never, when no ground was probed. */
  landTime: Float32Array;
  position: Float32Array;
  uv: Float32Array;
  velocity: Float32Array;
  vertexCount: number;
}

/** One draw's worth of shards: the triangles sharing a texture (a bin authors 7 identical materials). */
export interface DebrisGroup {
  /** Vertices, not triangles — the mesh is de-indexed. */
  count: number;
  start: number;
  /** Shard texture name in the model's TXD; '' when the material has none. */
  texture: string;
}

export interface DebrisImpact {
  /**
   * Ground height (GTA Z) the shards rest on. Omit and they never land — they fall through the floor and sink
   * while fading, which is what the three path shipped and what this port is meant to FIX: pass a probed
   * ground height and the shards freeze where they hit it.
   */
  groundZ?: number;
  /** Impact velocity seed (world Z-up, m/s) — shards inherit a share and fly away from the hit. */
  impact?: [number, number, number];
  /** RNG seed: the same prop shatters identically every session (a streamed-out prop returns intact). */
  seed?: number;
}

/**
 * Bake one break. `transform` is the prop's world matrix as a flat COLUMN-major mat4 (three's `elements`
 * order), which is what both renderers already hold.
 */
export function bakeDebris(
  breakable: RWBreakable,
  transform: readonly number[],
  options: DebrisImpact = {},
): BakedDebris {
  const triangleCount = breakable.triangleMaterials.length;
  const random = mulberry32(options.seed ?? transformSeed(transform));
  const impact = options.impact ?? [0, 0, 0];

  // Group the draws by shard texture, so a bin's seven identical materials collapse into one.
  const textures: string[] = [];
  const slotOf = new Map<string, number>();
  const byTexture: number[][] = [];
  for (let tri = 0; tri < triangleCount; tri += 1) {
    const texture = breakable.materials[breakable.triangleMaterials[tri]]?.texture ?? '';
    let slot = slotOf.get(texture);
    if (slot === undefined) {
      slot = textures.length;
      textures.push(texture);
      slotOf.set(texture, slot);
      byTexture.push([]);
    }
    byTexture[slot].push(tri);
  }

  const vertexCount = triangleCount * 3;
  const baked: BakedDebris = {
    angular: new Float32Array(vertexCount * 3),
    center: new Float32Array(vertexCount * 3),
    color: new Float32Array(vertexCount * 4),
    groups: [],
    landTime: new Float32Array(vertexCount),
    position: new Float32Array(vertexCount * 3),
    uv: new Float32Array(vertexCount * 2),
    velocity: new Float32Array(vertexCount * 3),
    vertexCount,
  };

  const corner = new Float32Array(9); // three world-space corners
  let cursor = 0;
  for (let slot = 0; slot < byTexture.length; slot += 1) {
    const start = cursor * 3;
    for (const tri of byTexture[slot]) {
      const ambient = breakable.materials[breakable.triangleMaterials[tri]]?.ambient ?? [1, 1, 1];
      for (let i = 0; i < 3; i += 1) {
        const vertex = breakable.triangles[tri * 3 + i];
        applyMat4(corner, i * 3, breakable.positions, vertex * 3, transform);
      }
      const cx = (corner[0] + corner[3] + corner[6]) / 3;
      const cy = (corner[1] + corner[4] + corner[7]) / 3;
      const cz = (corner[2] + corner[5] + corner[8]) / 3;

      // Fling: a share of the impact velocity + a random horizontal scatter + an upward pop.
      const azimuth = random() * Math.PI * 2;
      const scatter = 1 + random() * 2.5;
      const vx = impact[0] * 0.6 + Math.cos(azimuth) * scatter;
      const vy = impact[1] * 0.6 + Math.sin(azimuth) * scatter;
      const vz = impact[2] * 0.3 + 2 + random() * 3;
      // Spin: a uniform-on-the-sphere axis at 3–12 rad/s.
      const axisZ = random() * 2 - 1;
      const axisAzimuth = random() * Math.PI * 2;
      const planar = Math.sqrt(Math.max(0, 1 - axisZ * axisZ));
      const spinSpeed = 3 + random() * 9;
      // When the centroid's ballistic arc reaches the ground — solved once, not stepped.
      const landTime =
        options.groundZ === undefined
          ? DEBRIS_LIFETIME + 1
          : (vz + Math.sqrt(vz * vz + 2 * DEBRIS_GRAVITY * Math.max(0, cz - options.groundZ))) / DEBRIS_GRAVITY;

      for (let i = 0; i < 3; i += 1) {
        const at = cursor + i;
        const vertex = breakable.triangles[tri * 3 + i];
        baked.position.set([corner[i * 3], corner[i * 3 + 1], corner[i * 3 + 2]], at * 3);
        baked.color[at * 4] = (breakable.colours[vertex * 4] / 255) * ambient[0];
        baked.color[at * 4 + 1] = (breakable.colours[vertex * 4 + 1] / 255) * ambient[1];
        baked.color[at * 4 + 2] = (breakable.colours[vertex * 4 + 2] / 255) * ambient[2];
        baked.color[at * 4 + 3] = breakable.colours[vertex * 4 + 3] / 255;
        baked.uv.set([breakable.uvs[vertex * 2], breakable.uvs[vertex * 2 + 1]], at * 2);
        baked.center.set([cx, cy, cz], at * 3);
        baked.velocity.set([vx, vy, vz], at * 3);
        baked.angular.set(
          [Math.cos(axisAzimuth) * planar * spinSpeed, Math.sin(axisAzimuth) * planar * spinSpeed, axisZ * spinSpeed],
          at * 3,
        );
        baked.landTime[at] = landTime;
      }
      cursor += 3;
    }
    baked.groups.push({ count: cursor * 3 - start, start, texture: textures[slot] });
  }

  return baked;
}

/** `out[outAt..]` = mat4 (column-major) x `source[at..]` as a point. */
function applyMat4(out: Float32Array, outAt: number, source: Float32Array, at: number, m: readonly number[]): void {
  const [x, y, z] = [source[at], source[at + 1], source[at + 2]];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
  out[outAt] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
  out[outAt + 1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
  out[outAt + 2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
}

/** Deterministic RNG so a prop shatters the same way every time it is rebuilt. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed from the placement, so the seed is stable without the caller having to invent one. */
function transformSeed(m: readonly number[]): number {
  return (Math.round(m[12] * 100) ^ (Math.round(m[13] * 100) << 8) ^ (Math.round(m[14] * 100) << 16)) >>> 0;
}
