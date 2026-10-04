import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { fromCwd } from '@opensa/tool-kit/cli';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

/**
 * What a vehicle DFF's materials say about REFLECTION, per material and as a histogram — and, given two files,
 * exactly which of those numbers moved.
 *
 * The two numbers a car's shine is made of live in different plugin chunks, and confusing them is why a
 * `vehicle-optimizer --prototype` run once looked like a no-op (plan 003's ledger):
 * - **MatFX env-map `coefficient`** — the mirror-the-world strength, and the author's MARKING of which
 *   surfaces reflect at all (body, glass, chrome). Absent on most materials.
 * - **SA reflection `intensity`** (`0x253f2fc`) — present on nearly EVERY material of a stock or mod car, so
 *   its histogram says almost nothing about which parts you actually see shine. The install's SkyGfx vehicle
 *   pipe multiplies it by 8, so anything at or above 0.125 is saturated and looks identical.
 * - **SA specular `level`** (`0x253f2f6`) — the HIGHLIGHT, multiplied by 3 by that pipe, and the term a field
 *   report about "too shiny" usually turns out to mean (yankee 0.26-0.56 against a tasteful 0.05).
 *
 * A value of 0 means "this part does not reflect" — count those apart from a missing chunk.
 *
 * ```sh
 * npx tsx scripts/debug/dff-reflection.ts <car.dff> [more.dff…]   # one table + histogram per file
 * npx tsx scripts/debug/dff-reflection.ts <before.dff> <after.dff> --diff   # only what changed
 * ```
 */
interface MaterialRow {
  coefficient: null | number;
  intensity: null | number;
  specular: null | number;
  texture: string;
}

function histogram(values: readonly (null | number)[]): string {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value !== null) {
      counts.set(show(value), (counts.get(show(value)) ?? 0) + 1);
    }
  }

  return (
    [...counts]
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([value, count]) => `${value}×${count}`)
      .join(' ') || 'none'
  );
}

function rows(path: string): MaterialRow[] {
  const bytes = new Uint8Array(readFileSync(fromCwd(path)));
  const clump = parseDff(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

  return clump.geometries.flatMap((geometry) =>
    geometry.materials.map((material) => ({
      coefficient: material.effects?.envMap ? material.effects.envMap.coefficient : null,
      intensity: material.effects?.reflection ? material.effects.reflection.intensity : null,
      specular: material.effects?.specular ? material.effects.specular.level : null,
      texture: material.texture?.name?.toLowerCase() ?? '(untextured)',
    })),
  );
}

function show(value: null | number): string {
  return value === null ? '—' : value.toFixed(3);
}

/** Per texture: how many materials, and the distinct values they carry. */
function table(list: readonly MaterialRow[]): string[] {
  const byTexture = new Map<string, { coefficients: Set<string>; count: number; intensities: Set<string> }>();
  for (const row of list) {
    const entry = byTexture.get(row.texture) ?? { coefficients: new Set(), count: 0, intensities: new Set() };
    entry.count += 1;
    if (row.coefficient !== null) {
      entry.coefficients.add(show(row.coefficient));
    }
    if (row.intensity !== null) {
      entry.intensities.add(show(row.intensity));
    }
    byTexture.set(row.texture, entry);
  }

  return [...byTexture]
    .sort((a, b) => b[1].count - a[1].count)
    .map(
      ([texture, entry]) =>
        `  ${texture.padEnd(22)} ×${String(entry.count).padStart(3)}  env-map [${[...entry.coefficients].join(', ') || '—'}]` +
        `  reflection [${[...entry.intensities].join(', ') || '—'}]`,
    );
}

const files = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
if (files.length === 0) {
  console.error('usage: npx tsx scripts/debug/dff-reflection.ts <car.dff> [more.dff…] [--diff]');
  process.exit(1);
}

const diff = process.argv.includes('--diff');
const parsed = files.map((path) => ({ list: rows(path), path }));

for (const { list, path } of parsed) {
  const marked = list.filter((row) => (row.coefficient ?? 0) !== 0).length;
  console.log(`\n=== ${basename(path)} — ${list.length} material(s)`);
  console.log(
    `  env-map marked (non-zero): ${marked}  |  reflection chunks: ${list.filter((r) => r.intensity !== null).length}`,
  );
  console.log(`  env-map coefficient: ${histogram(list.map((r) => r.coefficient))}`);
  console.log(`  reflection intensity: ${histogram(list.map((r) => r.intensity))}`);
  console.log(`  specular level: ${histogram(list.map((r) => r.specular))}`);
  if (!diff) {
    table(list).forEach((line) => console.log(line));
  }
}

if (diff && parsed.length === 2) {
  const [before, after] = parsed;
  if (before.list.length !== after.list.length) {
    console.log(`\nmaterial counts differ (${before.list.length} vs ${after.list.length}) — not comparable per index`);
  } else {
    const changed = before.list
      .map((row, index) => ({ after: after.list[index], before: row, index }))
      .filter(
        ({ after: b, before: a }) =>
          a.coefficient !== b.coefficient || a.intensity !== b.intensity || a.specular !== b.specular,
      );
    console.log(`\n=== changed: ${changed.length} of ${before.list.length} material(s)`);
    for (const { after: b, before: a, index } of changed.slice(0, 40)) {
      console.log(
        `  #${String(index).padStart(3)} ${a.texture.padEnd(22)} env-map ${show(a.coefficient)} → ${show(b.coefficient)}` +
          `   reflection ${show(a.intensity)} → ${show(b.intensity)}` +
          `   specular ${show(a.specular)} → ${show(b.specular)}`,
      );
    }
    if (changed.length > 40) {
      console.log(`  … ${changed.length - 40} more`);
    }
  }
}
