/**
 * The missing-texture highlight (plan 085 row B).
 *
 * opensa-pack replaces a texture the whole chain cannot supply with a 4×4 colour stand-in layer and lists
 * it in the pak manifest (`missingLayers`). The engine repaints exactly those layers magenta when the
 * highlight is on (dev default) and back to the packed material colour when it is off — no re-fetch. The
 * decisions asserted here are the `writeTexture` calls into the array texture: which layer, what texel.
 */
import { encodeOstex, OstexFormat, ostexLayerBytes } from '@opensa/engine-formats';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FakeGpu, RecordedTextureWrite } from './test/fake-device';

import { Engine } from './engine';
import { installFakeWebGpu } from './test/fake-device';

let harness: ReturnType<typeof installFakeWebGpu>;
let gpu: FakeGpu;

const REF = 7;
const GREY: [number, number, number, number] = [92, 92, 87, 255];
const MAGENTA = [255, 0, 255, 255];

/** A 3-layer 4×4 RGBA8 array — layer 1 is the stand-in under test. */
function arrayBytes(): Uint8Array {
  const size = 4;
  const layers = [0, 1, 2].map((hash) => ({ alphaClass: 0, cutoutRef: 0, nameHash: hash, wrap: 0 }));

  return encodeOstex({
    format: OstexFormat.RGBA8,
    height: size,
    layers,
    mipCount: 1,
    payload: new Uint8Array(ostexLayerBytes(OstexFormat.RGBA8, size, size, 1) * layers.length),
    premultiplied: false,
    width: size,
  });
}

async function bootedEngine(): Promise<Engine> {
  const engine = new Engine();
  await engine.init(harness.canvas);

  return engine;
}

/** `writeTexture` calls into the world array AFTER upload (the repaints). */
const repaints = (): RecordedTextureWrite[] => gpu.textureWrites.filter((write) => write.label === `array-${REF}`);

const texelOf = (write: RecordedTextureWrite): number[] => [...write.data.subarray(0, 4)];

beforeEach(() => {
  harness = installFakeWebGpu();
  gpu = harness.gpu;
});

afterEach(() => {
  harness.restore();
});

describe('missing-texture highlight', () => {
  describe('negative cases', () => {
    it('paints nothing on load while the highlight is off', async () => {
      const engine = await bootedEngine();
      engine.textures.setMissingLayers([{ array: REF, color: GREY, layer: 1 }]);

      gpu.reset();
      engine.textures.load(REF, arrayBytes());

      // The three upload writes land, and not one repaint more.
      expect(repaints()).toHaveLength(3);
    });

    it('never writes past the array on a malformed manifest row', async () => {
      const engine = await bootedEngine();
      engine.textures.setMissingLayers([{ array: REF, color: GREY, layer: 9 }]);
      engine.textures.load(REF, arrayBytes());

      gpu.reset();
      engine.textures.setMissingHighlight(true);

      expect(repaints()).toHaveLength(0);
    });

    it('leaves arrays without missing layers untouched by the toggle', async () => {
      const engine = await bootedEngine();
      engine.textures.setMissingLayers([{ array: REF + 1, color: GREY, layer: 0 }]);
      engine.textures.load(REF, arrayBytes());

      gpu.reset();
      engine.textures.setMissingHighlight(true);

      expect(repaints()).toHaveLength(0);
    });
  });

  describe('positive cases', () => {
    it('paints the stand-in layer magenta on load when the highlight is already on (dev default)', async () => {
      const engine = await bootedEngine();
      engine.textures.setMissingLayers([{ array: REF, color: GREY, layer: 1 }]);
      engine.textures.setMissingHighlight(true);

      gpu.reset();
      engine.textures.load(REF, arrayBytes());

      const paint = repaints()[repaints().length - 1];
      expect(paint?.z).toBe(1);
      expect(texelOf(paint)).toEqual(MAGENTA);
    });

    it('paints the stand-in when a budgeted (drained) upload completes with the highlight on', async () => {
      const engine = await bootedEngine();
      engine.textures.setMissingLayers([{ array: REF, color: GREY, layer: 1 }]);
      engine.textures.setMissingHighlight(true);

      gpu.reset();
      engine.textures.beginLoad(REF, arrayBytes());
      expect(repaints()).toHaveLength(0); // begin writes nothing — the drain pays for the writes

      engine.textures.drainUploads(1000);

      const paint = repaints()[repaints().length - 1];
      expect(paint?.z).toBe(1);
      expect(texelOf(paint)).toEqual(MAGENTA);
    });

    it('repaints a RESIDENT array on toggle, and restores the packed colour on toggle-off', async () => {
      const engine = await bootedEngine();
      engine.textures.setMissingLayers([{ array: REF, color: GREY, layer: 1 }]);
      engine.textures.load(REF, arrayBytes());

      gpu.reset();
      engine.textures.setMissingHighlight(true);
      const loud = repaints()[repaints().length - 1];
      engine.textures.setMissingHighlight(false);
      const quiet = repaints()[repaints().length - 1];

      expect(loud?.z).toBe(1);
      expect(texelOf(loud)).toEqual(MAGENTA);
      expect(quiet?.z).toBe(1);
      expect(texelOf(quiet)).toEqual([...GREY]);
    });

    it('toggling to the same state is a no-op — no redundant GPU writes', async () => {
      const engine = await bootedEngine();
      engine.textures.setMissingLayers([{ array: REF, color: GREY, layer: 1 }]);
      engine.textures.load(REF, arrayBytes());
      engine.textures.setMissingHighlight(true);

      gpu.reset();
      engine.textures.setMissingHighlight(true);

      expect(repaints()).toHaveLength(0);
    });
  });
});
