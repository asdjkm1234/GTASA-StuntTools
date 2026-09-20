/**
 * 097/04 phase-0 spike (`?osmspike=<model>`): prove the CLEO host's model path before the chain is built —
 * ONE map-object `.osm`, looked up by NAME in the runtime VFS, rendered as an engine rigid instance at a
 * fixed transform beside the player. Temporary by design: `CleoHost` (plan 097/04) replaces it.
 *
 * The verdict is the console line: MISSING means the loader's partition never selected the model (the
 * `cleoModelRefs` fallback becomes required); spawned + visible on a screenshot means arbitrary-name
 * lookup works end to end, world-referencing textures included (`worldArrays` — engine.ts).
 */
import type { Engine, VehicleInstance } from '@opensa/engine';
import type { AssetFileSystem } from '@opensa/renderware';

import { gtaPositionToEngine, writeGtaRoot } from '@opensa/game/adapters/engine-vehicle-handle';
import { readModelOsm } from '@opensa/game/adapters/vehicle-osm';

/** Where the model stands relative to the player's FIRST position (GTA metres): SOUTH — the boot camera
 *  faces south — and lifted well clear of the ground so a model whose origin sits above its geometry
 *  (ferris01_law2: ~13 m) still shows whole. */
const OFFSET: readonly [number, number, number] = [0, -60, 18];

export interface OsmSpike {
  /** Spawn on the first call (the player position is real by then), then hold the transform each frame. */
  update(playerGta: readonly [number, number, number]): void;
}

export function setupOsmSpike(engine: Engine, fs: AssetFileSystem, modelName: string): OsmSpike {
  const root = new Float32Array(16);
  let instance: null | VehicleInstance = null;
  let anchor: [number, number, number] = [0, 0, 0];
  let failed = false;

  return {
    update(playerGta): void {
      if (failed) {
        return;
      }
      if (!instance) {
        const key = `${modelName.toLowerCase()}.osm`;
        const osm = fs.get(key);
        if (!osm) {
          failed = true;
          // eslint-disable-next-line no-console -- the console line IS the spike's verdict
          console.error(`[osmspike] ${key} MISSING from the runtime VFS — arbitrary-name lookup failed`);

          return;
        }
        try {
          instance = engine.createVehicle(
            engine.createVehicleModel(readModelOsm(modelName, new Uint8Array(osm)).model),
          );
        } catch (error) {
          failed = true;
          // eslint-disable-next-line no-console -- the console line IS the spike's verdict
          console.error(`[osmspike] ${key} found (${osm.byteLength} bytes) but failed to build:`, error);

          return;
        }
        anchor = [playerGta[0] + OFFSET[0], playerGta[1] + OFFSET[1], playerGta[2] + OFFSET[2]];
        // eslint-disable-next-line no-console -- the console line IS the spike's verdict
        console.log(`[osmspike] ${key} (${osm.byteLength} bytes) spawned at gta(${anchor.join(', ')})`);
      }
      writeGtaRoot(root, gtaPositionToEngine(anchor), [0, 0, 0, 1]);
      instance.entity.setRoot(root);
      engine.updateVehicles(); // flatten + upload, exactly as the felled props do
    },
  };
}
