/**
 * `npm run timecyc` — a UTILITY, not a build stage (the user's call, 2026-08-22, plan 104/03).
 *
 * It reads a base timecyc, merges donor values onto it and writes ONE file into `merged/`. It writes
 * nowhere else: putting a table into a game tree is a deliberate act by whoever wants it shipped, and the
 * output must never be produced as a side effect of `pmb` or any other build — a build that regenerated the
 * sky would exit 0 and simply look different (see `docs/restrictions/timecyc-builder-is-a-utility.md`).
 */
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { TimecycManager } from './core/timecyc-manager';

/** The base is read from the game source; nothing is ever written back there. */
const baseTimecyc = join(__dirname, '..', '..', '..', 'game-src', 'original', 'data', 'timecyc.dat');
const output = resolve(__dirname, './merged/timecyc_24h.dat');

const init = async (): Promise<void> => {
  const manager = new TimecycManager();
  await manager.setBase(baseTimecyc); // original timecyc (not 24h)
  await manager.setTimecycToMerge([
    {
      path: resolve(__dirname, './merge/RealVision_Enhanced.dat'), // not 24h
      props: ['Amb', 'Amb_Obj', 'Sky top', 'Sky bot'],
      times: ['19h', '20h', '21h', '22h', '23h', '0h', '1h', '2h', '3h', '4h', '5h'],
    },
    {
      path: resolve(__dirname, './merge/RealVision_Enhanced.dat'), // not 24h
      zones: ['CLOUDY_LA'],
    },
  ]);
  await writeFile(output, manager.merge(), 'utf8');
  // eslint-disable-next-line no-console -- a CLI utility saying where its one output went
  console.log(`timecyc: wrote ${output}`);
};

void init();
