import { openArchive } from '@opensa/renderware/archive/img-archive';
import { type IfpAnimation, parseIfp } from '@opensa/renderware/parsers/binary/ifp';
import { argValue } from '@opensa/tool-kit/cli';
/**
 * What the game's animation archives actually CARRY for a vehicle anim group: per IFP every clip with its
 * bone count, keyframe count and whether it moves the root — the census behind plan 098/12 (no wheelie
 * clip exists anywhere; `Left/Right/Back/Fwd` are 2–7-frame poses). Re-run it after a mod overrides a
 * ride IFP by bare name, and before a resolution table is trusted.
 *
 *   npx tsx scripts/debug/anim-census.ts [--img game-src/original/anim/anim.img] [--groups bikes,bmx,quad]
 *                                        [--ped game-src/original/anim/ped.ifp] [--match bike|bmx|quad]
 *
 * `--groups all` lists every IFP in the archive. `--match` is the regex applied to `ped.ifp` clip names.
 */
import { readFileSync } from 'node:fs';

const RIDE_GROUPS = ['bikes', 'biked', 'bikeh', 'bikev', 'wayfarer', 'bmx', 'mtb', 'choppa', 'quad'];

function describe(anim: IfpAnimation): string {
  const frames = Math.max(...anim.bones.map((bone) => bone.frames.length));
  const root = anim.bones.some((bone) => bone.frames.some((frame) => frame.translation !== undefined));
  const bones = String(anim.bones.length).padStart(2);

  return `  ${anim.name.padEnd(22)} bones=${bones} frames=${String(frames).padStart(3)}${root ? ' root-motion' : ''}`;
}

const imgPath = argValue('--img') ?? 'game-src/original/anim/anim.img';
const pedPath = argValue('--ped') ?? 'game-src/original/anim/ped.ifp';
const match = new RegExp(argValue('--match') ?? 'bike|bmx|quad', 'i');
const groupsArg = argValue('--groups') ?? RIDE_GROUPS.join(',');

const img = openArchive(new Uint8Array(readFileSync(imgPath)));
const groups = groupsArg === 'all' ? img.names.map((name) => name.replace(/\.ifp$/i, '')) : groupsArg.split(',');
console.log(`${imgPath}: ${img.names.length} entries`);

for (const group of groups) {
  const bytes = img.get(`${group}.ifp`);
  if (bytes === null) {
    console.log(`\n== ${group}.ifp: ABSENT`);
    continue;
  }
  const anims = parseIfp(bytes);
  console.log(`\n== ${group}.ifp: ${anims.length} clips`);
  for (const anim of anims) {
    console.log(describe(anim));
  }
}

const ped = parseIfp(new Uint8Array(readFileSync(pedPath)).buffer);
const matched = ped.filter((anim) => match.test(anim.name));
console.log(`\n== ${pedPath}: ${matched.length} of ${ped.length} clips match /${match.source}/`);
for (const anim of matched) {
  console.log(describe(anim));
}
