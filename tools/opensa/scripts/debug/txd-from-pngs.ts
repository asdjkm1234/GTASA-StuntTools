import { emptyTxd, mergeTxdBytes } from '@opensa/mod-installer/txd-folder';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { readRw, RW_TEXTURE_DICTIONARY } from '@opensa/rw-codec/chunk';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/**
 * Build a `.txd` from a folder of PNGs — the missing half of the texture-folder convention
 * (`docs/contracts/mods.md`): a texture folder PATCHES a dictionary that already exists, and a mod that
 * ships the PNGs of a WHOLE dictionary has none to patch, so every texture is dropped with a warning and
 * the models naming it render untextured.
 *
 * Real case it was written for: "52. Abandoned Cars" shipped `gta3_img/philss/` (22 PNGs) while
 * "0. Map Fixes Pack" repointed `cuntwjunk04` at a `philss` dictionary nobody shipped — the 22 PNGs were
 * exactly that model's 22 textures.
 *
 * The RW version is READ from a sibling dictionary rather than assumed: by default the largest `.txd` next
 * to the folder, or `--version-from <file.txd>`. Each texture's format follows its own image — DXT5 when the
 * PNG carries real alpha, DXT1 when it does not — which is the same rule the installer's merge applies.
 *
 * Run: `npx tsx scripts/debug/txd-from-pngs.ts <folder> [out.txd] [--version-from <file.txd>] [--replace]`
 * `--replace` deletes the PNG folder once the dictionary is written (what a mod wants: the folder was the
 * unpacked form of the file). Writes `<folder>.txd` beside the folder when no output path is given.
 */
function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

const positional = process.argv.slice(2).filter((arg, index, all) => {
  const previous = all[index - 1];

  return !arg.startsWith('--') && previous !== '--version-from';
});
const [folder, outArg] = positional;
if (!folder || !existsSync(folder)) {
  console.error(
    'usage: npx tsx scripts/debug/txd-from-pngs.ts <folder> [out.txd] [--version-from <t.txd>] [--replace]',
  );
  process.exit(1);
}
const out = outArg ?? `${folder.replace(/\/$/, '')}.txd`;

/** The RW version of a dictionary — a mod's own files are the only honest source for it. */
function versionOf(path: string): number {
  const bytes = readFileSync(path);
  const chunk = readRw(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)).chunks.find(
    (candidate) => candidate.type === RW_TEXTURE_DICTIONARY,
  );
  if (!chunk) {
    throw new Error(`not a TXD: ${path}`);
  }

  return chunk.version;
}

const explicit = flag('version-from');
const siblings = explicit
  ? [explicit]
  : readdirSync(dirname(out))
      .filter((name) => /\.txd$/i.test(name) && name !== basename(out))
      .map((name) => join(dirname(out), name));
if (siblings.length === 0) {
  console.error(`no sibling .txd to read the RW version from — pass --version-from <file.txd>`);
  process.exit(1);
}
const version = versionOf(siblings[0]);

const { bytes, merged } = mergeTxdBytes(folder, emptyTxd(version), out);
if (merged === 0) {
  console.error(`no PNGs in ${folder}`);
  process.exit(1);
}
writeFileSync(out, bytes);
if (process.argv.includes('--replace')) {
  rmSync(folder, { force: true, recursive: true });
}

const txd = parseTxd(Uint8Array.from(bytes).buffer);
console.log(
  `${out} — ${txd.textures.length} textures, ${(bytes.length / 1024).toFixed(0)} KB, ` +
    `RW 0x${version.toString(16)} (from ${basename(siblings[0])})`,
);
for (const texture of txd.textures) {
  console.log(`  ${texture.name} ${texture.width}x${texture.height} ${texture.format}`);
}
