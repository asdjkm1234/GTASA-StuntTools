/**
 * Sanity-gate for AUTHORED vertex normals (map-optimizer plans 020 + 024): decide, per vertex, whether a
 * stored normal can be trusted — so the optimizer preserves authored intent and recomputes only actual
 * garbage. Pure geometry, no curated lists. A normal fails when:
 *
 * - it is not unit-ish (zeroed blocks from dirty re-exports, NaN/Inf) — `badUnit`;
 * - it disagrees with the winding of its incident faces (points INTO the surface) — `badWinding`;
 * - it faces the GROUND markedly more than its most sky-facing incident face — `badShading` (plan 024,
 *   field-derived: `max(nzFace) − nzVertex > shadeDz`, GTA z = up). This is the roads17 class the first
 *   two checks cannot see: a mirror-side normal written onto a shared top-face vertex is winding-consistent
 *   (its own side agrees) and its two-sided evidence cancels to zero — but the visible face renders it as a
 *   dark wedge. The test is ASYMMETRIC on purpose: a normal rotated toward the sky only ever brightens (the
 *   `standard01_lawn` grass-card trick, field-validated), so only ground-rotated normals fail.
 *
 * Vertices whose incident faces cancel to ~zero (SA's two-sided coplanar pairs) or that have no faces at
 * all carry no WINDING evidence — they count as unverifiable for that check and the authored value is kept
 * unless the shading check fails it.
 */

const UNIT_MIN_SQ = 0.9 * 0.9;
const UNIT_MAX_SQ = 1.1 * 1.1;
/** |area-weighted face-normal sum|² below this = the faces cancel — no winding evidence. */
const EVIDENCE_MIN_SQ = 1e-8;
/** Faces with |cross|² under this are slivers — their orientation is noise, not shading evidence. */
const FACE_MIN_SQ = 1e-12;
/** Default `shadeDz`: a normal more than ~60° darker-facing than its face reads as dirt (plan 024). */
const DEFAULT_SHADE_DZ = 0.5;

export interface ValidateNormalsOptions {
  /** `badShading` threshold on `max(nzFace) − nzVertex` (see module doc). `Infinity` disables the check. */
  shadeDz?: number;
}

export interface ValidateNormalsResult {
  /** Vertex indices whose stored normal failed a check (unit, winding or shading). */
  failing: number[];
  stats: {
    /** Vertices whose normal faces the ground markedly more than their faces do (plan 024). */
    badShading: number;
    /** Vertices with a broken length (zero / NaN / far from unit). */
    badUnit: number;
    /** Vertices whose normal points against their incident faces' winding. */
    badWinding: number;
    /** Vertices with no usable face evidence (no faces, or two-sided cancellation) — kept as authored. */
    unverifiable: number;
    vertexCount: number;
  };
}

/** Validate stored per-vertex normals against the mesh geometry. `indices` is flat triangle triples. */
export function validateNormals(
  positions: Float32Array,
  indices: ArrayLike<number>,
  normals: Float32Array,
  options: ValidateNormalsOptions = {},
): ValidateNormalsResult {
  const shadeDz = options.shadeDz ?? DEFAULT_SHADE_DZ;
  const vertexCount = Math.min(positions.length, normals.length) / 3;
  const { evidence, hasFace, maxFaceNz } = accumulateFaceEvidence(positions, indices, vertexCount);

  const failing: number[] = [];
  let badShading = 0;
  let badUnit = 0;
  let badWinding = 0;
  let unverifiable = 0;
  for (let v = 0; v < vertexCount; v += 1) {
    const x = normals[v * 3];
    const y = normals[v * 3 + 1];
    const z = normals[v * 3 + 2];
    const lengthSq = x * x + y * y + z * z;
    if (!Number.isFinite(lengthSq) || lengthSq < UNIT_MIN_SQ || lengthSq > UNIT_MAX_SQ) {
      badUnit += 1;
      failing.push(v);
      continue;
    }
    const ex = evidence[v * 3];
    const ey = evidence[v * 3 + 1];
    const ez = evidence[v * 3 + 2];
    const hasWindingEvidence = hasFace[v] === 1 && ex * ex + ey * ey + ez * ez >= EVIDENCE_MIN_SQ;
    if (hasWindingEvidence && x * ex + y * ey + z * ez < 0) {
      badWinding += 1;
      failing.push(v);
      continue;
    }
    // Shading (plan 024): independent of winding evidence — that is the whole point (the roads17 mirror-side
    // class has CANCELLED winding evidence, and a sideways normal on a top face has an orthogonal dot).
    if (hasFace[v] === 1 && maxFaceNz[v] > -2 && maxFaceNz[v] - z / Math.sqrt(lengthSq) > shadeDz) {
      badShading += 1;
      failing.push(v);
      continue;
    }
    if (!hasWindingEvidence) {
      unverifiable += 1; // no geometric evidence — trust the author
    }
  }

  return { failing, stats: { badShading, badUnit, badWinding, unverifiable, vertexCount } };
}

/** Area-weighted face-normal sums + the most sky-facing incident face's nz, per vertex. */
function accumulateFaceEvidence(
  positions: Float32Array,
  indices: ArrayLike<number>,
  vertexCount: number,
): { evidence: Float64Array; hasFace: Uint8Array; maxFaceNz: Float64Array } {
  // Raw indices on purpose — an authored split vertex is judged by its own side.
  const evidence = new Float64Array(vertexCount * 3);
  const hasFace = new Uint8Array(vertexCount);
  const maxFaceNz = new Float64Array(vertexCount).fill(-2);
  const triangleCount = Math.floor(indices.length / 3);
  for (let f = 0; f < triangleCount; f += 1) {
    const a = indices[f * 3];
    const b = indices[f * 3 + 1];
    const c = indices[f * 3 + 2];
    const abx = positions[b * 3] - positions[a * 3];
    const aby = positions[b * 3 + 1] - positions[a * 3 + 1];
    const abz = positions[b * 3 + 2] - positions[a * 3 + 2];
    const acx = positions[c * 3] - positions[a * 3];
    const acy = positions[c * 3 + 1] - positions[a * 3 + 1];
    const acz = positions[c * 3 + 2] - positions[a * 3 + 2];
    // Cross product magnitude = 2×area — using it unnormalized IS the area weighting.
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const crossSq = nx * nx + ny * ny + nz * nz;
    const faceNz = crossSq > FACE_MIN_SQ ? nz / Math.sqrt(crossSq) : -2;
    for (const v of [a, b, c]) {
      if (v < vertexCount) {
        evidence[v * 3] += nx;
        evidence[v * 3 + 1] += ny;
        evidence[v * 3 + 2] += nz;
        hasFace[v] = 1;
        if (faceNz > maxFaceNz[v]) {
          maxFaceNz[v] = faceNz;
        }
      }
    }
  }

  return { evidence, hasFace, maxFaceNz };
}
