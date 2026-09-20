import type { TextureSource } from './texture-source';

import { createOpaqueCoverage } from './opaque-coverage';

/**
 * Memoized per-texture "distant appearance" stats for the preview renderer: mean RGB (what a texture melts into
 * at LOD range) + opaque coverage (drives the screendoor dither). Shared by the Phase-4 harness and the budgeted
 * decimation's self-check. Missing/untextured → neutral grey, fully opaque.
 */
export interface TextureStats {
  readonly color: (texture: string) => readonly [number, number, number];
  readonly coverage: (texture: string) => number;
}

export function createTextureStats(textures: TextureSource | undefined): TextureStats {
  const coverage = createOpaqueCoverage(textures);
  const colors = new Map<string, readonly [number, number, number]>();

  return {
    color: (texture: string): readonly [number, number, number] => {
      let color = colors.get(texture);
      if (!color) {
        const decoded = texture === '' ? null : textures?.get(texture);
        if (!decoded || decoded.rgba.length === 0) {
          color = [200, 200, 200];
        } else {
          let [r, g, b] = [0, 0, 0];
          const { rgba } = decoded;
          for (let i = 0; i < rgba.length; i += 4) {
            r += rgba[i];
            g += rgba[i + 1];
            b += rgba[i + 2];
          }
          const texels = rgba.length / 4;
          color = [r / texels, g / texels, b / texels];
        }
        colors.set(texture, color);
      }

      return color;
    },
    coverage,
  };
}
