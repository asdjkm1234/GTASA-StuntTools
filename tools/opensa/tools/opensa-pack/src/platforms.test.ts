import type { OspakManifest } from '@opensa/engine-formats';

import { OstexFormat } from '@opensa/engine-formats';
import { describe, expect, it } from 'vitest';

import { assertPlatformSupport, platformDemand, satisfiedTargets } from './platforms';

/** A manifest whose world arrays are all in `format` (an empty list = a pak with no textures at all). */
function world(...formats: number[]): OspakManifest {
  const textures: OspakManifest['textures'] = {};
  formats.forEach((format, index) => {
    textures[`array-${index}`] = { format, hash: 0, height: 64, layers: 1, length: 8, offset: 0, width: 64 };
  });

  return { byteLength: 4096, cells: {}, cellSize: 250, textures, version: 1 };
}

describe('platform demand', () => {
  describe('negative cases', () => {
    it('fails a mobile claim when the WORLD is BC', () => {
      const demand = platformDemand(world(OstexFormat.BC3), []);

      expect(() => assertPlatformSupport(demand, ['mobile'])).toThrow(/cannot run on 'mobile'/);
    });

    // The half a pak-only check cannot see: --rgba8 converts the world, and a car is not in the pak.
    it('fails a mobile claim when only the MODEL dictionaries are BC', () => {
      const demand = platformDemand(world(OstexFormat.RGBA8), [OstexFormat.BC1]);

      expect(demand.world).toEqual([]);
      expect(() => assertPlatformSupport(demand, ['mobile'])).toThrow(/model dictionaries need/);
    });

    it('rejects a platform name nobody has a capture for', () => {
      expect(() => assertPlatformSupport(platformDemand(world(), []), ['console'])).toThrow(/unknown platform target/);
    });
  });

  describe('positive cases', () => {
    it('passes a desktop claim for a BC build', () => {
      const demand = platformDemand(world(OstexFormat.BC1, OstexFormat.BC3), [OstexFormat.BC3]);

      expect(demand.features).toEqual(['texture-compression-bc']);
      expect(() => assertPlatformSupport(demand, ['desktop'])).not.toThrow();
      expect(satisfiedTargets(demand)).toEqual(['desktop']);
    });

    it('passes both claims for an all-RGBA8 build, which demands nothing', () => {
      const demand = platformDemand(world(OstexFormat.RGBA8), [OstexFormat.RGBA8]);

      expect(demand.features).toEqual([]);
      expect(() => assertPlatformSupport(demand, ['desktop', 'mobile'])).not.toThrow();
      expect(satisfiedTargets(demand)).toEqual(['desktop', 'mobile']);
    });
  });
});
