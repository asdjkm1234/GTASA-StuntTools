/**
 * Skinning-probe host (074/08 B1, `?ped=1`, plan 079 phase 2): read a CONVERTED ped `<model>.osm` from the
 * served build and its `anim/ped.ifp`, decode them with the game's own `readPedOsm` + `parseIfp` (the same
 * recipe `loadEnginePlayer` runs, replacing the old ped-probe fixture), feed the engine, and drive the IFP
 * sampler each frame. The model matrix owns the GTA→engine axis change + a slow yaw so every side comes
 * around; clips alternate so both idle and walk get eyeballed. Needs `?src` at a served game dir.
 */
import type { InstallSource } from '@opensa/loaders';

import { type Engine, IfpSampler, type PedProbe, type SamplerClip } from '@opensa/engine';
import { readPedOsm } from '@opensa/game/adapters/ped-osm';
import { parseIfp } from '@opensa/renderware/parsers/binary/ifp';
import { pedClip } from '@opensa/renderware/ped/build-ped-model';

import { readModelBytes } from './vfs';

export interface PedProbeHost {
  /** Sample the active clip at `nowSec`, upload the palette; returns the CPU cost in ms. */
  update(nowSec: number): number;
}

const CLIP_SWAP_SECONDS = 6;
/** Clips eyeballed, alternating: idle then walk — resolved against THIS model's bones from the game's IFP. */
const PROBE_CLIPS = ['idle_stance', 'walk_civi'];

export async function loadPedProbe(
  engine: Engine,
  position: readonly [number, number, number],
  source: InstallSource,
  model = 'male01',
): Promise<PedProbeHost> {
  const osm = await readModelBytes(source, `${model}.osm`);
  if (!osm) {
    throw new Error(`ped model ${model}.osm not found in the served build — check ?src`);
  }
  const { fixture, geometry, textureArrays } = readPedOsm(model, osm);
  const probe: PedProbe = engine.setPedProbe({
    boneCount: fixture.bones.length,
    indexCount: fixture.indexCount,
    indices: geometry.indices,
    joints: geometry.joints,
    normals: geometry.normals,
    positions: geometry.positions,
    submeshes: fixture.submeshes,
    textures: textureArrays.map((bytes) => ({ bytes, kind: 'ostex' as const })),
    uvs: geometry.uvs,
    weights: geometry.weights,
  });
  const sampler = new IfpSampler(fixture.bones);
  // The clips ride the game's own `ped.ifp` (loose in the build), so a modded ped.ifp changes how the probe
  // walks — a baked fixture could never express that.
  const ifp = await readLooseOrNull(source, 'anim/ped.ifp');
  const animations = ifp
    ? parseIfp(ifp.buffer.slice(ifp.byteOffset, ifp.byteOffset + ifp.byteLength) as ArrayBuffer)
    : [];
  const clips: SamplerClip[] = PROBE_CLIPS.map((name) => {
    const animation = animations.find((entry) => entry.name.toLowerCase() === name);

    return animation ? pedClip(animation, fixture.bones) : { duration: 0, name, tracks: [] };
  });

  return {
    update(nowSec: number): number {
      const started = performance.now();
      const clip = clips[Math.floor(nowSec / CLIP_SWAP_SECONDS) % clips.length];
      sampler.sample(clip, nowSec, probe.palette, 1);
      writeModelMatrix(probe.palette, position, nowSec * 0.4);
      engine.updatePedPalette();

      return performance.now() - started;
    },
  };
}

/** Read a loose file, or null when it is absent (the probe still renders — static in the bind pose). */
async function readLooseOrNull(source: InstallSource, path: string): Promise<null | Uint8Array> {
  try {
    return await source.readLoose(path);
  } catch {
    return null;
  }
}

/** Slot 0 = GTA Z-up → engine Y-up axis change × yaw(θ about GTA Z) × translation (engine space). */
function writeModelMatrix(palette: Float32Array, position: readonly [number, number, number], yaw: number): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  palette[0] = c;
  palette[1] = 0;
  palette[2] = -s;
  palette[3] = 0;
  palette[4] = -s;
  palette[5] = 0;
  palette[6] = -c;
  palette[7] = 0;
  palette[8] = 0;
  palette[9] = 1;
  palette[10] = 0;
  palette[11] = 0;
  palette[12] = position[0];
  palette[13] = position[1];
  palette[14] = position[2];
  palette[15] = 1;
}
