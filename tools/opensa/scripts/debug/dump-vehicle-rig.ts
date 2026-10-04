import type { VehicleVariantNode } from '@opensa/renderware/vehicle/types';

import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { buildVehicleModel } from '@opensa/renderware/vehicle/build-vehicle-model';
import { VehicleTextures } from '@opensa/renderware/vehicle/textures';
import { existsSync } from 'node:fs';

import { gameArg, gameDir, openGameArchive, positionalArgs, readBytes } from '../lib/game';

/**
 * What the vehicle BUILDER sees in a car: its frame tree, the parts it produced, the doors and their
 * hinges, the retractable-headlight pod, the wheels — plus the two traps that cost this project field
 * sessions, called out by name:
 *
 *   - a `<part>_ok` / `_dam` frame carrying its OWN transform. SA destroys that frame
 *     (`PreprocessHierarchy` → `CollapseFramesCB`), so the mesh belongs on the `*_dummy`. Stock cars author
 *     it as identity; a mod put 1.518 m there and its doors hung off the car.
 *   - a hinge frame with a ROTATED basis — that is how a scissor door is built, and the swing follows it.
 *
 * Run: `npx tsx scripts/debug/dump-vehicle-rig.ts <model|path/to.dff> [--game gostown]`.
 * A path is read as a loose file (a mod folder); a bare name is extracted from the game's archives.
 */
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const DEGREES = 180 / Math.PI;

const target = positionalArgs()[0];
if (!target) {
  throw new Error('usage: dump-vehicle-rig.ts <model|path/to.dff> [--game <game>]');
}

const game = gameArg();
const loose = target.toLowerCase().endsWith('.dff');
const model = (loose ? (target.split(/[\\/]/).pop() ?? target) : target).replace(/\.dff$/i, '').toLowerCase();
const archive = loose ? null : openGameArchive(game);
const dff = loose ? readBytes(target) : archive!.get(`${model}.dff`);
if (!dff) {
  throw new Error(`no ${model}.dff (game ${game})`);
}
const txds = loose
  ? [target.replace(/\.dff$/i, '.txd')].filter((path) => existsSync(path)).map((path) => readBytes(path))
  : [archive!.get(`${model}.txd`), readBytes(gameDir(game, 'models', 'generic', 'vehicle.txd'))];

const clump = parseDff(toBuffer(dff));
const built = buildVehicleModel(clump, new VehicleTextures(txds.filter(Boolean).map((bytes) => toBuffer(bytes!))));

const vec = (values: readonly number[]): string => values.map((value) => value.toFixed(3).padStart(7)).join(' ');
const rotated = (rotation: readonly number[]): boolean =>
  rotation.some((value, at) => Math.abs(value - IDENTITY[at]) > 1e-4);

console.log(`\n=== ${model} — ${clump.frames.length} frames, ${clump.atomics.length} atomics`);
for (const [index, frame] of clump.frames.entries()) {
  const name = frame.name.trim();
  const mesh = clump.atomics.some((atomic) => atomic.frameIndex === index);
  const parent = frame.parentIndex >= 0 ? clump.frames[frame.parentIndex]?.name.trim() : 'root';
  console.log(
    `${String(index).padStart(3)} ${name.padEnd(20)}${mesh ? '[mesh]' : '      '} parent=${(parent ?? '?').padEnd(16)} pos ${vec(frame.position)}${rotated(frame.rotation) ? '  ROTATED' : ''}`,
  );
}

// The trap: a damage twin whose own frame carries a transform the game would have destroyed.
console.log('\n--- damage components (their own frame transform is DISCARDED at build)');
for (const frame of clump.frames) {
  const name = frame.name.trim();
  if (!/_(?:ok|dam)$/i.test(name)) {
    continue;
  }
  const moved = Math.hypot(frame.position[0], frame.position[1], frame.position[2]);
  const flag = moved > 1e-3 || rotated(frame.rotation) ? '   <-- NON-IDENTITY (collapsed away)' : '';
  console.log(`  ${name.padEnd(20)} offset ${moved.toFixed(3)} m${rotated(frame.rotation) ? ' + rotated' : ''}${flag}`);
}

console.log('\n--- parts the builder emitted');
for (const [index, part] of built.parts.entries()) {
  console.log(
    `${String(index).padStart(3)} ${part.name.padEnd(20)} at ${vec(part.localTranslation)}` +
      `${part.scale === undefined ? '' : `  scale ${part.scale.toFixed(3)}`}` +
      `${part.offset ? '  +offset' : ''}` +
      `${part.localRotation.some((value, at) => Math.abs(value - [0, 0, 0, 1][at]) > 1e-4) ? '  ROTATED PIVOT' : ''}`,
  );
}

console.log('\n--- articulation');
for (const door of built.doors) {
  const part = built.parts[door.part];
  console.log(`  door ${door.side}  part ${door.part} '${part.name}'  hinge ${vec(part.localTranslation)}`);
}
for (const wheel of built.wheels) {
  console.log(`  wheel ${wheel.front ? 'front' : 'rear '}  part ${wheel.part}  radius ${wheel.radius.toFixed(3)}`);
}
console.log(
  built.popUpLights
    ? `  pop-up headlights: part ${built.popUpLights.part} '${built.parts[built.popUpLights.part].name}' opens ${(built.popUpLights.angle * DEGREES).toFixed(1)}°`
    : '  pop-up headlights: none (no misc_* pod holding head-lamp faces)',
);

// The VehFuncs tree the runtime walks per spawn (`variants.ts`): what a spawn can wear, and how many of it.
if (built.variants) {
  console.log('\n--- VehFuncs variants (spawn picks; [min,max] children, max −1 = all)');
  const tagged = new Map<string, number>();
  for (const submesh of built.submeshes) {
    if (submesh.variant !== undefined) {
      tagged.set(submesh.variant, (tagged.get(submesh.variant) ?? 0) + 1);
    }
  }
  const show = (node: VehicleVariantNode, depth: number): void => {
    const gate = node.requires ? ` [${node.requires.join(',')}]` : '';
    const cond = node.condition ? ` ?${node.condition}` : '';
    const meshes = tagged.has(node.id) ? `  ${tagged.get(node.id)} submesh(es)` : '';
    console.log(`  ${'  '.repeat(depth)}${node.name}${gate}${cond}  [${node.select.join(',')}]${meshes}`);
    node.children.forEach((child) => show(child, depth + 1));
  };
  built.variants.classes.forEach((node) => show(node, 0));
  built.variants.extras.forEach((node) => show(node, 0));
} else {
  console.log('\n--- VehFuncs variants: none');
}

function toBuffer(bytes: ArrayBuffer | Uint8Array): ArrayBuffer {
  return bytes instanceof Uint8Array
    ? (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    : bytes;
}
