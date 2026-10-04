import type { OstexFormatId } from '@opensa/engine-formats/ostex';

import { OstexFormat, ostexLayerBytes, ostexMaxMips } from '@opensa/engine-formats/ostex';
import { existsSync } from 'node:fs';

import { readPakManifest } from '../lib/pak-dir';

/**
 * What a pak costs the GPU, and what it WOULD cost in another texture format (plan 200, chains 2 and 4).
 *
 * The question this answers is "how far is the full map from a phone", and it cannot be answered by the file
 * size: a pak's bytes on disk are deflated, while what a device has to hold is the decoded texture pyramid.
 * The manifest carries each array's format, size and layer count, so the pyramid is computable exactly —
 * `ostexLayerBytes` is the same function the runtime allocates against.
 *
 * The "what if" columns are the point, and since 2026-08-07 one of them is a build rather than a hypothetical:
 * `opensa-pack --textures astc` writes ASTC 4x4 at 1 byte per texel — the same as BC3/BC7, a quarter of the
 * `--rgba8` a no-BC GPU used to need. Run this against both paks of that A/B and the `by format as built`
 * block is the answer. ETC2 (which the 2026-08-04 device also HAS — `docs/edge-cases/browser-runtime.md`) is
 * still only a row here; nothing writes it.
 *
 * Run: `npx tsx scripts/debug/texture-budget.ts [pakDir]` (default `build/original/opensa/pak`).
 */
const pakDir =
  process.argv[2] ??
  ['build/original/opensa/pak', 'build/phone/pak', 'build/original/opensa-pack'].find((dir) => existsSync(dir)) ??
  'build/original/opensa/pak';

interface ArrayEntry {
  format: number;
  height: number;
  layers: number;
  length: number;
  rawLength?: number;
  width: number;
}
const manifest = readPakManifest<{
  buildTime?: string;
  cells: Record<string, unknown>;
  textures: Record<string, ArrayEntry>;
}>(pakDir);

const FORMAT_NAME: Record<number, string> = {
  [OstexFormat.ASTC4x4]: 'ASTC4x4',
  [OstexFormat.BC1]: 'BC1',
  [OstexFormat.BC2]: 'BC2',
  [OstexFormat.BC3]: 'BC3',
  [OstexFormat.BC7]: 'BC7',
  [OstexFormat.RGBA8]: 'RGBA8',
};

/** Bytes per TEXEL of the mip-0 level, mips included by the ×4/3 tail. ASTC 4x4 and ETC2 RGBA are one byte
 *  per texel by construction (a 16-byte block over 4×4 texels) — the same as BC3/BC7, a quarter of RGBA8. */
const HYPOTHETICAL: { label: string; texelBytes: number }[] = [
  { label: 'BC1 (desktop, SA passthrough)', texelBytes: 0.5 },
  { label: 'ETC2 RGB8 / ASTC 8x8', texelBytes: 0.5 },
  { label: 'ASTC 4x4 / ETC2 RGBA8 / BC3', texelBytes: 1 },
  { label: 'RGBA8 (what a no-BC device gets today)', texelBytes: 4 },
];

const mb = (bytes: number): string => `${(bytes / 1048576).toFixed(1)} MB`;

let gpuBytes = 0;
let diskBytes = 0;
let texels = 0;
let layers = 0;
const byFormat = new Map<string, { arrays: number; bytes: number }>();
const bySize = new Map<number, number>();

for (const entry of Object.values(manifest.textures)) {
  const format = entry.format as OstexFormatId;
  const mips = ostexMaxMips(format, entry.width, entry.height);
  const bytes = ostexLayerBytes(format, entry.width, entry.height, mips) * entry.layers;
  gpuBytes += bytes;
  diskBytes += entry.length;
  texels += entry.width * entry.height * entry.layers;
  layers += entry.layers;
  const name = FORMAT_NAME[entry.format] ?? `unknown(${entry.format})`;
  const seen = byFormat.get(name) ?? { arrays: 0, bytes: 0 };
  byFormat.set(name, { arrays: seen.arrays + 1, bytes: seen.bytes + bytes });
  const edge = Math.max(entry.width, entry.height);
  bySize.set(edge, (bySize.get(edge) ?? 0) + entry.layers);
}

console.log(`pak ${pakDir}${manifest.buildTime ? ` (built ${manifest.buildTime})` : ''}`);
console.log(`${Object.keys(manifest.cells).length} cell entries · ${Object.keys(manifest.textures).length} arrays`);
console.log(`${layers} layers, ${(texels / 1e6).toFixed(1)} M texels at mip 0`);
console.log(`\non disk (deflated): ${mb(diskBytes)}`);
console.log(`resident on the GPU, every array at once: ${mb(gpuBytes)}`);

console.log('\nby format as built:');
for (const [name, stat] of [...byFormat].sort((a, b) => b[1].bytes - a[1].bytes)) {
  console.log(`  ${name.padEnd(8)} ${String(stat.arrays).padStart(4)} arrays  ${mb(stat.bytes).padStart(10)}`);
}

// The mip tail is 1/3 of mip 0 for every block format and for RGBA8 alike, so one factor covers the lot.
console.log('\nthe same content, if every array were:');
for (const option of HYPOTHETICAL) {
  console.log(`  ${option.label.padEnd(38)} ${mb(texels * option.texelBytes * (4 / 3)).padStart(10)}`);
}

console.log('\nlayers by longest edge (what --max-texture moves):');
for (const [edge, count] of [...bySize].sort((a, b) => b[0] - a[0])) {
  console.log(`  ${String(edge).padStart(5)} px  ${count}`);
}
console.log(
  '\nNB the GPU figure is every array RESIDENT AT ONCE — the runtime streams arrays with the cells that\n' +
    'draw them, so a drive holds a subset. It is the ceiling, and the number a full-map decision is made on.',
);
