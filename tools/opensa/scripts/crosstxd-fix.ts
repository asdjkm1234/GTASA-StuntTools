import { openArchive } from '@opensa/renderware';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { decodeToRgba, encodePng } from './lib/texture';

/**
 * Turn the pak build's `textures.crossTxd` ledger into reviewable PNG texture-folder fixes
 * (mod-installer plan 009): every texture the pack rescued from a DONOR txd is exported as an RGBA PNG
 * under `NO_COMMIT/crossTxdFix/<mod>/gta3_img/<txd>/<texture>.png`, where `<mod>` is the mod that should
 * carry the fix. After review, move each mod folder's content into `mods-src/original/mods/<mod>/gta3_img/` and
 * rebuild — the installer merges the PNGs into the txd, and the ledger entry disappears.
 *
 * Attribution rule: the LAST mod (install order) shipping any of the entry's model DFFs — but never
 * earlier than the last mod shipping `<txd>.txd` wholesale (a later whole-file txd would erase the
 * merge). No mod ships the DFF → the `Fixes` folder (sorts after every number → installs last).
 *
 * Excluded: textures present in the generic `models/generic/vehicle.txd` — SA resolves those through the
 * vehicle-generic parent at runtime; they are not missing data.
 *
 * Run: `npx tsx scripts/crosstxd-fix.ts [reportPath] [buildGameDir] [modsDir] [outDir]`
 * Defaults: build/original/opensa/pak/report.json (086 phase 8; older pak homes probed) ·
 * build/original/sa · mods-src/original/mods · NO_COMMIT/crossTxdFix
 */
const [
  reportPath = [
    'build/original/opensa/pak/report.json',
    'build/original/opensa-pack/report.json',
    'build/original/opensa/opensa/report.json',
  ].find((path) => existsSync(path)) ?? 'build/original/opensa/pak/report.json',
  buildGameDir = 'build/original/sa',
  modsDir = 'mods-src/original/mods',
  outDir = 'NO_COMMIT/crossTxdFix',
] = process.argv.slice(2);

interface CrossTxdEntry {
  donor: string;
  models: string[];
  texture: string;
  txd: string;
}
const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
  textures: { crossTxd: Record<string, CrossTxdEntry> };
};
const entries = Object.values(report.textures.crossTxd);
if (entries.length === 0) {
  console.log('crossTxd ledger is empty — nothing to fix');
  process.exit(0);
}

// The BUILD's archives carry the final (post-mods) donor txds — export exactly what the pack consumed.
// gta_int.img overlays as a fallback (interior donors: gyms, cameras, sex shops …), same merge the
// pack's AssetFileSystem uses.
const openImg = (name: string): null | ReturnType<typeof openArchive> => {
  const path = join(buildGameDir, 'models', name);
  if (!existsSync(path)) {
    return null;
  }
  const raw = readFileSync(path);

  return openArchive(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
};
const gta3 = openImg('gta3.img');
const gtaInt = openImg('gta_int.img');
const cutscene = openImg('cutscene.img');
if (!gta3) {
  throw new Error(`no gta3.img under ${buildGameDir}`);
}
const img = {
  get: (name: string): ArrayBuffer | null => gta3.get(name) ?? gtaInt?.get(name) ?? cutscene?.get(name) ?? null,
};

// Vehicle-generic filter: these resolve via SA's vehicle.txd parent, not missing data.
const genericNames = new Set<string>();
const genericPath = join(buildGameDir, 'models', 'generic', 'vehicle.txd');
if (existsSync(genericPath)) {
  const raw = readFileSync(genericPath);
  for (const tex of parseTxd(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)).textures) {
    genericNames.add(tex.name.toLowerCase());
  }
}

// Mod attribution index: bare lowercased file name → mods shipping it (install order).
const sortMods = (names: string[]): string[] =>
  [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), 'en', { numeric: true }));
const modNames = sortMods(
  readdirSync(modsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name),
);
const shippers = new Map<string, string[]>();
for (const mod of modNames) {
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(dir, entry.name));
      } else {
        const key = entry.name.toLowerCase();
        const list = shippers.get(key) ?? [];
        if (list[list.length - 1] !== mod) {
          list.push(mod);
        }
        shippers.set(key, list);
      }
    }
  };
  walk(join(modsDir, mod));
}
const lastShipper = (fileName: string): null | string => {
  const list = shippers.get(fileName.toLowerCase());

  return list ? list[list.length - 1] : null;
};

const decodedTxds = new Map<string, ReturnType<typeof parseTxd>>();
const txdOf = (name: string): null | ReturnType<typeof parseTxd> => {
  const key = name.toLowerCase();
  let parsed = decodedTxds.get(key);
  if (!parsed) {
    const bytes = img.get(`${key}.txd`);
    if (!bytes) {
      return null;
    }
    parsed = parseTxd(bytes);
    decodedTxds.set(key, parsed);
  }

  return parsed;
};

let written = 0;
let skippedGeneric = 0;
const failures: string[] = [];
const byMod = new Map<string, string[]>();
for (const entry of entries) {
  if (genericNames.has(entry.texture.toLowerCase())) {
    skippedGeneric += 1;
    continue;
  }
  const donor = txdOf(entry.donor);
  const texture = donor?.textures.find((t) => t.name.toLowerCase() === entry.texture.toLowerCase());
  if (!texture) {
    failures.push(`${entry.txd}/${entry.texture}: donor ${entry.donor}.txd missing or lacks the texture`);
    continue;
  }
  // Attribution: last mod shipping any of the models' DFFs, bumped past the last <txd>.txd shipper.
  const dffMods = entry.models.map((model) => lastShipper(`${model}.dff`)).filter((m): m is string => m !== null);
  const txdMod = lastShipper(`${entry.txd}.txd`);
  const candidates = [...dffMods, ...(txdMod ? [txdMod] : [])];
  const mod = candidates.length > 0 ? sortMods(candidates)[candidates.length - 1] : 'Fixes';
  const dir = join(outDir, mod, 'gta3_img', entry.txd.toLowerCase());
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${entry.texture}.png`), encodePng(texture.width, texture.height, decodeToRgba(texture)));
  written += 1;
  const list = byMod.get(mod) ?? [];
  list.push(
    `${entry.txd}/${entry.texture} (${texture.width}x${texture.height}, donor ${entry.donor}, models: ${entry.models.join(' ')})`,
  );
  byMod.set(mod, list);
}

console.log(
  `crossTxd entries: ${entries.length} · written: ${written} · vehicle-generic skipped: ${skippedGeneric} · failures: ${failures.length}`,
);
for (const [mod, list] of [...byMod.entries()].sort()) {
  console.log(`\n== ${mod} (${list.length})`);
  for (const line of list) {
    console.log(`  ${line}`);
  }
}
if (failures.length > 0) {
  console.log('\n== failures');
  for (const line of failures) {
    console.log(`  ${line}`);
  }
}
console.log(
  `\noutput: ${outDir} — review, then move each mod's gta3_img/ into mods-src/original/mods/<mod>/ and rebuild`,
);
