/**
 * Local + E2E static origin (port 3001, matches VITE_STATIC_URL / playwright.config). Serves the built game
 * archives from `static/` (`static/games/<game>-<version>/*`, gitignored), maps `/viewer/*` →
 * `fixtures/viewer/*` — the object-viewer's e2e fixtures (`npm run test:fixtures`, gitignored, only loaded in
 * `--mode e2e`) — AND serves the two dev source trees ({@link DIR_MOUNTS}): `/build/*` → `build/*`, the
 * canonical dev source (plan 079), so every dev surface points `?src=/build/original/opensa` here instead of
 * copying the ~1.4 GB build into a Vite `public/`; and `/game-src/*` → `game-src/*`, the untouched vanilla
 * installs sa-map-viewer loads directly (plan 094 — `?src=http://localhost:3001/game-src/original`). sirv
 * honours Range, so the pak streams. CORS on; dev mode reads files fresh and tolerates a missing root.
 */
import { readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import sirv from 'sirv';

const PORT = Number(process.env.PORT) || 3001;
const serveStatic = sirv('static', { dev: true });
const serveTests = sirv('fixtures', { dev: true }); // `/viewer/objects/x` → `fixtures/viewer/objects/x`

/** The source trees served with a `__index` listing — everything the http-dir loader (`?src=`) can read:
 *  the build outputs (`/build/original/opensa/x`) and the raw installs (`/game-src/original/x`), plus the
 *  shareable single-file console (`/dist-share/dispatch.html`, 201/2-02). That last one is here rather than
 *  anywhere else for one reason: it must be served from the SAME origin as the pak it streams, or the range
 *  requests it exists to make become somebody's CORS problem — and the whole point of that artifact is that
 *  it needs nothing beside it. */
const DIR_MOUNTS = [
  { root: 'build', serve: sirv('build', { dev: true }) },
  { root: 'game-src', serve: sirv('game-src', { dev: true }) },
  { root: 'dist-share', serve: sirv('dist-share', { dev: true }) },
];

/** A flat `{ path, size }[]` walk of a served dir — the http-dir loader's file index (its `__index` endpoint).
 *  Classified via statSync (NOT the Dirent) so symlinked files/dirs are followed — the model-repack lab dir
 *  (`build/<game>/opensa-lab`, plan 024 phase 0) is a per-file-symlink mirror and sirv already serves them. */
function dirIndex(dir: string, base = ''): { path: string; size: number }[] {
  const out: { path: string; size: number }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const stats = statSync(join(dir, entry.name));
    if (stats.isDirectory()) {
      out.push(...dirIndex(join(dir, entry.name), rel));
    } else if (stats.isFile()) {
      out.push({ path: rel, size: stats.size });
    }
  }

  return out;
}

createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // the app (Vite :5173) fetches this origin cross-port
  const notFound = (): void => {
    res.statusCode = 404;
    res.end('Not found');
  };
  const url = req.url ?? '';
  const mount = DIR_MOUNTS.find((entry) => url.startsWith(`/${entry.root}/`));
  if (mount) {
    const path = url.slice(mount.root.length + 1).split('?')[0]; // drop the mount prefix + query
    // `${base}/__index` → the flat file listing the http-dir loader (fetchInstallSource) needs.
    if (path.endsWith('/__index')) {
      try {
        const body = JSON.stringify(dirIndex(join(mount.root, path.slice(1, -'/__index'.length))));
        res.setHeader('Content-Type', 'application/json');
        res.end(body);
      } catch {
        notFound();
      }

      return;
    }
    req.url = path;
    mount.serve(req, res, notFound);

    return;
  }
  const serve = url.startsWith('/viewer/') ? serveTests : serveStatic;
  serve(req, res, notFound);
}).listen(PORT, '0.0.0.0', () => {
  const mounts = DIR_MOUNTS.map((entry) => `/${entry.root} → ${entry.root}`).join(' + ');
  console.log(`static server on http://localhost:${PORT} (static/ + /viewer → fixtures/viewer + ${mounts})`);
});
