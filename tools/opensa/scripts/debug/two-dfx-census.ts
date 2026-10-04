import { openArchive } from '@opensa/renderware/archive/img-archive';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { toArrayBuffer } from '@opensa/renderware/test-utils';
import { extract2dfxEntries } from '@opensa/rw-codec/dff';

import { gameArg, openGameArchive, readBytes } from '../lib/game';

/**
 * Census every 2d-effect entry in an archive's models: entries and models per TYPE, plus the payload sizes
 * seen per type. This is the denominator a "we carried N of M" claim needs when a LOD step starts keeping
 * more than lights (plan 07).
 *
 * Unlike `find-2dfx.ts` — which byte-steps looking for the 2dfx chunk id and therefore picks up false
 * positives (it reports particle names full of binary garbage) — this walks the real RW chunk tree via
 * `extract2dfxEntries`, so its counts are the ones to quote.
 *
 * Run: `npx tsx scripts/debug/two-dfx-census.ts [--game original]` (the variant's stock archives) or
 * `--img <path.img>` for one archive — e.g. `build/original/opensa/models/gta3.img`, the merged input a
 * build actually reads, which is NOT the same corpus as `game-src/`.
 */

/** Every type id a 2dfx entry can carry — `extract2dfxEntries` drops particles unless asked for them. */
const ALL_TYPES = new Set(Array.from({ length: 32 }, (_, index) => index));
/** gtamods' names for the types, for a readable table. */
const TYPE_NAMES = new Map([
  [0, 'light'],
  [1, 'particle'],
  [2, 'unknown'],
  [3, 'ped attractor'],
  [4, 'sun glare'],
  [6, 'enter/exit'],
  [7, 'roadsign'],
  [8, 'trigger point'],
  [9, 'cover point'],
  [10, 'escalator'],
]);

const entries = new Map<number, number>();
const models = new Map<number, number>();
const sizes = new Map<number, Set<number>>();

const imgFlag = process.argv.indexOf('--img');
const source = imgFlag >= 0 && process.argv[imgFlag + 1];
const archive = source ? openArchive(readBytes(source)) : openGameArchive(gameArg());
/** `--frames`: also parse each fx-carrying model and report the frames its fx geometries hang off. */
const withFrames = process.argv.includes('--frames');
const frames = { rotating: [] as string[], scaled: [] as string[], translating: [] as string[] };

let scanned = 0;
let failed = 0;
for (const name of archive.names) {
  if (!name.toLowerCase().endsWith('.dff')) {
    continue;
  }
  const buffer = archive.get(name);
  if (!buffer) {
    continue;
  }
  scanned += 1;
  let found: ReturnType<typeof extract2dfxEntries>;
  try {
    found = extract2dfxEntries(new Uint8Array(buffer), ALL_TYPES);
  } catch {
    failed += 1; // a DFF our chunk reader refuses — counted, never silently skipped
    continue;
  }
  const seen = new Set<number>();
  for (const entry of found) {
    entries.set(entry.type, (entries.get(entry.type) ?? 0) + 1);
    seen.add(entry.type);
    const perType = sizes.get(entry.type) ?? new Set<number>();
    perType.add(entry.bytes.length - 20);
    sizes.set(entry.type, perType);
  }
  for (const type of seen) {
    models.set(type, (models.get(type) ?? 0) + 1);
  }
  if (withFrames && found.length > 0) {
    scanFrames(new Uint8Array(buffer), name, found);
  }
}

console.log(`\n2dfx census — ${source || `game-src/${gameArg()}`}: ${scanned} models scanned, ${failed} unreadable\n`);
console.log('  type                 entries   models   payload sizes');
for (const [type, count] of [...entries.entries()].sort((a, b) => a[0] - b[0])) {
  const label = `${String(type).padStart(2)} ${(TYPE_NAMES.get(type) ?? '?').padEnd(15)}`;
  const seenSizes = [...(sizes.get(type) ?? [])].sort((a, b) => a - b).join(', ');
  console.log(`  ${label} ${String(count).padStart(7)}  ${String(models.get(type) ?? 0).padStart(7)}   ${seenSizes}`);
}

if (withFrames) {
  // Why this matters: a LOD carries an entry through its geometry's frame. Only a ROTATING frame can change a
  // payload (a plate's facing, an escalator's step path); a SCALED one is refused outright by
  // `transform2dfxEntry`. So these three counts say whether a payload-aware carry can move any output at all.
  console.log('\n  fx-geometry frames:');
  for (const [kind, list] of Object.entries(frames)) {
    console.log(`    ${kind.padEnd(12)} ${String(list.length).padStart(5)}   ${list.slice(0, 8).join(' ')}`);
  }
}

/** Record the frames the model's fx-carrying geometries hang off (rotating / translating / scaled). */
function scanFrames(bytes: Uint8Array, name: string, found: ReturnType<typeof extract2dfxEntries>): void {
  const clump = parseDff(toArrayBuffer(bytes));
  const carriers = new Set(found.map((entry) => entry.geometryIndex));
  for (const atomic of clump.atomics) {
    const frame = carriers.has(atomic.geometryIndex) ? clump.frames[atomic.frameIndex] : undefined;
    if (!frame) {
      continue;
    }
    const r = frame.rotation;
    const axes = [Math.hypot(r[0], r[1], r[2]), Math.hypot(r[3], r[4], r[5]), Math.hypot(r[6], r[7], r[8])];
    if (axes.some((length) => Math.abs(length - 1) > 1e-3)) {
      frames.scaled.push(name);
    }
    if (r.some((value, index) => Math.abs(value - (index % 4 === 0 ? 1 : 0)) > 1e-3)) {
      frames.rotating.push(name);
    }
    if (frame.position.some((value) => Math.abs(value) > 1e-6)) {
      frames.translating.push(name);
    }
  }
}
