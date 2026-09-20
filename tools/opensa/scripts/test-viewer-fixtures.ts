import { type ImgArchive, openArchive } from '@opensa/renderware/archive/img-archive';
import { buildCollisionIndex, getCollision } from '@opensa/renderware/collision/collision-index';
/**
 * Build the object-viewer's **e2e fixtures** into `fixtures/viewer/` by extracting from a clean, UNMODIFIED GTA
 * San Andreas copy under `game-src/original` (the same source `test-fixtures.ts` uses). Chained after
 * `test-fixtures.ts` by `npm run test:fixtures` (renamed from `test-viewer-fixtures.ts` — plan 086 phase 6); the output is Rockstar assets, so `fixtures/viewer/` is
 * gitignored (like `fixtures/original/`) and every contributor regenerates it locally.
 *
 * At runtime the viewers load from the compare server (`--after`); these static fixtures exist ONLY so the
 * object-viewer e2e can render real geometry in CI without the full game archive. `serve-static` maps
 * `/viewer/*` → `fixtures/viewer/*`, and the object-viewer loads `objects/manifest.json` only in `--mode e2e`.
 *
 * Produces (extracted from `gta3.img`/`gta_int.img`):
 *   objects/  the object-viewer's models + their txds, a pre-baked `<model>.col.json` (map-object collision
 *             lives in the IMG, not the DFF), and `manifest.json` (the models the e2e viewer lists + renders).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = join('game-src', 'original');
const ARCHIVES = ['models/gta3.img', 'models/gta_int.img'];
const OUT = 'fixtures/viewer';

/** The object-viewer's fixture models (name + dff + txd) — the e2e list; index 0 is the default render. */
const OBJECTS = [
  { dff: 'wattspark1_lae2.dff', name: 'wattspark1_LAe2 (txd lae2tempshit)', txd: 'lae2tempshit.txd' },
  { dff: 'lae2_ground08.dff', name: 'lae2_ground08 (txd burnsground)', txd: 'burnsground.txd' },
] as const;
/** Object-viewer models whose COL is pre-baked to `<model>.col.json`. */
const COL_MODELS = OBJECTS.map((object) => object.dff.replace(/\.dff$/, ''));

interface Fixture {
  readonly dest: string;
  readonly entry: string;
  readonly type: 'extract';
}

const extract = (entry: string, dest: string): Fixture => ({ dest: `${OUT}/${dest}`, entry, type: 'extract' });

const MANIFEST: readonly Fixture[] = OBJECTS.flatMap((object) => [
  extract(object.dff, `objects/${object.dff}`),
  extract(object.txd, `objects/${object.txd}`),
]);

let archives: ImgArchive[] | null = null;

function extractEntry(name: string): null | Uint8Array {
  for (const archive of openArchives()) {
    const data = archive.get(name);
    if (data) {
      return new Uint8Array(data);
    }
  }

  return null;
}

function openArchives(): ImgArchive[] {
  archives ??= ARCHIVES.map((rel) => openArchive(new Uint8Array(readFileSync(join(ROOT, rel)))));

  return archives;
}

const missing: string[] = [];
let written = 0;

function write(dest: string, data: null | Uint8Array): void {
  if (!data) {
    missing.push(dest);

    return;
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, data);
  written += 1;
}

for (const fixture of MANIFEST) {
  let data: null | Uint8Array = null;
  try {
    data = extractEntry(fixture.entry);
  } catch {
    data = null;
  }
  write(fixture.dest, data);
}

// Pre-baked COL for the object-viewer models (collision lives in the IMG, not the DFF).
const colIndex = buildCollisionIndex(openArchives()[0]);
for (const name of COL_MODELS) {
  const col = getCollision(colIndex, name);
  const dest = `${OUT}/objects/${name}.col.json`;
  if (!col) {
    missing.push(dest);
    continue;
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify({ ...col, vertices: Array.from(col.vertices) }));
  written += 1;
}

// The manifest the object-viewer loads (in `--mode e2e`) to list + render these fixtures.
mkdirSync(`${OUT}/objects`, { recursive: true });
writeFileSync(`${OUT}/objects/manifest.json`, JSON.stringify(OBJECTS));
written += 1;

console.log(`test:fixtures (viewer): wrote ${written} into ${OUT}/`);
if (missing.length > 0) {
  console.error(`\n  MISSING ${missing.length} — source not found in ${ROOT}:`);
  for (const dest of missing) {
    console.error(`    - ${dest}`);
  }
  console.error(`\n  Ensure game-src/original is a complete, unmodified GTA San Andreas install.`);
  process.exitCode = 1;
}
