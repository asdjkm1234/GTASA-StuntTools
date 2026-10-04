import type { MergedMesh, Vec3 } from './mesh';

/**
 * Deterministic CPU raster preview of a {@link MergedMesh} (plan 003, Phase 4) — the measurement harness's eye.
 * No GL, no browser: a z-buffered software rasterizer with per-vertex prelit × per-group mean texture colour,
 * ordered-dither "screendoor" for mostly-transparent groups (approximates how alpha mush reads at LOD range),
 * and optional back-face culling — `'none'` renders like vanilla SA draws the HD world (two-sided), `'back'`
 * renders like the engine draws the LOD (FrontSide cull), so diffing the two measures exactly what the
 * simplification chain changed. Perspective look-at camera in native Z-up world space.
 */
export interface PreviewCamera {
  fovYDeg: number;
  position: Vec3;
  target: Vec3;
}

export interface PreviewImage {
  height: number;
  /** Row-major RGBA (alpha 255 where geometry covered the pixel, else 0). */
  rgba: Uint8Array;
  width: number;
}

export interface PreviewOptions {
  /** `'back'` culls clockwise screen triangles (engine LOD view); `'none'` draws both sides (vanilla HD view). */
  cull: 'back' | 'none';
  /** Mean RGB (0..255) per texture, modulated by vertex prelit; absent → white. */
  groupColor?: (texture: string) => readonly [number, number, number];
  /** Opaque coverage per texture (0..1) for the screendoor dither; absent/1 → solid. */
  groupCoverage?: (texture: string) => number;
  height: number;
  width: number;
}

/** 4×4 Bayer matrix (values 0..15) for the deterministic screendoor dither. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

const NEAR = 0.5;

/** Fraction of pixels that disagree (colour beyond `colorTolerance`, or covered in one image only), measured
 *  over the pixels either image covers. Identical images → 0; images with no coverage at all → 0. */
export function previewDiff(a: PreviewImage, b: PreviewImage, colorTolerance = 24): number {
  let considered = 0;
  let differing = 0;
  for (let i = 0; i < a.rgba.length; i += 4) {
    const coveredA = a.rgba[i + 3] !== 0;
    const coveredB = b.rgba[i + 3] !== 0;
    if (!coveredA && !coveredB) {
      continue;
    }
    considered += 1;
    if (coveredA !== coveredB) {
      differing += 1;
      continue;
    }
    const delta =
      Math.abs(a.rgba[i] - b.rgba[i]) +
      Math.abs(a.rgba[i + 1] - b.rgba[i + 1]) +
      Math.abs(a.rgba[i + 2] - b.rgba[i + 2]);
    if (delta > colorTolerance) {
      differing += 1;
    }
  }

  return considered === 0 ? 0 : differing / considered;
}

export function renderMeshPreview(mesh: MergedMesh, camera: PreviewCamera, options: PreviewOptions): PreviewImage {
  const { height, width } = options;
  const rgba = new Uint8Array(width * height * 4);
  const depth = new Float32Array(width * height).fill(Infinity);
  const view = lookAt(camera.position, camera.target);
  const scale = height / 2 / Math.tan(((camera.fovYDeg / 2) * Math.PI) / 180);

  const p = mesh.positions;
  const vertexCount = p.length / 3;
  // Project every vertex once: view space (x right, y up, z forward-positive) → screen + 1/z.
  const sx = new Float32Array(vertexCount);
  const sy = new Float32Array(vertexCount);
  const sz = new Float32Array(vertexCount);
  for (let v = 0; v < vertexCount; v += 1) {
    const [vx, vy, vz] = view(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]);
    sz[v] = vz;
    if (vz > NEAR) {
      sx[v] = width / 2 + (vx / vz) * scale;
      sy[v] = height / 2 - (vy / vz) * scale;
    }
  }

  for (const group of mesh.groups) {
    let [mr, mg, mb] = options.groupColor?.(group.texture) ?? [255, 255, 255];
    if (group.color) {
      // Material tint modulates the texture (as the game renders it) — keep the harness honest for tinted groups.
      mr = (mr * group.color[0]) / 255;
      mg = (mg * group.color[1]) / 255;
      mb = (mb * group.color[2]) / 255;
    }
    const coverage = options.groupCoverage?.(group.texture) ?? 1;
    const ditherCap = Math.round(coverage * 16);
    if (ditherCap === 0) {
      continue;
    }
    for (let i = 0; i < group.indices.length; i += 3) {
      const [a, b, c] = [group.indices[i], group.indices[i + 1], group.indices[i + 2]];
      if (sz[a] <= NEAR || sz[b] <= NEAR || sz[c] <= NEAR) {
        continue; // behind the near plane — cameras sit hundreds of units out, this is the rare edge
      }
      const area = (sx[b] - sx[a]) * (sy[c] - sy[a]) - (sy[b] - sy[a]) * (sx[c] - sx[a]);
      // Screen-space CCW source winding (right-handed view, y flipped) → area < 0 faces the camera.
      if (area === 0 || (options.cull === 'back' && area > 0)) {
        continue;
      }
      rasterTriangle(
        { a, area, b, c, sx, sy, sz },
        { colors: mesh.colors, mb, mg, mr },
        { depth, ditherCap, height, rgba, width },
      );
    }
  }

  return { height, rgba, width };
}

/** Look-at view transform (world Z-up): returns view-space [right, up, forward-distance] coordinates. */
function lookAt(position: Vec3, target: Vec3): (x: number, y: number, z: number) => [number, number, number] {
  let fx = target[0] - position[0];
  let fy = target[1] - position[1];
  let fz = target[2] - position[2];
  const fl = Math.hypot(fx, fy, fz);
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // right = forward × up(0,0,1); degenerate straight-down view falls back to up(0,1,0).
  let rx = fy;
  let ry = -fx;
  const rz = 0;
  const rl = Math.hypot(rx, ry, rz);
  if (rl < 1e-6) {
    rx = 1;
    ry = 0;
  } else {
    rx /= rl;
    ry /= rl;
  }
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;

  return (x, y, z) => {
    const dx = x - position[0];
    const dy = y - position[1];
    const dz = z - position[2];

    return [dx * rx + dy * ry + dz * rz, dx * ux + dy * uy + dz * uz, dx * fx + dy * fy + dz * fz];
  };
}

/** Z-buffered scanline fill of one screen triangle with interpolated prelit × group colour + dither. */
function rasterTriangle(
  tri: { a: number; area: number; b: number; c: number; sx: Float32Array; sy: Float32Array; sz: Float32Array },
  paint: { colors: Uint8Array; mb: number; mg: number; mr: number },
  target: { depth: Float32Array; ditherCap: number; height: number; rgba: Uint8Array; width: number },
): void {
  const { a, area, b, c, sx, sy, sz } = tri;
  const minX = Math.max(0, Math.floor(Math.min(sx[a], sx[b], sx[c])));
  const maxX = Math.min(target.width - 1, Math.ceil(Math.max(sx[a], sx[b], sx[c])));
  const minY = Math.max(0, Math.floor(Math.min(sy[a], sy[b], sy[c])));
  const maxY = Math.min(target.height - 1, Math.ceil(Math.max(sy[a], sy[b], sy[c])));
  const inv = 1 / area;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      // Barycentric via edge functions (signs match the triangle's area sign through the shared inverse).
      const wa = ((sx[b] - px) * (sy[c] - py) - (sy[b] - py) * (sx[c] - px)) * inv;
      const wb = ((sx[c] - px) * (sy[a] - py) - (sy[c] - py) * (sx[a] - px)) * inv;
      const wc = 1 - wa - wb;
      if (wa < 0 || wb < 0 || wc < 0) {
        continue;
      }
      if (target.ditherCap < 16 && BAYER[(y % 4) * 4 + (x % 4)] >= target.ditherCap) {
        continue;
      }
      const z = wa * sz[a] + wb * sz[b] + wc * sz[c];
      const at = y * target.width + x;
      if (z >= target.depth[at]) {
        continue;
      }
      target.depth[at] = z;
      const shade = (channel: number): number =>
        (wa * paint.colors[a * 4 + channel] + wb * paint.colors[b * 4 + channel] + wc * paint.colors[c * 4 + channel]) /
        255;
      target.rgba[at * 4] = Math.min(255, Math.round(shade(0) * paint.mr));
      target.rgba[at * 4 + 1] = Math.min(255, Math.round(shade(1) * paint.mg));
      target.rgba[at * 4 + 2] = Math.min(255, Math.round(shade(2) * paint.mb));
      target.rgba[at * 4 + 3] = 255;
    }
  }
}
