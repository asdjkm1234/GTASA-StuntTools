/**
 * cars-server — a local page showing what the vehicle fleet REPLACED: the stock car beside the mod that took
 * its slot, its author, and what the mod brings (paint jobs, tuning, colours, a CLEO script).
 *
 *   npm run cars                          # http://localhost:5178, game `original`, target `sa`
 *   npm run cars:sa | npm run cars:opensa # the two targets of a LAYERED vehicles folder (common + sa|opensa)
 *   npm run cars -- --game gostown --port 5200 [--target sa|opensa]
 *
 * Internal tool, local only: the catalog is rebuilt on every page load, so editing `mods-src` and hitting
 * reload shows the new fleet. See `scripts/cars-server/readme.md` and its plan.
 */
import { parseBuildTarget } from '@opensa/tool-kit/target';
import express from 'express';
import Handlebars from 'handlebars';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCatalog, type Catalog, type Metadata } from './catalog';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function argValue(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);

  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const game = argValue('--game', 'original');
// A LAYERED vehicles folder shows `common` + this target's layer (each car's screenshot from its OWN layer); a flat/structured
// one ignores it. The page names the target either way, so the reader knows which fleet is on screen.
const target = parseBuildTarget(argValue('--target', 'sa'));
const port = Number(argValue('--port', '5178'));
const vehiclesPath = resolve('mods-src', game, 'vehicles');
/** The ADDED fleet's own root (central plan 102) — shown in its own section when the game has one. */
const addedPath = resolve('mods-src', game, 'add-vehicles');
const gamePath = resolve('game-src', game);
/** The BUILT `sa` tree — read for one thing: the id its ledger promises each added car (plan 003). */
const builtPath = resolve('build', game, 'sa');

const metadata = JSON.parse(readFileSync(join(ROOT, 'data', 'original.json'), 'utf8')) as Metadata;
/**
 * Compiled per request, not at boot: this is a dev tool whose view is edited while it runs, and a cached
 * template makes a CSS change look like it did nothing. The file is a few KB — the read costs nothing.
 */
function render(context: object): string {
  return Handlebars.compile(readFileSync(join(ROOT, 'views', 'index.hbs'), 'utf8'))(context);
}

/**
 * The last render's catalog, which the image routes read. Rebuilt when the PAGE is requested and not per
 * image: a card asks for two pictures, so rebuilding there would rescan 212 folders 424 times per reload.
 */
let catalog: Catalog = buildCatalog({ addedPath, builtPath, gamePath, metadata, target, vehiclesPath });

const app = express();

app.get('/', (_request, response) => {
  catalog = buildCatalog({ addedPath, builtPath, gamePath, metadata, target, vehiclesPath });
  response.type('html').send(
    render({
      addedNote: catalog.addedNote,
      game,
      layered: catalog.strategy === 'layered',
      missingShots: catalog.missingShots,
      screenshotDirs: catalog.screenshotDirs.map((dir) => relative(process.cwd(), dir)),
      sections: catalog.sections,
      source: relative(process.cwd(), vehiclesPath),
      target,
      total: catalog.total,
    }),
  );
});

// The stock picture, decoded out of the metadata's `data:` URI. Served rather than inlined: 212 base64
// images in one document is ~1.7 MB of HTML before a single car is on screen.
app.get('/original/:slot', (request, response) => {
  const match = catalog.stockImages.get(request.params.slot.toLowerCase())?.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) {
    response.status(404).end();

    return;
  }
  response.type(match[1]).send(Buffer.from(match[2], 'base64'));
});

// The field screenshot, off disk. Matched by SLOT — five of the 212 filenames do not match their folder's
// name character for character, and a filename lookup drops exactly those five.
app.get('/shot/:slot', (request, response) => {
  const path = catalog.screenshots.get(request.params.slot.toLowerCase());
  if (path === undefined) {
    response.status(404).end();

    return;
  }
  response.sendFile(path);
});

app.listen(port, () => {
  console.log(
    `cars-server [${target}]: ${catalog.total} car(s) in ${catalog.sections.length} section(s) from ` +
      `${vehiclesPath} (${catalog.strategy}; screenshots per layer: ${catalog.screenshotDirs.join(', ')}) — ` +
      `http://localhost:${port}`,
  );
});
