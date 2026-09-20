import type { TextureSource } from './texture-source';

/** A texel counts as opaque above this alpha — matches SA's punch-through alpha-test threshold feel. */
const OPAQUE_ALPHA = 128;

/**
 * Memoized per-texture opaque coverage (fraction of texels with alpha ≥ 128). Shared by the transparent-group
 * cull (drop groups below a threshold) and the visibility cull (groups below a threshold must not act as ray
 * occluders — you can see through a chain-link fence). Conservative fallbacks: untextured (`''`), missing, or
 * alpha-less textures all count as fully opaque (1).
 */
export function createOpaqueCoverage(textures: TextureSource | undefined): (texture: string) => number {
  const cache = new Map<string, number>();

  return (texture: string): number => {
    if (!textures || texture === '') {
      return 1;
    }
    let coverage = cache.get(texture);
    if (coverage === undefined) {
      const decoded = textures.get(texture);
      if (!decoded || !decoded.hasAlpha || decoded.rgba.length === 0) {
        coverage = 1;
      } else {
        let opaque = 0;
        const { rgba } = decoded;
        for (let i = 3; i < rgba.length; i += 4) {
          if (rgba[i] >= OPAQUE_ALPHA) {
            opaque += 1;
          }
        }
        coverage = opaque / (rgba.length / 4);
      }
      cache.set(texture, coverage);
    }

    return coverage;
  };
}
