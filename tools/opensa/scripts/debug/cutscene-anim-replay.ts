import { openArchive } from '@opensa/renderware/archive/img-archive';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
/**
 * cutscene-anim-replay — simulate the game's cutscene pose of a model offline, under the RUNTIME LAW
 * (gta-reversed `FrameUpdateCallBackNonSkinned`, plan 004 round 15): a frame with a NAME-bound anim
 * channel takes the channel's frame-0 value (KRT0 quat+trans; KR00 rot only, position kept); every
 * OTHER frame is forced to IDENTITY rotation + its stored position — exactly what the engine rewrites
 * each tick (a rotation stored in an un-animated frame is silently erased in game while every plain
 * offline view still shows it). Prints per-atomic world y/z bboxes of the composed pose.
 *
 * This is the instrument that cracked HEIST8A's securica-on-its-tail: bind pose, worlds and a naive
 * replay all looked upright — only the law-replay reproduced the field screenshot. Run it on a
 * VANILLA model first as calibration (must reproduce bind), then on the converted one.
 * Run: `npx tsx scripts/debug/cutscene-anim-replay.ts <img-path>::<entry.dff> <scene.ifp> <object>`
 *      `npx tsx scripts/debug/cutscene-anim-replay.ts "NO_COMMIT/cs-mods-plates/models/cutscene.img::cssecurica92.dff" heist8a.ifp cssecurica92`
 */
import { readFileSync } from 'node:fs';

const [source, ifpName, objectName] = process.argv.slice(2);
const [imgPath, entry] = source.split('::');
const archive = openArchive(new Uint8Array(readFileSync(imgPath)));
const dffBuf = archive.get(entry);
if (!dffBuf) throw new Error(`${entry} not in ${imgPath}`);
const clump = parseDff(dffBuf);

// --- read anim channels (frame 0 values)
const cuts = openArchive(new Uint8Array(readFileSync('game-src/original/anim/cuts.img')));
const bytes = cuts.get(ifpName.toLowerCase());
if (!bytes) throw new Error(`no ${ifpName}`);
const data = new Uint8Array(bytes);
const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
const tag = (at: number): string => String.fromCharCode(data[at], data[at + 1], data[at + 2], data[at + 3]);
const cstr = (at: number, max: number): string => {
  let out = '';
  for (let i = 0; i < max && data[at + i] !== 0; i++) out += String.fromCharCode(data[at + i]);

  return out;
};
const align = (value: number): number => (value + 3) & ~3;

interface Channel {
  quat: [number, number, number, number];
  trans: [number, number, number] | null;
}
const channels = new Map<string, Channel>();
{
  let pos = 8;
  let object = '';
  while (pos + 8 <= data.length) {
    const kind = tag(pos);
    const size = view.getUint32(pos + 4, true);
    if (kind === 'NAME') {
      object = cstr(pos + 8, size);
      pos = align(pos + 8 + size);
    } else if (kind === 'DGAN' || kind === 'CPAN') {
      pos += 8;
    } else if (kind === 'ANIM') {
      const bone = cstr(pos + 8, 28);
      const keyframesAt = align(pos + 8 + size);
      const keyKind = keyframesAt + 8 <= data.length ? tag(keyframesAt) : '????';
      if (object.toLowerCase() === objectName.toLowerCase() && (keyKind === 'KRT0' || keyKind === 'KR00')) {
        const at = keyframesAt + 8;
        const quat = [0, 1, 2, 3].map((i) => view.getFloat32(at + i * 4, true)) as Channel['quat'];
        const trans =
          keyKind === 'KRT0'
            ? ([4, 5, 6].map((i) => view.getFloat32(at + i * 4, true)) as [number, number, number])
            : null;
        channels.set(bone.trim().toLowerCase(), { quat, trans });
      }
      pos = keyframesAt;
    } else {
      pos = align(pos + 8 + size);
    }
  }
}
console.log(`channels: ${[...channels.keys()].join(', ')}`);

// --- compose with anim overrides
type Mat4 = number[];
function apply(m: Mat4, x: number, y: number, z: number): [number, number, number] {
  return [
    m[0] * x + m[1] * y + m[2] * z + m[3],
    m[4] * x + m[5] * y + m[6] * z + m[7],
    m[8] * x + m[9] * y + m[10] * z + m[11],
  ];
}

function localOf(frame: { name: string; position: [number, number, number]; rotation: number[] }): Mat4 {
  const channel = channels.get(frame.name.trim().toLowerCase());
  if (channel) {
    const m = quatToRot(channel.quat);
    const p = channel.trans ?? frame.position;

    return [m[0], m[1], m[2], p[0], m[3], m[4], m[5], p[1], m[6], m[7], m[8], p[2], 0, 0, 0, 1];
  }
  // The RUNTIME LAW (FrameUpdateCallBackNonSkinned, gta-reversed): an unanimated frame on an
  // animated clump is rewritten every frame to IDENTITY rotation + its snapshot position.
  const p = frame.position;

  return [1, 0, 0, p[0], 0, 1, 0, p[1], 0, 0, 1, p[2], 0, 0, 0, 1];
}

function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array<number>(16).fill(0);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];

  return o;
}

function quatToRot(q: [number, number, number, number]): number[] {
  const [x, y, z, w] = q;

  // transposed vs the textbook form — calibrated so the vanilla model + its own anim reproduce bind
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y + z * w),
    2 * (x * z - y * w),
    2 * (x * y - z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z + x * w),
    2 * (x * z + y * w),
    2 * (y * z - x * w),
    1 - 2 * (x * x + y * y),
  ];
}

// Root channel (Dummy01) poses the object in SCENE space — skip it so results stay comparable to
// bind (drop the root override).
const rootBone = clump.frames.findIndex((frame) => frame.boneId === 0);
if (rootBone >= 0) channels.delete(clump.frames[rootBone].name.trim().toLowerCase());

const worlds: Mat4[] = [];
clump.frames.forEach((frame) => {
  const local = localOf(frame);
  worlds.push(frame.parentIndex >= 0 ? mul(worlds[frame.parentIndex], local) : local);
});
for (const [ai, a] of clump.atomics.entries()) {
  const g = clump.geometries[a.geometryIndex];
  const m = worlds[a.frameIndex];
  let maxY = -Infinity,
    maxZ = -Infinity,
    minY = Infinity,
    minZ = Infinity;
  for (let vi = 0; vi < g.positions.length; vi += 3) {
    const [, y, z] = apply(m, g.positions[vi], g.positions[vi + 1], g.positions[vi + 2]);
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  console.log(
    `atomic ${ai}: ${clump.frames[a.frameIndex].name} y=[${minY.toFixed(2)}..${maxY.toFixed(2)}] z=[${minZ.toFixed(2)}..${maxZ.toFixed(2)}]`,
  );
}
