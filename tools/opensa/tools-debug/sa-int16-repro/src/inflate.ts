import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type DummyModel,
  FILLER_ROWS_PER_AREA,
  fillerIplText,
  gridPositions,
  type InflationPlan,
  planInflation,
  TEXT_IPL_SLOT_CAP,
  type Vec3,
} from './plan';

/** Base of the world grid the filler entities sit on — far past the ±3000 playable map, deep underground. */
const FILLER_ORIGIN: Vec3 = [3200, 3200, -1000];
const FILLER_AREA_BASE = 'i16f';

export interface InflateOptions {
  /** Allow the build to exceed 39 text-IPL slots — trades isolation for reach (entangles IplEntityIndexArrays). */
  readonly allowSlotOverflow?: boolean;
  /** Built SA game dir to read from (never modified). */
  readonly gamePath: string;
  /** Override the harvested dummy model (id must be a valid loadable stock model). */
  readonly model?: DummyModel;
  /** Output dir — a full copy of `gamePath` with the synthetic rows added. */
  readonly outPath: string;
  /** Target TOTAL permanent text-IPL rows map-wide (e.g. 33000 to cross 2^15, 32000 to stay clean). */
  readonly targetRows: number;
}

export interface InflateReport {
  readonly base: { readonly rows: number; readonly slots: number };
  readonly crossed2p15: boolean;
  readonly final: { readonly rows: number; readonly slots: number };
  readonly model: DummyModel;
  readonly plan: InflationPlan;
}

/** Count total permanent text-IPL inst rows + inst-bearing slots — same walk as perfect-map-builder's guard. */
export function countTextRows(gameDir: string): { rows: number; slots: number } {
  const datPath = join(gameDir, 'data', 'gta.dat');
  if (!existsSync(datPath)) {
    throw new Error(`no gta.dat under ${gameDir} — point --game at a built SA game dir`);
  }
  let slots = 0;
  let rows = 0;
  for (const line of readFileSync(datPath, 'utf8').split(/\r?\n/)) {
    const match = /^IPL\s+(\S.*)$/i.exec(line.trim());
    if (!match || match[1].toLowerCase().endsWith('.zon')) {
      continue;
    }
    const file = join(gameDir, match[1].replace(/\\/g, '/'));
    const count = existsSync(file) ? parseIpl(readFileSync(file, 'utf8')).length : 0;
    if (count > 0) {
      slots += 1;
      rows += count;
    }
  }

  return { rows, slots };
}

/**
 * Inflate a built SA game dir to `targetRows` total permanent text-IPL rows and write it to `outPath` — the fast,
 * deterministic repro for the int16 ghost-barriers bug. Copies the base, tops it up with dense filler text IPLs,
 * appends their gta.dat lines, and re-counts. Logs the isolation numbers (slots ≤ 39, single adjuster is the
 * caller's responsibility) so a crash past 2^15 is attributable to int16 alone. (The bug reproduces from the row
 * count itself — the stock binary streams corrupt once the count crosses 2^15, no seeded cluster needed.)
 */
export function inflate(options: InflateOptions): InflateReport {
  const { allowSlotOverflow, gamePath, outPath, targetRows } = options;
  if (gamePath === outPath) {
    throw new Error('--out must differ from --game (the dial always starts from the pristine base)');
  }
  cpSync(gamePath, outPath, { force: true, recursive: true });

  const datPath = join(outPath, 'data', 'gta.dat');
  const base = countTextRows(outPath);
  const model = options.model ?? pickDummyModel(outPath);
  const plan = planInflation({ baseRows: base.rows, baseSlots: base.slots, targetRows });

  if (plan.totalSlots > TEXT_IPL_SLOT_CAP && !allowSlotOverflow) {
    throw new Error(
      `this build would use ${plan.totalSlots} text-IPL slots (> ${TEXT_IPL_SLOT_CAP}) — IplEntityIndexArrays ` +
        `would overflow FIRST and mask int16. Use a base already nearer 2^15 (fewer filler areas), or pass ` +
        `--allow-slot-overflow to force the entangled build.`,
    );
  }

  const datLines: string[] = [];
  writeFillerAreas(outPath, model, plan.fillerRows, datLines);
  appendDatLines(datPath, datLines);

  const final = countTextRows(outPath);
  const report: InflateReport = {
    base,
    crossed2p15: final.rows > 32767,
    final,
    model,
    plan,
  };
  logReport(report);

  return report;
}

/** First valid stock building id (1..18630) from any inst-bearing text IPL — a guaranteed-loadable dummy that
 *  sidesteps the id-match hygiene trap (an IDE whose ids don't match its IPL silently skips all instances). */
export function pickDummyModel(gameDir: string): DummyModel {
  const datPath = join(gameDir, 'data', 'gta.dat');
  for (const line of readFileSync(datPath, 'utf8').split(/\r?\n/)) {
    const match = /^IPL\s+(\S.*)$/i.exec(line.trim());
    if (!match || match[1].toLowerCase().endsWith('.zon')) {
      continue;
    }
    const file = join(gameDir, match[1].replace(/\\/g, '/'));
    if (!existsSync(file)) {
      continue;
    }
    for (const inst of parseIpl(readFileSync(file, 'utf8'))) {
      if (inst.id >= 1 && inst.id <= 18630 && inst.modelName) {
        return { id: inst.id, name: inst.modelName };
      }
    }
  }
  throw new Error(`no usable stock model id found in ${gameDir} — pass --model-id/--model-name`);
}

function appendDatLines(datPath: string, datLines: string[]): void {
  if (datLines.length === 0) {
    return;
  }
  const dat = readFileSync(datPath, 'utf8');
  const eol = dat.includes('\r\n') ? '\r\n' : '\n';
  writeFileSync(datPath, `${dat.replace(/\s*$/, '')}${eol}${datLines.join(eol)}${eol}`);
}

function logReport(r: InflateReport): void {
  const { base, crossed2p15, final, model, plan } = r;
  console.log(`sa-int16-repro: dummy model ${model.id} (${model.name})`);
  console.log(`  base:  ${base.rows} rows / ${base.slots} slots`);
  console.log(`  added: ${plan.addRows} rows (${plan.fillerRows} filler in ${plan.fillerAreas} areas)`);
  console.log(`  final: ${final.rows} rows / ${final.slots}/${TEXT_IPL_SLOT_CAP} slots`);
  console.log(`  2^15 (32768): ${crossed2p15 ? 'CROSSED → expect the bug' : 'not crossed → expect clean'}`);
  console.log('  isolation: per-file boot rows ≤ 4096 ✓, single limit adjuster is the caller’s responsibility');
}

function writeFillerAreas(outPath: string, model: DummyModel, fillerRows: number, datLines: string[]): void {
  const mapsDir = join(outPath, 'data', 'maps');
  mkdirSync(mapsDir, { recursive: true });
  let written = 0;
  let area = 0;
  while (written < fillerRows) {
    const chunk = Math.min(FILLER_ROWS_PER_AREA, fillerRows - written);
    // Offset each area on Y so the grids don't overlap — keeps every filler cell sparse.
    const origin: Vec3 = [FILLER_ORIGIN[0], FILLER_ORIGIN[1] + area * 800, FILLER_ORIGIN[2]];
    const name = `${FILLER_AREA_BASE}${area}`;
    writeFileSync(join(mapsDir, `${name}.ipl`), fillerIplText(model, gridPositions(chunk, origin)));
    datLines.push(`IPL DATA\\MAPS\\${name}.IPL`);
    written += chunk;
    area += 1;
  }
}
