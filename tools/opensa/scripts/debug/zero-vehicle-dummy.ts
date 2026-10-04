import { parseDff } from '@opensa/renderware/parsers/binary/dff';
/**
 * Move a vehicle DUMMY to the model origin — the way an author says "this model has no lamp of that kind".
 *
 * SA reads a missing lamp dummy back as (0,0,0) from `CVehicleModelInfo::m_avDummyPos` and tests exactly
 * that (`CVehicle::DoHeadLightBeam`: `if (pointModelSpace.IsZero()) return;`), and OpenSA honours it since
 * plan 098/11 — an origin dummy yields no beam, no pool light and no corona at that end. So zeroing
 * `headlights` is how a race car declares it has no headlights, in the ASSET, with no engine change and no
 * per-model rule. The hotring's own author already did it for `taillights`.
 *
 * The edit is 12 bytes: only that frame's position floats change, everything else in the DFF is untouched.
 * Nothing is written unless the offset the tool computed decodes to the position the PARSER reports for
 * that frame — the arithmetic checks itself against a second reader before it is trusted.
 *
 *   npx tsx scripts/debug/zero-vehicle-dummy.ts <file.dff> <dummyName>            # dry run
 *   npx tsx scripts/debug/zero-vehicle-dummy.ts <file.dff> <dummyName> --write
 *
 * It writes into `mods-src/` — a mod's own source. There is no undo; keep the author's archive.
 */
import { readFileSync, writeFileSync } from 'node:fs';

/** RenderWare chunk header: type, size, version. */
const CHUNK_HEADER = 12;
const CLUMP = 0x10;
const STRUCT = 0x01;
const FRAME_LIST = 0x0e;
/** One frame record: 9 rotation floats, 3 position floats, parent index, matrix flags. */
const FRAME_RECORD = 56;
const POSITION_AT = 36;

const [file, dummyName, ...flags] = process.argv.slice(2);
if (!file || !dummyName) {
  throw new Error('usage: zero-vehicle-dummy.ts <file.dff> <dummyName> [--write]');
}
const write = flags.includes('--write');

const bytes = new Uint8Array(readFileSync(file));
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** The first child of `type` between `from` and `end`, as [dataStart, end]. */
function findChild(from: number, end: number, type: number): [number, number] | null {
  let at = from;
  while (at + CHUNK_HEADER <= end) {
    const chunkType = view.getUint32(at, true);
    const size = view.getUint32(at + 4, true);
    const dataStart = at + CHUNK_HEADER;
    if (chunkType === type) {
      return [dataStart, dataStart + size];
    }
    at = dataStart + size;
  }

  return null;
}

const clump = findChild(0, bytes.byteLength, CLUMP);
if (!clump) {
  throw new Error('not a DFF: no Clump chunk');
}
const frameList = findChild(clump[0], clump[1], FRAME_LIST);
if (!frameList) {
  throw new Error('DFF has no FrameList');
}
const struct = findChild(frameList[0], frameList[1], STRUCT);
if (!struct) {
  throw new Error('FrameList has no Struct');
}

// The parser is the second reader: it supplies the frame NAMES (which live in later extension chunks) and
// the position each frame really has, so the byte offset below can be checked rather than believed.
const { frames } = parseDff(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const index = frames.findIndex((frame) => frame.name.trim().toLowerCase() === dummyName.trim().toLowerCase());
if (index < 0) {
  const named = frames.map((frame) => frame.name).filter(Boolean);
  throw new Error(`no frame named '${dummyName}' — this model has: ${named.join(', ')}`);
}

const at = struct[0] + 4 + index * FRAME_RECORD + POSITION_AT;
const here: [number, number, number] = [
  view.getFloat32(at, true),
  view.getFloat32(at + 4, true),
  view.getFloat32(at + 8, true),
];
const parsed = frames[index].position;
const agrees = here.every((value, axis) => Math.abs(value - parsed[axis]) < 1e-9);
console.log(`frame ${index} '${frames[index].name}' at byte ${at}`);
console.log(`  bytes say  ${here.map((v) => v.toFixed(3)).join(', ')}`);
console.log(`  parser says ${parsed.map((v) => v.toFixed(3)).join(', ')}`);
if (!agrees) {
  throw new Error('the computed offset does not match the parser — refusing to write');
}
if (here.every((value) => value === 0)) {
  console.log('already at the origin — nothing to do');
  process.exit(0);
}
if (!write) {
  console.log('dry run — pass --write to zero it');
  process.exit(0);
}

for (let axis = 0; axis < 3; axis += 1) {
  view.setFloat32(at + axis * 4, 0, true);
}
writeFileSync(file, bytes);

// Read the file back through the parser: a 12-byte write must leave every other frame exactly where it was.
const after = parseDff(readFileSync(file).buffer);
const moved = after.frames.filter((frame, i) => frame.position.some((v, a) => v !== frames[i].position[a]));
console.log(`wrote ${file} — frames whose position changed: ${moved.map((frame) => frame.name).join(', ')}`);
if (moved.length !== 1 || moved[0].name !== frames[index].name) {
  throw new Error('more than the named dummy moved — restore this file from the mod archive');
}
