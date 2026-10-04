/**
 * cutscene-scm-sites — list every cutscene main.scm plays (135 `02E4 LOAD_CUTSCENE` sites), the
 * interior area its adjacent `04BB SET_AREA_VISIBLE` sets, and — per site on request — the opcode
 * sequence around it. This is the scan that settled the cutscene-override plan's step 0: main.scm
 * waits on `06B9 HAS_CUTSCENE_LOADED` between load and start (starting unloaded = degraded, no
 * camera/widescreen), the AREA comes from the script not the `.dat`, and the ONMISSION global is
 * `$409` (read from `0180 SET_ON_MISSION_FLAG`).
 *
 * The area decode here is the ADJACENT-BYTE heuristic (04BB with an i8 arg directly before 02E4 —
 * 54/135 sites); a `?` means the site needs a real instruction walk, not that it has no area.
 *
 * Run: `npx tsx scripts/debug/cutscene-scm-sites.ts [scene-regex] [--game <game>]`
 *      `npx tsx scripts/debug/cutscene-scm-sites.ts prolog` — opcode windows for PROLOG1/PROLOG3
 */
import { readFileSync } from 'node:fs';

import { gameArg, gameDir, positionalArgs } from '../lib/game';

const OPCODES: Readonly<Record<number, string>> = {
  0x016a: 'DO_FADE',
  0x016b: 'IS_FADING',
  0x0180: 'SET_ON_MISSION_FLAG',
  0x01b4: 'SET_PLAYER_CONTROL',
  0x02a3: 'SET_WIDESCREEN',
  0x02e4: 'LOAD_CUTSCENE',
  0x02e7: 'START_CUTSCENE',
  0x02e8: 'GET_CUTSCENE_TIME',
  0x02e9: 'HAS_CUTSCENE_FINISHED',
  0x02ea: 'CLEAR_CUTSCENE',
  0x0395: 'CLEAR_AREA',
  0x03cb: 'LOAD_SCENE',
  0x04bb: 'SET_AREA_VISIBLE',
  0x04e4: 'REQUEST_COLLISION',
  0x06b9: 'HAS_CUTSCENE_LOADED',
};

const scm = readFileSync(gameDir(gameArg(), 'data', 'script', 'main.scm'));
const [filterArg] = positionalArgs();
const filter = filterArg ? new RegExp(filterArg, 'i') : null;

interface Site {
  area: '?' | number;
  name: string;
  off: number;
}

/** Immediate 8-byte string arg (type 0x09) at `at`, or null if not one. */
function str8(at: number): null | string {
  if (scm[at] !== 0x09) return null;
  const raw = scm.subarray(at + 1, at + 9);
  const end = raw.indexOf(0);
  const text = raw.subarray(0, end === -1 ? 8 : end).toString('latin1');

  return /^[\x20-\x7e]+$/.test(text) ? text : null;
}

const sites: Site[] = [];
for (let i = 4; i + 10 < scm.length; i++) {
  if (scm[i] !== 0xe4 || scm[i + 1] !== 0x02) continue;
  const name = str8(i + 2);
  if (!name) continue;
  // 04BB with an i8 arg (type 0x04) sits directly before the 02E4 at most sites
  const adjacentArea = scm[i - 4] === 0xbb && scm[i - 3] === 0x04 && scm[i - 2] === 0x04;
  sites.push({ area: adjacentArea ? scm[i - 1] : '?', name, off: i });
}

for (let i = 0; i + 6 < scm.length; i++) {
  // 0180 with a global-var arg (type 0x02): the u16 offset / 4 is the $index
  if (scm[i] === 0x80 && scm[i + 1] === 0x01 && scm[i + 2] === 0x02) {
    console.log(`0180 SET_ON_MISSION_FLAG @ 0x${i.toString(16)} -> $${scm.readUInt16LE(i + 3) / 4}`);
  }
}
console.log(`${sites.length} LOAD_CUTSCENE sites (${new Set(sites.map((s) => s.name)).size} unique names)\n`);

if (!filter) {
  for (const site of sites) {
    console.log(`${site.name.padEnd(8)} area=${site.area} @ 0x${site.off.toString(16)}`);
  }
  process.exit(0);
}

/** Opcodes of interest in a byte window around `center` (offsets are relative, NOT a full decode). */
function windowScan(center: number, before: number, after: number): string[] {
  const out: string[] = [];
  for (let i = Math.max(0, center - before); i < Math.min(scm.length, center + after); i++) {
    const word = scm[i] | (scm[i + 1] << 8);
    const bare = word & 0x7fff;
    if (!(bare in OPCODES) || bare <= 0x100) continue;
    out.push(`${i >= center ? '+' : ''}${i - center} ${OPCODES[bare]}${word & 0x8000 ? ' [NOT]' : ''}`);
  }

  return out;
}

for (const site of sites.filter((s) => filter.test(s.name))) {
  console.log(`=== ${site.name} @ 0x${site.off.toString(16)} area=${site.area}`);
  console.log(`${windowScan(site.off, 300, 500).join('\n')}\n`);
}
