/**
 * Synthetic district fixture (plan 074/04): a grid of `.oscell` cells + one RGBA8 `.ostex` array, generated
 * in-memory so the WHOLE engine path (formats → upload → bundles → culling → A2C) runs before `opensa-pack`
 * exists. Layer 3 is a cutout hole pattern — the on-screen A2C sanity check.
 */
import {
  encodeOscell,
  encodeOstex,
  fnv1a,
  type Oscell,
  OSCELL_VERTEX_STRIDE,
  OstexAlphaClass,
  OstexFormat,
  ostexLayerBytes,
  ostexMaxMips,
  ostexMipLayout,
} from '@opensa/engine-formats';

export const SYNTHETIC_LAYERS = 4;
const TEX_SIZE = 64;

/** One synthetic cell at grid (cx, cy): merged box-field groups (3 opaque layers + 1 cutout "foliage"). */
export function syntheticCell(cx: number, cy: number, cellSize: number, boxesPerSide: number): Uint8Array {
  const groups: Oscell['groups'] = [];
  const vertices: number[] = [];
  const indices: number[] = [];
  let vertexCount = 0;

  const addBox = (x: number, y: number, z: number, size: number, layer: number): void => {
    // 4 side quads + top (bottom skipped) — enough geometry load, CCW winding outward.
    const s = size / 2;
    const corners = [
      [x - s, y, z - s],
      [x + s, y, z - s],
      [x + s, y, z + s],
      [x - s, y, z + s],
    ];
    const top = y + size;
    const quads: number[][][] = [
      [corners[0], corners[1], [corners[1][0], top, corners[1][2]], [corners[0][0], top, corners[0][2]]],
      [corners[1], corners[2], [corners[2][0], top, corners[2][2]], [corners[1][0], top, corners[1][2]]],
      [corners[2], corners[3], [corners[3][0], top, corners[3][2]], [corners[2][0], top, corners[2][2]]],
      [corners[3], corners[0], [corners[0][0], top, corners[0][2]], [corners[3][0], top, corners[3][2]]],
      [
        [x - s, top, z - s],
        [x + s, top, z - s],
        [x + s, top, z + s],
        [x - s, top, z + s],
      ],
    ];
    for (const quad of quads) {
      const base = vertexCount;
      for (let corner = 0; corner < 4; corner += 1) {
        const [px, py, pz] = quad[corner];
        const u = corner === 1 || corner === 2 ? 2 : 0; // tiles ×2 — exercises repeat wrap
        const v = corner >= 2 ? 2 : 0;
        const shade = 200 + ((corner * 13) % 55);
        vertices.push(px, py, pz, 0, u, v, shade, layer);
        vertexCount += 1;
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  };

  const originX = cx * cellSize;
  const originZ = cy * cellSize;
  const step = cellSize / boxesPerSide;
  for (let layer = 0; layer < SYNTHETIC_LAYERS; layer += 1) {
    const groupIndexStart = indices.length;
    for (let bx = 0; bx < boxesPerSide; bx += 1) {
      for (let bz = 0; bz < boxesPerSide; bz += 1) {
        if ((bx + bz) % SYNTHETIC_LAYERS !== layer) {
          continue;
        }
        const height = step * (0.5 + ((bx * 7 + bz * 13) % 10) / 4);
        addBox(bx * step + step / 2, 0, bz * step + step / 2, Math.min(step * 0.8, height), layer);
      }
    }
    groups.push({
      bounds: [cellSize / 2, cellSize / 4, cellSize / 2, cellSize],
      indexCount: indices.length - groupIndexStart,
      indexOffset: groupIndexStart,
      pipelineClass: layer === 3 ? 1 : 0,
      side: layer === 3 ? 1 : 0, // cutout "foliage" double-sided, like the real world
      textureArrayRef: 0,
    });
  }

  // Pack the scratch rows (px py pz _ u v shade layer) into the real interleaved layout.
  const vertexData = new Uint8Array(vertexCount * OSCELL_VERTEX_STRIDE);
  const view = new DataView(vertexData.buffer);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const row = vertex * 8;
    const at = vertex * OSCELL_VERTEX_STRIDE;
    view.setFloat32(at, vertices[row], true);
    view.setFloat32(at + 4, vertices[row + 1], true);
    view.setFloat32(at + 8, vertices[row + 2], true);
    view.setUint32(at + 12, 0x0000_7f00, true); // normal snorm8x4 ≈ +Y (unused in M0 WGSL)
    view.setFloat32(at + 16, vertices[row + 4], true);
    view.setFloat32(at + 20, vertices[row + 5], true);
    const shade = vertices[row + 6];
    view.setUint8(at + 24, shade);
    view.setUint8(at + 25, shade);
    view.setUint8(at + 26, shade);
    view.setUint8(at + 27, 255);
    view.setUint32(at + 28, 0, true); // nightPrelit + sway (absent channels)
    view.setUint16(at + 32, vertices[row + 7], true); // layer
    view.setUint16(at + 34, 0, true); // packed ao/emissive (absent)
  }
  const indexData = new Uint8Array(new Uint32Array(indices).buffer);

  return encodeOscell({
    bounds: [cellSize / 2, cellSize / 4, cellSize / 2, cellSize * 0.75],
    breakables: [],
    channelMask: 0,
    groups,
    index16: false,
    indexCount: indices.length,
    indexData,
    lights: [],
    names: [],
    objects: [],
    origin: [originX, 0, originZ],
    particles: [],
    placements: [],
    roadsignQuads: 0,
    vertexCount,
    vertexData,
  });
}

/** RGBA8 array: 3 tinted checkerboards + 1 cutout holes layer. Premultiplied by construction. */
export function syntheticTextureArray(): Uint8Array {
  const format = OstexFormat.RGBA8;
  const mipCount = ostexMaxMips(format, TEX_SIZE, TEX_SIZE);
  const layerBytes = ostexLayerBytes(format, TEX_SIZE, TEX_SIZE, mipCount);
  const payload = new Uint8Array(layerBytes * SYNTHETIC_LAYERS);
  const tints = [
    [220, 180, 140],
    [140, 200, 140],
    [150, 160, 220],
    [90, 160, 70], // "foliage" cutout layer
  ];
  let offset = 0;
  for (let layer = 0; layer < SYNTHETIC_LAYERS; layer += 1) {
    for (let level = 0; level < mipCount; level += 1) {
      const layout = ostexMipLayout(format, TEX_SIZE, TEX_SIZE, level);
      for (let y = 0; y < layout.mipHeight; y += 1) {
        for (let x = 0; x < layout.mipWidth; x += 1) {
          const at = offset + y * layout.bytesPerRow + x * 4;
          writeTexel(payload, at, tints[layer], layer === 3, x, y, layout.mipWidth, layout.mipHeight);
        }
      }
      offset += layout.totalBytes;
    }
  }

  return encodeOstex({
    format,
    height: TEX_SIZE,
    layers: [
      { alphaClass: OstexAlphaClass.OPAQUE, cutoutRef: 0, nameHash: fnv1a('syn0'), wrap: 0 },
      { alphaClass: OstexAlphaClass.OPAQUE, cutoutRef: 0, nameHash: fnv1a('syn1'), wrap: 0 },
      { alphaClass: OstexAlphaClass.OPAQUE, cutoutRef: 0, nameHash: fnv1a('syn2'), wrap: 0 },
      { alphaClass: OstexAlphaClass.CUTOUT, cutoutRef: 128, nameHash: fnv1a('syn3'), wrap: 0 },
    ],
    mipCount,
    payload,
    premultiplied: true,
    width: TEX_SIZE,
  });
}

/** One premultiplied texel: tinted checkerboard; the cutout layer punches round holes (alpha 0). */
function writeTexel(
  payload: Uint8Array,
  at: number,
  tint: readonly number[],
  cutout: boolean,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const checker = ((x >> 2) + (y >> 2)) % 2 === 0 ? 1 : 0.7;
  const cx = (x / Math.max(1, width - 1)) * 2 - 1;
  const cy = (y / Math.max(1, height - 1)) * 2 - 1;
  const inHole = cutout && Math.hypot(cx % 0.5, cy % 0.5) % 0.5 < 0.18;
  const alpha = cutout && inHole ? 0 : 255;
  const premult = alpha / 255;
  payload[at] = tint[0] * checker * premult;
  payload[at + 1] = tint[1] * checker * premult;
  payload[at + 2] = tint[2] * checker * premult;
  payload[at + 3] = alpha;
}
