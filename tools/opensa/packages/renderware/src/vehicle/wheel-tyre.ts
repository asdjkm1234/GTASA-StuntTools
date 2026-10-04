/**
 * Which materials of a WHEEL are the tyre (plan 084).
 *
 * Rubber does not reflect, and SA says so where it can: its own wheels carry an env map with a coefficient
 * of 0, the "not reflective" marker. Mods do not — their exporter stamps the reflection plugin on every
 * material it writes — so a modded car drove around with glinting tyres while its rim, which SHOULD carry a
 * reflection, was indistinguishable to us. The rim keeps its own reflection; only the tyre is silenced.
 *
 * The signal is GEOMETRY, never a texture name (`tire`, `tyre`, `tread`, `wheel`, `generic_tire_01`,
 * `vehicletyres128` — the field set already disagrees with itself). A wheel is a disc about its axle, and
 * the tyre is the outer BAND of it: measured across stock and mod cars, tyre materials sit at a mean radius
 * of 0.87-0.98 of the wheel's own maximum while every rim material sits at 0.18-0.70. Nothing lands between.
 *
 * A car may simply have no tyre — one material over the whole wheel, a tank track, a model with no wheel
 * atomic at all — and then this returns an empty set and nothing is silenced.
 */
import type { RWGeometry } from '../parsers/binary/types';

/** Mean radius (as a share of the wheel's own max) at or above which a material is the tyre. Measured band:
 *  rims reach 0.70, tyres start at 0.87. */
const TYRE_MEAN_RADIUS = 0.8;

/** ...and it must actually reach the rim of the disc, which a hub cap with a long spoke does not. */
const TYRE_OUTER_RADIUS = 0.9;

/**
 * Material indices of `geometry` that form the tyre. Wheel-local space, axle along X — a wheel's radius is
 * therefore its extent in YZ, which is what the whole test measures. `wheelRadius` is the reference radius
 * when the geometry is one mesh of a multi-mesh wheel; by default the geometry's own maximum.
 */
export function tyreMaterials(geometry: RWGeometry | undefined, wheelRadius?: number): ReadonlySet<number> {
  const tyres = new Set<number>();
  if (!geometry) {
    return tyres;
  }
  const positions = geometry.positions;
  const radius = (vertex: number): number => Math.hypot(positions[vertex * 3 + 1], positions[vertex * 3 + 2]);
  // A multi-mesh wheel passes the WHOLE wheel's radius: a hub cap measured against its own extent is a disc
  // whose outer ring would pass for rubber.
  let maxRadius = wheelRadius ?? 0;
  for (let vertex = 0; wheelRadius === undefined && vertex < positions.length / 3; vertex += 1) {
    maxRadius = Math.max(maxRadius, radius(vertex));
  }
  if (maxRadius <= 0) {
    return tyres;
  }

  const sums = new Float64Array(geometry.materials.length);
  const counts = new Uint32Array(geometry.materials.length);
  const outer = new Float64Array(geometry.materials.length);
  const seen = new Set<string>();
  for (const triangle of geometry.triangles) {
    for (const vertex of [triangle.a, triangle.b, triangle.c]) {
      const key = `${triangle.materialIndex}:${vertex}`;
      if (seen.has(key)) {
        continue; // a vertex shared by two triangles of one material must not weigh twice
      }
      seen.add(key);
      const share = radius(vertex) / maxRadius;
      sums[triangle.materialIndex] += share;
      counts[triangle.materialIndex] += 1;
      outer[triangle.materialIndex] = Math.max(outer[triangle.materialIndex], share);
    }
  }

  for (let material = 0; material < counts.length; material += 1) {
    if (counts[material] === 0) {
      continue;
    }
    if (sums[material] / counts[material] >= TYRE_MEAN_RADIUS && outer[material] >= TYRE_OUTER_RADIUS) {
      tyres.add(material);
    }
  }

  return tyres;
}
