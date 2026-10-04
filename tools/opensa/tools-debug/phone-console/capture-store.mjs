/**
 * Writing what the panel was handed: a capture into the benchmark record, an archive beside the pak.
 *
 * The decisions live next door in `captures.js` (pure, tested); this file is the filesystem half — where a
 * path may point, and what is refused before anything is written.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { capturePath, checkTilesArchive, pakFacts, withNote } from './captures.mjs';

/** The flat map reads exactly this name beside the built game (`docs/contracts/dispatch-map.md`). */
const TILES_FILE = 'tiles.pmtiles';

/**
 * File one capture into `docs/benchmarks/opensa-engine/`.
 *
 * The conditions the panel can prove — the device, the node, the pak's own recipe and the commit that built
 * it — are stamped into the note here rather than typed by the operator, because a phone is where a typed
 * condition is most likely to be a remembered one.
 */
export async function fileCapture(repo, body, context) {
  const payload = typeof body.payload === 'string' ? JSON.parse(body.payload) : body.payload;
  if (payload === null || typeof payload !== 'object') {
    throw new Error('a capture is a JSON object — paste what the console’s copy button gave you');
  }
  const out = safePath(repo, body.out || './build/phone');
  const report = await readJson(join(out, 'pak/report.json'));
  const date = (body.date ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
  const relative = capturePath(date, body.slug ?? '');
  const stamped = withNote(payload, body.note, { ...pakFacts(report), device: context.device, node: context.node });
  const file = safePath(repo, relative);
  await mkdir(dirname(file), { recursive: true });
  const text = `${JSON.stringify(stamped, null, 2)}\n`;
  await writeFile(file, text, 'utf8');

  return { bytes: text.length, note: stamped.note, path: relative };
}

/** Put a baked pyramid where the flat map looks for it. */
export async function writeTilesArchive(repo, out, bytes) {
  const checked = checkTilesArchive(bytes);
  const directory = safePath(repo, out);
  await mkdir(directory, { recursive: true });
  const file = join(directory, TILES_FILE);
  await writeFile(file, bytes);

  return { ...checked, path: `${out.replace(/^\.\//, '')}/${TILES_FILE}` };
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Everything this panel writes stays inside the repository — a `..` in a field is a bug or an attack, and
 *  either way it is not a place a capture belongs. */
function safePath(repo, relative) {
  const full = resolve(repo, relative);
  if (full !== repo && !full.startsWith(`${repo}/`)) {
    throw new Error(`'${relative}' is outside the repository`);
  }

  return full;
}
