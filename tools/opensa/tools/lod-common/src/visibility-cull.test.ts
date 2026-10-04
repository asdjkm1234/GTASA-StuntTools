import { describe, expect, it } from 'vitest';

import type { MergedGroup, MergedMesh } from './mesh';
import type { SourceTexture, TextureSource } from './texture-source';

import { lodView } from './view';
import { createVisibilityCull } from './visibility-cull';

/** An axis-aligned box (12 tris, outward winding) appended at `base`; returns its indices. */
function box(
  cx: number,
  cy: number,
  cz: number,
  half: number,
  base: number,
): { indices: number[]; positions: number[] } {
  const positions: number[] = [];
  for (const dz of [-1, 1]) {
    for (const dy of [-1, 1]) {
      for (const dx of [-1, 1]) {
        positions.push(cx + dx * half, cy + dy * half, cz + dz * half);
      }
    }
  }
  // Corner order: bit0=x, bit1=y, bit2=z. Quads wound outward.
  const quads = [
    [0, 2, 3, 1], // bottom (z-)
    [4, 5, 7, 6], // top (z+)
    [0, 1, 5, 4], // y-
    [2, 6, 7, 3], // y+
    [0, 4, 6, 2], // x-
    [1, 3, 7, 5], // x+
  ];
  const indices: number[] = [];
  for (const [a, b, c, d] of quads) {
    indices.push(base + a, base + b, base + c, base + a, base + c, base + d);
  }

  return { indices, positions };
}

/** Build a mesh from explicit positions + per-texture faces (white colours, zero normals/uvs). */
function mesh(positions: number[], groups: { indices: number[]; texture: string }[]): MergedMesh {
  const vertexCount = positions.length / 3;

  return {
    colors: new Uint8Array(vertexCount * 4).fill(255),
    groups: groups.map((group) => ({ indices: Uint32Array.from(group.indices), texture: group.texture })),
    normals: new Float32Array(vertexCount * 3),
    positions: Float32Array.from(positions),
    uvs: new Float32Array(vertexCount * 2),
  };
}

const cull = createVisibilityCull({ dilate: false });
const VIEW = lodView(300);
const ctx = { view: VIEW };

/** The winding normal Z sign of the g-th group's first face. */
function faceNormalZ(out: MergedMesh, group: MergedGroup): number {
  const p = out.positions;
  const [a, b, c] = [group.indices[0] * 3, group.indices[1] * 3, group.indices[2] * 3];

  return (p[b] - p[a]) * (p[c + 1] - p[a + 1]) - (p[b + 1] - p[a + 1]) * (p[c] - p[a]);
}

const faceCount = (out: MergedMesh): number => out.groups.reduce((sum, g) => sum + g.indices.length / 3, 0);

describe('createVisibilityCull', () => {
  describe('negative cases', () => {
    it('returns the mesh unchanged without a view in the context', () => {
      const input = mesh([0, 0, 0, 1, 0, 0, 0, 1, 0], [{ indices: [0, 1, 2], texture: 'a' }]);

      expect(cull(input, {})).toBe(input);
    });

    it('returns an empty mesh unchanged', () => {
      const input = mesh([], []);

      expect(cull(input, ctx)).toBe(input);
    });
  });

  describe('positive cases', () => {
    it('drops a cube fully buried inside a closed box (self-occlusion) and the box bottom (no camera below)', () => {
      const outer = box(0, 0, 0, 10, 0);
      const inner = box(0, 0, 0, 1, 8);
      const input = mesh(
        [...outer.positions, ...inner.positions],
        [
          { indices: outer.indices, texture: 'box' },
          { indices: inner.indices, texture: 'cube' },
        ],
      );
      const out = cull(input, ctx);

      // Buried cube gone entirely; box keeps top + 4 sides (10 tris), bottom's outer side faces only downward
      // where no camera ever is — culled like a building foundation.
      expect(out.groups.map((group) => group.texture)).toEqual(['box']);
      expect(faceCount(out)).toBe(10);
      // Every kept face was seen from exactly one side → no doubling.
      expect(out.groups[0].twoSided && [...out.groups[0].twoSided].every((flag) => flag === 0)).toBe(true);
    });

    it('keeps a down-wound lone plate two-sided with its winding intact (back-only is never flipped)', () => {
      // Wound so the normal points DOWN (-z); only the upper (back) side is reachable by cameras. A flip would
      // be correct here, but flipping is banned — a wrong "back visible" verdict elsewhere would punch a hole.
      const input = mesh([0, 0, 0, 0, 4, 0, 4, 0, 0], [{ indices: [0, 1, 2], texture: 'plate' }]);
      const out = cull(input, ctx);

      expect(faceCount(out)).toBe(1);
      expect(faceNormalZ(out, out.groups[0])).toBeLessThan(0); // winding untouched
      expect([...(out.groups[0].twoSided ?? [])]).toEqual([1]); // rendered from both sides instead
    });

    it('keeps a bridge-deck face two-sided when cameras exist above and below it', () => {
      // Big ground sheet at z=0 (sets the camera ground level) + a deck at z=50: low ring cameras see its
      // underside, the top-down camera sees its top → genuinely two-sided.
      const input = mesh(
        [-40, -40, 0, 40, -40, 0, -40, 40, 0, 0, 0, 50, 8, 0, 50, 0, 8, 50],
        [
          { indices: [0, 1, 2], texture: 'ground' },
          { indices: [3, 4, 5], texture: 'deck' },
        ],
      );
      const out = cull(input, ctx);
      const deck = out.groups.find((group) => group.texture === 'deck');
      const ground = out.groups.find((group) => group.texture === 'ground');

      expect([...(deck?.twoSided ?? [])]).toEqual([1]); // seen from both sides → doubled at encode
      expect([...(ground?.twoSided ?? [])]).toEqual([0]); // ground: upper side only
    });

    it('dilation keeps an invisible face touching a visible one (marked two-sided)', () => {
      // A visible tri shares an edge with a tri buried inside a covering box. Without dilation the buried one is
      // dropped; with the default dilate: true it survives as a one-ring safety margin.
      const cover = box(2, -2, 20, 3, 6);
      const buildInput = (): MergedMesh =>
        mesh(
          [
            // visible tri out in the open (centroid pokes past the cover's y extent)
            0,
            0,
            20,
            4,
            0,
            20,
            0,
            4,
            20,
            // hidden tri sharing the (0,0,20)-(4,0,20) edge, fully inside the covering box
            0,
            0,
            20,
            4,
            0,
            20,
            2,
            -2,
            20,
            ...cover.positions,
          ],
          [
            { indices: [0, 1, 2], texture: 'open' },
            { indices: [3, 4, 5], texture: 'hidden' },
            { indices: cover.indices, texture: 'cover' },
          ],
        );

      const strict = cull(buildInput(), ctx);
      const dilated = createVisibilityCull()(buildInput(), ctx);

      expect(strict.groups.some((group) => group.texture === 'hidden')).toBe(false);
      expect(dilated.groups.some((group) => group.texture === 'hidden')).toBe(true);
    });

    it('orient mode never drops — a buried cube survives two-sided', () => {
      const outer = box(0, 0, 0, 10, 0);
      const inner = box(0, 0, 0, 1, 8);
      const input = mesh(
        [...outer.positions, ...inner.positions],
        [
          { indices: outer.indices, texture: 'box' },
          { indices: inner.indices, texture: 'cube' },
        ],
      );
      const out = createVisibilityCull({ dilate: false, mode: 'orient' })(input, ctx);
      const cube = out.groups.find((group) => group.texture === 'cube');

      expect(faceCount(out)).toBe(24); // nothing dropped (12 box + 12 cube faces)
      expect(cube?.twoSided && [...cube.twoSided].every((flag) => flag === 1)).toBe(true); // unknown → both sides
    });

    it('a see-through fence does not occlude the wall behind it (the LA-river sawtooth)', () => {
      // A wall plate fully enclosed by a chain-link fence box (25%-opaque texture). Old behaviour treated the
      // fence quads as solid occluders → every ray from the wall died inside the box → the wall was culled as
      // "invisible" (the sawtooth holes). Coverage-aware occluders see the wall THROUGH the fence → it stays.
      const fenceTexture = (): SourceTexture => {
        const rgba = new Uint8Array(16 * 4).fill(255);
        for (let i = 3; i < rgba.length; i += 4) {
          rgba[i] = i < 16 ? 255 : 0; // 4 of 16 texels opaque → coverage 0.25 < 0.5
        }

        return { hasAlpha: true, height: 4, rgba, width: 4 };
      };
      const textures: TextureSource = {
        get: (name) => (name === 'fence' ? fenceTexture() : null), // wall texture missing → counts opaque
      };
      const fence = box(0, 0, 0, 30, 3);
      const buildInput = (): MergedMesh =>
        mesh(
          [-20, 0, 0, 20, 0, 0, 0, 0, 20, ...fence.positions],
          [
            { indices: [0, 1, 2], texture: 'wall' },
            { indices: fence.indices, texture: 'fence' },
          ],
        );

      // Old behaviour (everything occludes, minOccluderCoverage 0): the wall dies inside the fence box.
      const buggy = createVisibilityCull({ dilate: false, minOccluderCoverage: 0 })(buildInput(), {
        textures,
        view: VIEW,
      });
      expect(buggy.groups.some((group) => group.texture === 'wall')).toBe(false);

      // Coverage-aware occluders: the fence stops blocking → the wall survives.
      const fixed = createVisibilityCull({ dilate: false })(buildInput(), { textures, view: VIEW });
      expect(fixed.groups.some((group) => group.texture === 'wall')).toBe(true);
    });
  });
});
