/**
 * A MODEL's texture dictionary → `.ostex` (plan opensa-pack/003 phase 2).
 *
 * No new format was needed: `.ostex` is already "one `texture2d_array`, every layer the same size" — exactly
 * what a vehicle's or a ped's dictionary is once the builder has bucketed it. These layers go through the
 * same alpha pipeline and the same row packing as the world planner's, so an optimized model's textures
 * behave like every other texture we ship. Payload is BC1/BC3 and carries a SINGLE level; see below for why
 * this writer never generates mips.
 */
import type { VehicleTextureArray } from '@opensa/renderware/vehicle/types';

import { type AlphaClass, classifyAlpha, processAlphaTexture } from '@opensa/cell-weld/alpha';
import { packOstexPayload } from '@opensa/cell-weld/ostex-payload';
import {
  encodeOstex,
  fnv1a,
  type Ostex,
  OstexAlphaClass,
  OstexFormat,
  type OstexFormatId,
} from '@opensa/engine-formats';
import { encodeDxt } from '@opensa/rw-codec/dxt-encode';

/** Alpha-to-coverage reference for cutouts — the world planner's value, kept identical on purpose. */
const CUTOUT_REF = 128;

const ALPHA_TO_OSTEX: Record<AlphaClass, number> = {
  cutout: OstexAlphaClass.CUTOUT,
  opaque: OstexAlphaClass.OPAQUE,
  softBlend: OstexAlphaClass.SOFT_BLEND,
};

/**
 * Encode a built model's texture array as a `.ostex` file.
 *
 * `forceRgba8` is the model half of `opensa-pack --rgba8`, and it is not optional for a mobile build: a car
 * is not in the pak, so converting only the WORLD leaves every vehicle and ped BC — the world then loads on
 * a phone and the first spawn throws.
 */
export function packModelOstex(texture: VehicleTextureArray, options: { forceRgba8?: boolean } = {}): Uint8Array {
  const { height, layers: layerCount, names, rgba, width } = texture;
  const texelBytes = width * height * 4;
  // ONE level, and opensa-pack must never generate more: MIPS BELONG TO map-optimizer. It is the stage
  // that authors them (53 % of map textures carry a chain in an optimized build vs 2 % in a raw game), and
  // a second generator downstream would silently overwrite its work.
  //
  // For vehicles and peds one level is also what the game wants: the engine uploads their arrays with no
  // `mipLevelCount` (`engine.ts:728-736`), and SA ships none for them either.
  //
  // MAP OBJECTS (phase 5: breakables, clutter, animated objects) are the case this writer does NOT yet
  // serve. They must PRESERVE the chain map-optimizer put in the TXD — which this entry point cannot do,
  // because `VehicleTextures` decoded level 0 and dropped the rest before we ever see the array. That path
  // has to plan from the RAW TXD, the way the world planner does (`textures.ts:184-193`).
  const mipCount = 1;

  const classes: AlphaClass[] = [];
  const processed: Uint8Array[] = [];
  for (let layer = 0; layer < layerCount; layer += 1) {
    const texels = rgba.subarray(layer * texelBytes, (layer + 1) * texelBytes);
    const alphaClass = classifyAlpha(texels, hasAlpha(texels));
    classes.push(alphaClass);
    // sharpen=false: a model's dictionary is authored art, not a foliage scan the welder had to upgrade.
    processed.push(processAlphaTexture(texels, width, height, alphaClass, CUTOUT_REF, mipCount, false)[0]);
  }

  // BC, because size wins here (user, 2026-07-18): a car's RGBA8 dictionary is ~20x its model, and ~210 of
  // them would roughly double the build. `.ostex` carries ONE format for the whole array, so the choice is
  // per model: BC1 when every layer is opaque, BC3 when any layer needs alpha. Splitting into a BC1 array
  // plus a BC3 array would be smaller still, but a model's vertices index ONE array (`meta.x`), and that
  // is a runtime contract, not a converter detail.
  //
  // This re-encodes texels that were DXT in the source. Losing a generation is the accepted price: the
  // decode already happened inside the builder, and passing the original blocks through is impossible while
  // 85 % of vehicle TXDs mix formats or sizes within one dictionary.
  const blockAligned = width % 4 === 0 && height % 4 === 0;
  const needsAlpha = classes.some((alphaClass) => alphaClass !== 'opaque');
  const compressed = blockAligned && !options.forceRgba8 ? (needsAlpha ? 'dxt5' : 'dxt1') : null;
  const format: OstexFormatId =
    compressed === null ? OstexFormat.RGBA8 : compressed === 'dxt1' ? OstexFormat.BC1 : OstexFormat.BC3;
  const layerMips = processed.map((data) => [
    { data: compressed === null ? data : encodeDxt(compressed, data, width, height) },
  ]);

  const tex: Ostex = {
    format,
    height,
    layers: classes.map((alphaClass, index) => ({
      alphaClass: ALPHA_TO_OSTEX[alphaClass],
      cutoutRef: alphaClass === 'cutout' ? CUTOUT_REF : 0,
      nameHash: fnv1a((names[index] ?? '').toLowerCase()),
      wrap: 0,
    })),
    mipCount,
    payload: packOstexPayload(format, width, height, mipCount, layerMips),
    premultiplied: true,
    width,
  };

  return encodeOstex(tex);
}

/** Whether any texel is non-opaque — the RW `hasAlpha` flag is gone by the time the builder is done. */
function hasAlpha(rgba: Uint8Array): boolean {
  for (let index = 3; index < rgba.length; index += 4) {
    if (rgba[index] < 255) {
      return true;
    }
  }

  return false;
}
