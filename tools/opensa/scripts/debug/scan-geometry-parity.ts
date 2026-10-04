import { openArchive } from '@opensa/renderware/archive/img-archive';
import { buildCollisionIndex, getCollision } from '@opensa/renderware/collision/collision-index';
import { frameWorldTransform } from '@opensa/renderware/mesh/frame-transform';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { join } from 'node:path';

import { loadMapDefsAt, positionalArgs, readBytes } from '../lib/game';

/**
 * scan-geometry-parity — the two ways a legal DFF can be RENDERED wrong by us (plan 095). Sibling of
 * `scan-model-defects.ts`, which ranks defects in the authored DATA; this one ranks defects in our READ of
 * it, and both families are SILENT by nature: the model renders, just facing the wrong way or standing in
 * the wrong place.
 *
 *   Family C — the file's Struct face array disagrees with its BinMeshPLG index data. RenderWare draws the
 *     index data; a geometry where the two wind oppositely renders inside-out if the face array is used, and
 *     a single-sided road slab then vanishes into its own back face (`roads32_law2` — the Santa Maria
 *     "blue strip"). Since 095 the parser reads the drawn data, so a hit here is now a NOTE about the asset
 *     rather than a bug in the build — keep it: it is how the next mod that ships one gets noticed.
 *   Family D — a non-identity transform on the frame an ATOMIC hangs from. `LoadAtomicFile` hands every
 *     atomic a fresh identity frame, so for a simple objs/tobj model that transform is dead data; applying
 *     it rotated `land_42_sfw` 90° and sank 165 `aw_streettree1` by 3.1 m. The verdict comes from the COL,
 *     which is authored in the space SA renders: whichever version matches its bounds is the truth.
 *
 * Two measurement traps, both paid for once (do not "simplify" them back):
 *   · Family C must compare the two orders by FACING HISTOGRAM. Keying triangles by their sorted index
 *     triple reports 770/1546 "flipped" faces on vanilla `laenwblk2` — noise from coincident triples.
 *   · Family D must look only at the frames an ATOMIC uses. Counting every frame reports 189 models; the
 *     `Omni*` 2dfx light frames that make up the difference are never rendered. The real count is 41.
 *
 * Run: `npx tsx scripts/debug/scan-geometry-parity.ts [<gameDir>] [--all]`
 *   `<gameDir>` is an SA-FORMAT tree (`game-src/original`, a `pmb --until mods` merge) — never
 *   `build/<game>/opensa`, whose IMGs hold `.osm`. Default: `game-src/original`.
 *   `--all` scans every DFF in the archive instead of the placed HD models (catches vehicles/peds).
 */
const [dirArg] = positionalArgs();
const base = dirArg ?? join('game-src', 'original');
const scanAll = process.argv.includes('--all');

const archive = openArchive(readBytes(join(base, 'models', 'gta3.img')));
const colIndex = buildCollisionIndex(archive);

interface Target {
  instances: number;
  position: [number, number, number];
}

const targets = new Map<string, Target>();
if (scanAll) {
  for (const name of archive.names) {
    if (name.toLowerCase().endsWith('.dff')) targets.set(name.slice(0, -4), { instances: 0, position: [0, 0, 0] });
  }
} else {
  const defs = loadMapDefsAt(base, archive);
  for (const instance of defs.instances) {
    if (instance.isLod) continue;
    const def = defs.catalog.get(instance.id);
    if (!def) continue;
    const row = targets.get(def.modelName);
    if (row) row.instances += 1;
    else targets.set(def.modelName, { instances: 1, position: instance.position });
  }
}

console.log(`· ${base} — ${targets.size} ${scanAll ? 'archive DFFs' : 'placed HD models'}`);

const winding: string[] = [];
const frames: string[] = [];
let parsed = 0;
let failed = 0;
for (const [model, info] of targets) {
  const bytes = archive.get(`${model}.dff`);
  if (!bytes) continue;
  let clump;
  try {
    clump = parseDff(bytes);
  } catch {
    failed += 1;
    continue;
  }
  parsed += 1;
  const where = `inst ${String(info.instances).padStart(3)} at ${info.position.map((v) => v.toFixed(0)).join(',')}`;

  const disagreement = windingDisagreement(Buffer.from(bytes), clump);
  if (disagreement) winding.push(`  ${model.padEnd(24)} ${disagreement}  ${where}`);

  const verdict = frameVerdict(model, clump);
  if (verdict) frames.push(`  ${model.padEnd(24)} ${verdict}  ${where}`);
}

console.log(`· parsed ${parsed}, parse-failed ${failed}`);
console.log(`\n=== Family C — face array disagrees with the DRAWN index data (${winding.length})`);
console.log(winding.join('\n') || '  (none)');
console.log(`\n=== Family D — non-identity ATOMIC frame, judged against the COL (${frames.length})`);
console.log(frames.join('\n') || '  (none)');

function bboxOf(
  positions: Float32Array,
  frame: null | { pos: [number, number, number]; rot: number[] },
): { max: number[]; min: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    let [x, y, z] = [positions[i], positions[i + 1], positions[i + 2]];
    if (frame) {
      const f = frame.rot;
      [x, y, z] = [
        f[0] * x + f[1] * y + f[2] * z + frame.pos[0],
        f[3] * x + f[4] * y + f[5] * z + frame.pos[1],
        f[6] * x + f[7] * y + f[8] * z + frame.pos[2],
      ];
    }
    for (const [axis, value] of [x, y, z].entries()) {
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }

  return { max, min };
}

/** Summed absolute corner mismatch — 0 means the render box sits exactly in the collision box. */
function boxDistance(
  render: { max: number[]; min: number[] },
  collision: { max: readonly number[]; min: readonly number[] },
): number {
  let sum = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    sum += Math.abs(render.min[axis] - collision.min[axis]) + Math.abs(render.max[axis] - collision.max[axis]);
  }

  return sum;
}

function child(buf: Buffer, start: number, end: number, type: number): null | { dataStart: number; end: number } {
  return children(buf, start, end, type)[0] ?? null;
}

function children(buf: Buffer, start: number, end: number, type: number): { dataStart: number; end: number }[] {
  const out: { dataStart: number; end: number }[] = [];
  let at = start;
  while (at + 12 <= end) {
    const chunkType = buf.readUInt32LE(at);
    const size = buf.readUInt32LE(at + 4);
    if (at + 12 + size > end) break;
    if (chunkType === type) out.push({ dataStart: at + 12, end: at + 12 + size });
    at += 12 + size;
  }

  return out;
}

/** Triangles as the geometry's Struct face array stores them (`[v1, v0, matId, v2]`), or null. */
function faceArrayTriangles(buf: Buffer, geometryIndex: number): (readonly [number, number, number])[] | null {
  const clumpEnd = 12 + buf.readUInt32LE(4);
  const list = child(buf, 12, clumpEnd, 0x1a);
  if (!list) return null;
  const geometry = children(buf, list.dataStart, list.end, 0x0f)[geometryIndex];
  if (!geometry) return null;
  const struct = child(buf, geometry.dataStart, geometry.end, 0x01);
  if (!struct) return null;
  let at = struct.dataStart;
  const flags = buf.readUInt16LE(at);
  const layerByte = buf.readUInt8(at + 2);
  const numUVLayers = layerByte > 0 ? layerByte : (flags & 0x80) !== 0 ? 2 : (flags & 0x04) !== 0 ? 1 : 0;
  const numTriangles = buf.readUInt32LE(at + 4);
  const numVertices = buf.readUInt32LE(at + 8);
  at += 16;
  if ((flags & 0x08) !== 0) at += numVertices * 4;
  at += numUVLayers * numVertices * 8;
  const out: (readonly [number, number, number])[] = [];
  for (let i = 0; i < numTriangles; i += 1) {
    const p = at + i * 8;
    if (p + 8 > geometry.end) return null;
    const triple = [buf.readUInt16LE(p + 2), buf.readUInt16LE(p), buf.readUInt16LE(p + 6)] as const;
    if (triple.some((v) => v >= numVertices)) continue;
    out.push(triple);
  }

  return out;
}

function facing(
  positions: Float32Array,
  triangles: readonly (readonly [number, number, number])[],
): { down: number; up: number } {
  let up = 0;
  let down = 0;
  for (const [a, b, c] of triangles) {
    const ux = positions[b * 3] - positions[a * 3];
    const uy = positions[b * 3 + 1] - positions[a * 3 + 1];
    const uz = positions[b * 3 + 2] - positions[a * 3 + 2];
    const vx = positions[c * 3] - positions[a * 3];
    const vy = positions[c * 3 + 1] - positions[a * 3 + 1];
    const vz = positions[c * 3 + 2] - positions[a * 3 + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    if (nz / length > 0.1) up += 1;
    else if (nz / length < -0.1) down += 1;
  }

  return { down, up };
}

/** Family D: the atomic SA keeps is the last non-`_dam` one; report only when its frame chain is non-identity. */
function frameVerdict(model: string, clump: ReturnType<typeof parseDff>): null | string {
  const kept = clump.atomics.filter((a) => !/_dam$/i.test(clump.frames[a.frameIndex]?.name ?? ''));
  const atomic = kept[kept.length - 1];
  if (!atomic) return null;
  const frame = frameWorldTransform(clump.frames, atomic.frameIndex);
  if (!frame) return null;
  const geometry = clump.geometries[atomic.geometryIndex];
  if (!geometry) return null;
  const label = `frame '${clump.frames[atomic.frameIndex]?.name ?? ''}'`;
  const col = getCollision(colIndex, model);
  if (!col) return `${label} — no COL to judge by`;
  const withFrame = boxDistance(bboxOf(geometry.positions, frame), col.bounds);
  const without = boxDistance(bboxOf(geometry.positions, null), col.bounds);
  const verdict =
    without + 0.5 < withFrame ? 'COL says DROP it' : withFrame + 0.5 < without ? 'COL says KEEP it' : 'COL undecided';

  return `${label} — with ${withFrame.toFixed(2)} / without ${without.toFixed(2)} → ${verdict}`;
}

/**
 * Family C: the parser already returns the DRAWN triangles, so the comparison reads the face array straight
 * out of the bytes. Reported as the up/down facing counts of each order — see the header on why.
 */
function windingDisagreement(buf: Buffer, clump: ReturnType<typeof parseDff>): null | string {
  const notes: string[] = [];
  for (const [index, geometry] of clump.geometries.entries()) {
    const faces = faceArrayTriangles(buf, index);
    if (!faces || faces.length === 0) continue;
    const drawn = facing(
      geometry.positions,
      geometry.triangles.map((t) => [t.a, t.b, t.c] as const),
    );
    const authored = facing(geometry.positions, faces);
    const delta = Math.abs(drawn.up - authored.up) + Math.abs(drawn.down - authored.down);
    if (delta > 0) {
      notes.push(
        `geom ${index}: drawn up ${drawn.up}/down ${drawn.down} vs face array up ${authored.up}/down ${authored.down} (${delta} faces)`,
      );
    }
  }

  return notes.length > 0 ? notes.join('; ') : null;
}
