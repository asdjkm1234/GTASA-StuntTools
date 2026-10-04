import { describe, expect, it } from 'vitest';

import type { MergedMesh } from './mesh';
import type { SourceTexture, TextureSource } from './texture-source';

import { createDropTransparentGroups } from './drop-transparent-groups';

/** One triangle (own 3 verts) per texture name. */
function mesh(textures: string[]): MergedMesh {
  const vertexCount = textures.length * 3;

  return {
    colors: new Uint8Array(vertexCount * 4).fill(255),
    groups: textures.map((texture, i) => ({ indices: Uint32Array.of(i * 3, i * 3 + 1, i * 3 + 2), texture })),
    normals: new Float32Array(vertexCount * 3),
    positions: Float32Array.from({ length: vertexCount * 3 }, (_, i) => i),
    uvs: new Float32Array(vertexCount * 2),
  };
}

/** A 2×2 texture whose texels have the given alphas (RGB white). */
function texture(alphas: [number, number, number, number], hasAlpha = true): SourceTexture {
  const rgba = new Uint8Array(16).fill(255);
  alphas.forEach((alpha, i) => {
    rgba[i * 4 + 3] = alpha;
  });

  return { hasAlpha, height: 2, rgba, width: 2 };
}

function textureSource(byName: Record<string, SourceTexture>): TextureSource {
  return { get: (name) => byName[name] ?? null };
}

// 1/4 of texels opaque = coverage 0.25.
const MOSTLY_CLEAR = texture([255, 0, 0, 0]);
const drop = createDropTransparentGroups(0.5);

describe('createDropTransparentGroups', () => {
  describe('negative cases', () => {
    it('keeps everything when the context has no texture source', () => {
      const input = mesh(['fence']);

      expect(drop(input, {})).toBe(input);
    });

    it('keeps a group whose texture is missing from the source', () => {
      const input = mesh(['unknown']);

      expect(drop(input, { textures: textureSource({}) })).toBe(input);
    });

    it('keeps untextured groups and textures without an alpha channel', () => {
      const input = mesh(['', 'solid']);
      const textures = textureSource({ solid: texture([0, 0, 0, 0], false) });

      expect(drop(input, { textures })).toBe(input);
    });
  });

  describe('positive cases', () => {
    it('drops a group whose texture is mostly transparent and compacts its vertices', () => {
      const input = mesh(['wall', 'fence']);
      const textures = textureSource({ fence: MOSTLY_CLEAR, wall: texture([255, 255, 255, 255]) });
      const out = drop(input, { textures });

      expect(out.groups.map((group) => group.texture)).toEqual(['wall']);
      expect(out.positions).toHaveLength(9);
    });

    it('keeps a group at exactly the coverage threshold', () => {
      const input = mesh(['half']);
      const textures = textureSource({ half: texture([255, 255, 0, 0]) }); // coverage 0.5 == threshold

      expect(drop(input, { textures })).toBe(input);
    });
  });
});
