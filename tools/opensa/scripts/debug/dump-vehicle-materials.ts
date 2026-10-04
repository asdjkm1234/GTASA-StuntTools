import { readVehicleOsm } from '@opensa/game/adapters/vehicle-osm';
import { openArchive } from '@opensa/renderware/archive/img-archive';
import { existsSync, readFileSync } from 'node:fs';

/**
 * What each submesh of a BUILT car ended up as: material class, lamp tag, night-twin layer, minimum vertex
 * alpha, the reflection slots and its mean sky occlusion. It reads `build/<game>/opensa` — the merged tree a
 * field run actually loads — so it answers "why does this panel shine / glow / turn red?" against the data
 * the game is running, not against the mod folder.
 *
 * It found the previon cabin round (2026-07-28): the interior's dash trim comes out class CHROME with an env
 * coefficient of 0.5 at sky visibility 0.63, which is why it mirrored the sun through the windscreen.
 *
 * Run: `npx tsx scripts/debug/dump-vehicle-materials.ts <game> <model>`
 */
const [game, model] = process.argv.slice(2);
if (!game || !model) {
  throw new Error('usage: dump-vehicle-materials.ts <game> <model>');
}

// Since the img-archive split, a car lives in vehicles.img / vehicles2.img (gta3.img kept for older trees).
const osm = ['vehicles', 'vehicles2', 'gta3']
  .map((img) => `build/${game}/opensa/models/${img}.img`)
  .filter((path) => existsSync(path))
  .map((path) => openArchive(new Uint8Array(readFileSync(path))).get(`${model}.osm`))
  .find((entry) => entry !== undefined);
if (!osm) {
  throw new Error(`no ${model}.osm in build/${game}`);
}
const read = readVehicleOsm(model, new Uint8Array(osm));
const raw = read.model as unknown as { index16: boolean; indices: Uint8Array };
// The `.osm` ships indices as BYTES: read raw they walk the wrong vertices, and every number below is then
// somebody else's (it cost this script one wrong verdict before it was written down).
const indices = raw.index16
  ? new Uint16Array(raw.indices.buffer, raw.indices.byteOffset, raw.indices.byteLength / 2)
  : new Uint32Array(raw.indices.buffer, raw.indices.byteOffset, raw.indices.byteLength / 4);
const { colors, meta, night, reflect } = read.model;
const { parts, submeshes } = read.rig;

/** Material classes and lamp tags by value — see `renderware/vehicle/types.ts`. */
const CLASS = ['matte', 'paint', 'chrome', 'glass', 'plate-back', 'plate-face'];
const LAMP = ['-', 'head', 'tail'];

console.log(`\n=== ${model} (build/${game}) — ${submeshes.length} submeshes`);
for (const [index, submesh] of submeshes.entries()) {
  const first = indices[submesh.indexOffset];
  const slots = meta.subarray(first * 4, first * 4 + 4);
  const slot = reflect.subarray(first * 4, first * 4 + 4);
  const seen = new Set<number>();
  let occlusion = 0;
  let alpha = 255;
  for (let at = 0; at < submesh.indexCount; at += 1) {
    const vertex = indices[submesh.indexOffset + at];
    if (seen.has(vertex)) {
      continue;
    }
    seen.add(vertex);
    occlusion += night[vertex * 4 + 3];
    alpha = Math.min(alpha, colors[vertex * 4 + 3]);
  }
  console.log(
    `${String(index).padStart(3)} ${(parts[submesh.part]?.name ?? '?').padEnd(20)} ${submesh.kind.padEnd(4)}` +
      ` class=${CLASS[slots[3] >> 4].padEnd(6)} lamp=${LAMP[slots[3] & 0xf].padEnd(4)} nightTwin=${String(slots[1]).padStart(3)}` +
      ` alphaMin=${String(alpha).padStart(3)} reflect[coef=${slot[1]} int=${slot[2]} spec=${slot[3]}]` +
      ` sky=${(occlusion / seen.size / 255).toFixed(2)}`,
  );
}
