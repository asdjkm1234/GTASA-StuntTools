/**
 * cutscene-anim-channels — list which BONES a cutscene animation drives, per object, with the keyframe
 * kind (KRT0 = rotation+translation, KR00 = rotation only) and frame count. The cutscene IFPs in
 * `anim/cuts.img` are the old ANPK format (the engine parser reads ANP3 only), chunks 4-byte aligned:
 * `NAME` = the OBJECT (model) the following `DGAN` drives; each `CPAN`→`ANIM` = one bone channel (28-char
 * name + frame count), its keyframe block follows as a sibling.
 *
 * This settled vehicle-cutscene's gate 7 in one shot: the taxi's opening door is `door_rr_hi_ok` — a
 * KR00 channel that bound to NOTHING because the mod misnames that door (`door_lr_ok` under
 * `door_rr_dummy`), and the channel table also proved every bone gets a NAME-bound channel (2-frame
 * static KRT0s included), which is why converted rigs must keep the vanilla locals as bind pose.
 *
 * Run: `npx tsx scripts/debug/cutscene-anim-channels.ts <entry.ifp> [object-name-regex] [--game <game>]`
 *      `npx tsx scripts/debug/cutscene-anim-channels.ts prolog3.ifp "taxi|carla"`
 */
import { openArchive } from '@opensa/renderware/archive/img-archive';
import { readFileSync } from 'node:fs';

import { gameArg, gameDir, positionalArgs } from '../lib/game';

const [entry, filterArg] = positionalArgs();
if (!entry) {
  throw new Error('usage: tsx scripts/debug/cutscene-anim-channels.ts <entry.ifp> [object-regex] [--game <game>]');
}
const filter = filterArg ? new RegExp(filterArg, 'i') : null;

const cuts = openArchive(new Uint8Array(readFileSync(gameDir(gameArg(), 'anim', 'cuts.img'))));
const bytes = cuts.get(entry.toLowerCase());
if (!bytes) {
  throw new Error(
    `no ${entry} in cuts.img (entries: ${[...cuts.names].filter((n) => n.endsWith('.ifp')).length} ifps)`,
  );
}
const data = new Uint8Array(bytes);
const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
const tag = (at: number): string => String.fromCharCode(data[at], data[at + 1], data[at + 2], data[at + 3]);
const cstr = (at: number, max: number): string => {
  let out = '';
  for (let i = 0; i < max && data[at + i] !== 0; i++) {
    out += String.fromCharCode(data[at + i]);
  }

  return out;
};
const align = (value: number): number => (value + 3) & ~3;

let pos = 8; // inside the ANPK container
let object = '';
while (pos + 8 <= data.length) {
  const kind = tag(pos);
  const size = view.getUint32(pos + 4, true);
  if (kind === 'NAME') {
    object = cstr(pos + 8, size);
    pos = align(pos + 8 + size);
  } else if (kind === 'DGAN' || kind === 'CPAN') {
    pos += 8; // containers: descend
  } else if (kind === 'ANIM') {
    const bone = cstr(pos + 8, 28);
    const frames = view.getUint32(pos + 36, true);
    const keyframesAt = align(pos + 8 + size);
    const keyKind = keyframesAt + 8 <= data.length ? tag(keyframesAt) : '????';
    if (!filter || filter.test(object)) {
      console.log(object.padEnd(16), bone.padEnd(24), 'frames', String(frames).padStart(4), keyKind);
    }
    pos = keyframesAt;
  } else {
    pos = align(pos + 8 + size); // INFO / keyframe blocks / unknowns
  }
}
