import { openArchive } from '@opensa/renderware/archive/img-archive';
/**
 * Compare server for the before/after model viewer (plan 019 Phase 2; own-engine AFTER in 079 phase 4). Serves
 * model bytes out of two game trees' IMG archives so the viewer's compare/object tabs can show one model
 * side-by-side — BEFORE a stock DFF/TXD (`original`, a mod-installer output, …), AFTER either a stock DFF
 * or a CONVERTED own-engine `.osm` (an opensa-pack `--out` like `build/original/opensa`, where by-name models
 * are self-contained `.osm`). The viewer tries `/osm` and falls back to `/dff`, so a side can be either format.
 * Usage: `tsx map-optimizer/src/compare-serve.ts --before <gameDir> --after <gameDir> [--port 3002]`.
 *
 * Endpoints (all GET, CORS `*`):
 * - `/models`                          → JSON sorted BARE model names present on BOTH sides (.dff ∪ .osm)
 * - `/models?side=before|after`        → JSON sorted bare model names on just that side (object tab uses `after`)
 * - `/models?side=after&kind=vehicle`  → JSON sorted vehicle model names from that side's `vehicles.ide`
 * - `/models?side=after&kind=ped`      → JSON sorted ped model names from that side's `peds.ide`
 * - `/lod?side=after&model=m`          → JSON: the model's LOD name (via the IPL lod-index) if present, else ""
 * - `/osm?side=before|after&model=m`   → the model's converted `.osm` bytes (404 ⇒ stock side, use /dff)
 * - `/dff?side=before|after&model=m`   → the model's DFF bytes from that side
 * - `/txd?side=before|after&model=m`   → the model's TXD bytes (txd name resolved from that side's IDEs)
 * - `/ifp?side=before|after`           → that side's `anim/ped.ifp` bytes (character-tab animations)
 */
import { parsePedDefs } from '@opensa/renderware/parsers/text/ped-defs.parser';
import { parseVehicleDefs } from '@opensa/renderware/parsers/text/vehicle-defs.parser';
import { argValue, fromCwd } from '@opensa/tool-kit/cli';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { join } from 'node:path';

import { lodModelMap, modelTxdMap } from './adapters/gta-sa/resolve';

interface Side {
  gameDir: string;
  get(name: string): ArrayBuffer | null;
  /** HD model → its LOD model (both lowercased) via the IPL lod-index. */
  lodByModel: Map<string, string>;
  names: Set<string>;
  /** Model names from `peds.ide` present as `.dff` on this side (sorted). */
  peds: string[];
  txdByModel: Map<string, string>;
  /** Model names from `vehicles.ide` present as `.dff` on this side (sorted). */
  vehicles: string[];
}

function main(): void {
  const beforeArg = argValue('--before');
  const afterArg = argValue('--after');
  if (!beforeArg || !afterArg) {
    throw new Error('usage: tsx map-optimizer/src/compare-serve.ts --before <gameDir> --after <gameDir> [--port 3002]');
  }
  const port = Number(argValue('--port') ?? 3002);
  const sides: Record<'after' | 'before', Side> = {
    after: openSide(fromCwd(afterArg)),
    before: openSide(fromCwd(beforeArg)),
  };
  const models = modelNames(sides.before.names, sides.after.names);

  createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); // the viewer (Vite :5173) fetches cross-port
    const url = new URL(req.url ?? '/', 'http://localhost');
    const sideParam = url.searchParams.get('side');
    const side = sideParam === 'before' || sideParam === 'after' ? sides[sideParam] : null;
    if (url.pathname === '/models') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(modelListFor(side, url.searchParams.get('kind'), models)));

      return;
    }
    if (side && url.pathname === '/lod') {
      const model = (url.searchParams.get('model') ?? '').toLowerCase();
      const lod = side.lodByModel.get(model);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(lod && (side.get(`${lod}.dff`) || side.get(`${lod}.osm`)) ? lod : ''));

      return;
    }
    if (side && url.pathname === '/ifp') {
      const path = join(side.gameDir, 'anim', 'ped.ifp');
      sendBytes(res, existsSync(path) ? toArrayBuffer(readFileSync(path)) : null);

      return;
    }
    const model = (url.searchParams.get('model') ?? '').toLowerCase();
    if (!side || !model || (url.pathname !== '/dff' && url.pathname !== '/osm' && url.pathname !== '/txd')) {
      res.statusCode = 404;
      res.end('not found');

      return;
    }
    if (url.pathname === '/dff') {
      sendBytes(res, side.get(`${model}.dff`));
    } else if (url.pathname === '/osm') {
      // The converted (own-engine) side — a self-contained `.osm` (geometry + `.ostex` textures inside). The
      // viewer decodes it with the game's `readModelOsm`; 404 signals "this side is stock, use /dff".
      sendBytes(res, side.get(`${model}.osm`));
    } else {
      const txd = side.txdByModel.get(model);
      sendBytes(res, txd ? side.get(`${txd}.txd`) : null);
    }
  }).listen(port, () => {
    console.log(`compare server on http://localhost:${port} — ${models.length} model(s) on both sides`);
    console.log(`open viewer.html?tab=compare (npm run dev)`);
  });
}

/** Resolve the `/models` response: a `kind` catalogue for a side, that side's full list, or the both-sides set. */
function modelListFor(side: null | Side, kind: null | string, both: string[]): string[] {
  if (!side) {
    return both;
  }
  if (kind === 'vehicle') {
    return side.vehicles;
  }
  if (kind === 'ped') {
    return side.peds;
  }

  return modelNames(side.names);
}

/** Sorted BARE model names in `names` — a stock side lists `.dff`, a converted (own-engine) side lists
 *  `.osm`; both strip to the same bare name so the two sides intersect. Optionally intersected with `other`. */
function modelNames(names: Set<string>, other?: Set<string>): string[] {
  const bare = (set: Set<string>): Set<string> =>
    new Set([...set].filter((name) => name.endsWith('.dff') || name.endsWith('.osm')).map((name) => name.slice(0, -4)));
  const mine = bare(names);
  const both = other ? bare(other) : null;

  return [...mine].filter((name) => !both || both.has(name)).sort();
}

/** Open every models/*.img of a game dir + its IDE model→txd map + the vehicle/ped catalogues. */
function openSide(gameDir: string): Side {
  const modelsDir = join(gameDir, 'models');
  const archives = readdirSync(modelsDir)
    .filter((file) => file.toLowerCase().endsWith('.img'))
    .sort((a, b) => (a.toLowerCase() === 'gta3.img' ? -1 : b.toLowerCase() === 'gta3.img' ? 1 : a.localeCompare(b)))
    .map((file) => openArchive(new Uint8Array(readFileSync(join(modelsDir, file)))));
  const names = new Set<string>();
  for (const archive of archives) {
    for (const name of archive.names) {
      names.add(name);
    }
  }
  const txdByModel = modelTxdMap(join(gameDir, 'data'));

  // Vehicle/ped catalogues from their IDEs (cars/peds sections) — the model→txd map only covers world `objs`,
  // so add these txds too, and list only the models actually present as `.dff` on this side.
  const catalogue = (file: string, defs: Map<string, { model: string; txd: string }>): string[] => {
    const path = join(gameDir, 'data', file);
    if (!existsSync(path)) {
      return [];
    }
    const list: string[] = [];
    for (const def of defs.values()) {
      const model = def.model.toLowerCase();
      if (!txdByModel.has(model)) {
        txdByModel.set(model, def.txd.toLowerCase());
      }
      if (names.has(`${model}.dff`) || names.has(`${model}.osm`)) {
        list.push(model);
      }
    }

    return [...new Set(list)].sort();
  };
  const vehicles = catalogue('vehicles.ide', parseVehicleDefs(readIdeText(gameDir, 'vehicles.ide')));
  const peds = catalogue('peds.ide', parsePedDefs(readIdeText(gameDir, 'peds.ide')));

  return {
    gameDir,
    get: (name): ArrayBuffer | null => {
      for (const archive of archives) {
        const bytes = archive.get(name);
        if (bytes) {
          return bytes;
        }
      }

      return null;
    },
    lodByModel: lodModelMap(join(gameDir, 'data'), archives[0]),
    names,
    peds,
    txdByModel,
    vehicles,
  };
}

/** Read a `data/<file>` IDE as text, or '' when absent (a slim tree may not ship vehicles/peds). */
function readIdeText(gameDir: string, file: string): string {
  const path = join(gameDir, 'data', file);

  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function sendBytes(res: ServerResponse, bytes: ArrayBuffer | null): void {
  if (!bytes) {
    res.statusCode = 404;
    res.end('not found');

    return;
  }
  res.setHeader('Content-Type', 'application/octet-stream');
  res.end(Buffer.from(bytes));
}

/** A Node Buffer view as a standalone ArrayBuffer (sliced to its exact bytes). */
function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

main();
