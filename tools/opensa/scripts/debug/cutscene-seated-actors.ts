import { openArchive } from '@opensa/renderware/archive/img-archive';
import { readFileSync } from 'node:fs';

import { judgeRide, readRootChannels } from '../../tools/vehicle-cutscene/src/seat-patch';

/**
 * cutscene-seated-actors — which cutscenes seat an ACTOR inside a converted CAR, and the car-local
 * offset they ride at. The census behind plan 005 (seat retarget) and the way to see what its patch
 * pass will and will not touch: a cutscene actor's position is ABSOLUTE out of `anim/cuts.img` while
 * `ped_frontseat` is read by GAMEPLAY only, so a donor whose cabin rides higher than R*'s seats its
 * occupants low (measured 0.281 m on SMOKE2B) and nothing in the model can fix it.
 *
 * The walk and the ride test are IMPORTED from the tool (`seat-patch.ts`) rather than copied, so this
 * view can never disagree with what the patch actually does. Two traps live in that module: a track
 * shorter than the scene is a static pose and holds its last value (a parked car gets 5 keyframes, and
 * comparing only the overlap made the first census miss RIOT_4B's greenwood entirely), and props ride
 * vehicles too (an ammo box on the bobcat's bed) — the caller decides what is a person.
 *
 * The `seated %` column is what decides whether a pair may be patched at all: an actor who walks up and
 * gets in is seated for only part of the scene, and lifting his whole root track would float him while
 * he walks. The patch pass takes 98 % and up.
 *
 * Run: `npx tsx scripts/debug/cutscene-seated-actors.ts <cuts.img> <car,car,...>`
 *      `npx tsx scripts/debug/cutscene-seated-actors.ts build/original/opensa/anim/cuts.img csglendale92,csbravura`
 */
const [imgPath, carList] = process.argv.slice(2);
if (!imgPath || !carList) {
  throw new Error('usage: cutscene-seated-actors.ts <cuts.img> <car,car,...>');
}

const cars = new Set(carList.split(',').map((name) => name.trim().toLowerCase()));
const archive = openArchive(new Uint8Array(readFileSync(imgPath)));

for (const entry of archive.names.filter((name) => name.endsWith('.ifp')).sort()) {
  const roots = readRootChannels(new Uint8Array(archive.get(entry)!));
  const scene = entry.replace('.ifp', '').toUpperCase();
  for (const [car, carChannel] of roots) {
    if (!cars.has(car)) {
      continue;
    }
    for (const [actor, actorChannel] of roots) {
      if (cars.has(actor)) {
        continue;
      }
      const ride = judgeRide(actorChannel.translations, carChannel.translations);
      if (ride) {
        console.log(
          `${scene.padEnd(9)} ${car.padEnd(15)} ${actor.padEnd(15)} ` +
            `offset=[${ride.offset.map((v) => v.toFixed(2)).join(', ')}] ` +
            `spread=${ride.spread.toFixed(3)} seated ${ride.percent.toFixed(0)}% of ${ride.frames} frames`,
        );
      }
    }
  }
}
