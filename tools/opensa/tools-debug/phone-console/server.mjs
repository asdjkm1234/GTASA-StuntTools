/**
 * The phone console: one page on the phone that runs the field-run rituals, says why one will not start, and
 * files what it measures into the repository.
 *
 * **Plain Node, no dependencies, no build step — deliberately.** This is the thing that has to come up when
 * the tree is broken: its whole first job is to tell you that `node_modules` is stale or `tsx` is missing,
 * and a panel that needed either to boot could not say so. Same reasoning as `tools-debug/bench-harness`,
 * and the reason it is `.js` rather than `.ts`.
 *
 *   node tools-debug/phone-console/server.js        (or: npm run panel)
 *
 * **It binds to 127.0.0.1.** A page that runs commands is a shell, and a shell must not appear on the LAN
 * because it was convenient. `PANEL_HOST=0.0.0.0` opts in, and the startup line says what that means.
 */
import { execFile, execFileSync } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, realpath, stat, statfs } from 'node:fs/promises';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';

import { consoleUrls, LINK_NAMES } from './app/links.mjs';
import { fileCapture, writeTilesArchive } from './capture-store.mjs';
import { commitPlan, pendingCaptures, runCommit } from './captures.mjs';
import { runChecks, statusPaths, verdict } from './doctor.mjs';
import { buildJob, JobRunner, JOBS } from './jobs.mjs';
import { OPEN_URL_BIN, openConsole } from './opener.mjs';
import { MapBus } from './remote.mjs';
import { NOTIFY_BIN, signalDone, VIBRATE_BIN } from './signal.mjs';
import { htmlFingerprint, htmlNames, listTarFiles } from './webapp.mjs';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const PORT = Number(process.env.PANEL_PORT) || 8787;

/** A Termux:API binary with no add-on app behind it can hang; the release must not hang with it. */
const SIGNAL_TIMEOUT_MS = 4000;
const HOST = process.env.PANEL_HOST || '127.0.0.1';
/** The two ports a field run uses (`scripts/phone.sh`), so the doctor can say which are already serving. */
const RUN_PORTS = [Number(process.env.STATIC_PORT) || 3001, Number(process.env.APP_PORT) || 5173];
const MIME = {
  '.css': 'text/css',
  '.html': 'text/html',
  // `.js` is here for `app/sw.js`: served as `application/octet-stream` a service worker is REFUSED, and the
  // registration swallows that — so the panel's install prompt quietly never appeared.
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.mjs': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};
/** A capture is JSON from a browser paste; a tile archive is megabytes. Both are bounded so a stuck upload
 *  cannot eat the phone's memory. */
const MAX_JSON = 8 * 1024 * 1024;
const MAX_UPLOAD = 512 * 1024 * 1024;

const listeners = new Set();
/** The map page's command bus (plan 002). One per panel, like the job runner: one phone, one map in front. */
const mapBus = new MapBus();

const runner = new JobRunner({
  cwd: REPO,
  // Beside the servers' own logs (`scripts/phone.sh` writes `build/.phone/{app,static}.log` there). Every job
  // line lands here as well as in the ring buffer, because on this device the thing that kills a convert
  // kills the panel holding the record of it — see `jobs.mjs`.
  logFile: join(REPO, 'build/.phone/panel-jobs.log'),
  onLine: (line) => {
    for (const listener of listeners) {
      listener(line);
    }
  },
});

/** The archive is 1.4 MB and preflight runs every few seconds, so the gunzip is done once per ARCHIVE — a
 *  new one has a different size or mtime, and nothing else can change what is inside it. */
let archiveCache = null;

const probe = {
  /**
   * The served app against the archive it should have come from, by content.
   *
   * `null` when there is no unpacked copy at all — that device runs the dev server, and a check about an
   * archive nobody extracted is noise.
   */
  app: async () => {
    const archivePath = join(REPO, 'prebuilt/opensa-webapp.tar.gz');
    const servedDir = join(REPO, 'build/webapp');
    try {
      const stamp = await stat(archivePath);
      const key = `${stamp.size}:${stamp.mtimeMs}`;
      if (archiveCache?.key !== key) {
        const files = listTarFiles(gunzipSync(await readFile(archivePath)));
        archiveCache = { fingerprint: htmlFingerprint(files), key, names: htmlNames(files) };
      }
      const served = [];
      for (const name of archiveCache.names) {
        served.push({ body: await readFile(join(servedDir, name)), name });
      }

      return { archived: archiveCache.fingerprint, served: htmlFingerprint(served) };
    } catch {
      // No archive, or no unpacked copy — either way there is nothing to compare and nothing to say.
      return null;
    }
  },
  arch: process.arch,
  /**
   * Whether a push has any way to authenticate, as CONFIGURATION rather than by trying.
   *
   * Asking the network would mean a request on every preflight; what is knowable locally is enough for the
   * failure this exists for — an https remote with no credential helper anywhere, which fails with "could
   * not read Username for 'https://github.com'" the moment a capture is pushed (2026-08-24).
   */
  credentials: async () => {
    const url = await remoteUrl();
    if (url.startsWith('git@') || url.startsWith('ssh://')) {
      return { helper: 'ssh key', ok: true };
    }
    try {
      const helper = (
        await run('git', ['config', '--get-urlmatch', 'credential.helper', 'https://github.com'], { cwd: REPO })
      ).stdout.trim();

      return { helper, ok: helper !== '' };
    } catch {
      return { helper: '', ok: false };
    }
  },
  exists: async (path) => existsSync(join(REPO, path)),
  freeBytes: async (path) => {
    try {
      const stats = await statfs(join(REPO, path));

      return stats.bavail * stats.bsize;
    } catch {
      return null;
    }
  },
  git: async () => {
    try {
      const branch = (await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: REPO })).stdout.trim();
      const status = (await run('git', ['status', '--porcelain'], { cwd: REPO })).stdout;
      let ahead = 0;
      let behind = 0;
      try {
        const counts = (
          await run('git', ['rev-list', '--left-right', '--count', `${branch}...origin/${branch}`], { cwd: REPO })
        ).stdout.trim();
        // `--left-right` counts the local side first: what is here and not there, then the other way round.
        [ahead, behind] = counts.split(/\s+/).map((count) => Number(count) || 0);
      } catch {
        ahead = 0; // no upstream yet — not a problem to report
        behind = 0;
      }

      const paths = statusPaths(status);

      return { ahead, behind, branch, dirty: paths.length, dirtyPaths: paths };
    } catch {
      return null;
    }
  },
  /** Who this repository commits as, and who owns its remote — the fix line is derived from the second. */
  identity: async () => {
    const read = async (key) => {
      try {
        return (await run('git', ['config', '--get', key], { cwd: REPO })).stdout.trim();
      } catch {
        return ''; // `git config --get` exits 1 when the key is unset
      }
    };
    const owner = async () => {
      try {
        const url = (await run('git', ['remote', 'get-url', 'origin'], { cwd: REPO })).stdout.trim();

        return /[/:]([^/]+)\/[^/]+?(?:\.git)?$/.exec(url)?.[1] ?? '';
      } catch {
        return '';
      }
    };

    return { email: await read('user.email'), name: await read('user.name'), owner: await owner() };
  },
  mtime: async (path) => {
    try {
      return (await stat(join(REPO, path))).mtimeMs;
    } catch {
      return null;
    }
  },
  nodeVersion: process.version,
  /** Termux's URL launcher — without it the panel can hand out a link but never open one. */
  openUrl: existsSync(OPEN_URL_BIN),
  portOpen: (port) =>
    new Promise((done) => {
      const socket = connect(port, '127.0.0.1');
      socket.setTimeout(600);
      socket.on('connect', () => {
        socket.end();
        done(true);
      });
      socket.on('error', () => done(false));
      socket.on('timeout', () => {
        socket.destroy();
        done(false);
      });
    }),
  readJson: async (path) => {
    try {
      return JSON.parse(await readFile(join(REPO, path), 'utf8'));
    } catch {
      return null;
    }
  },
  realpath: async (path) => {
    try {
      return await realpath(join(REPO, path));
    } catch {
      return null;
    }
  },
  /** A rebase that stopped part-way leaves one of these behind, and the tree is mid-history until it ends. */
  rebasing: async () => existsSync(join(REPO, '.git/rebase-merge')) || existsSync(join(REPO, '.git/rebase-apply')),
  signal: existsSync(VIBRATE_BIN) || existsSync(NOTIFY_BIN),
  termux: Boolean(process.env.PREFIX) && existsSync('/data/data/com.termux'),
  /** The flat map's pyramid beside the pak, in bytes, or null when it is not there — so "did my upload land"
   *  is a line on the screen rather than a question (201/6-02). */
  tilesArchive: async (out) => {
    try {
      return (await stat(join(REPO, out, 'tiles.pmtiles'))).size;
    } catch {
      return null;
    }
  },
  wakeLock: existsSync('/data/data/com.termux/files/usr/bin/termux-wake-lock'),
};

createServer((request, response) => {
  handle(request, response).catch((error) => {
    send(response, 500, { error: String(error?.message ?? error) });
  });
}).listen(PORT, HOST, () => {
  const where = HOST === '127.0.0.1' ? 'this phone only' : `EVERY device on this network can run commands here`;
  process.stdout.write(`phone console on http://localhost:${PORT} — ${where}\n`);
});

/** Commit the filed captures — and push when asked, on the branch that is checked out. */
async function commit(body) {
  const plan = commitPlan(body.paths ?? [], body.subject ?? 'a capture from the phone');
  const branch = (await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: REPO })).stdout.trim();

  return runCommit({
    branch,
    log: (line) => runner.push(line),
    plan,
    push: body.push === true,
    run: (command, args, env) => run(command, args, { cwd: REPO, env: { ...process.env, ...env } }),
  });
}

/** The device, for a capture's conditions. `getprop` is Android's own and absent everywhere else. */
function deviceName() {
  try {
    return execFileSync('getprop', ['ro.product.model'], { encoding: 'utf8' }).trim() || process.platform;
  } catch {
    return `${process.platform}/${process.arch}`;
  }
}

/**
 * The measurement districts, read straight out of the console's own table.
 *
 * A regex over a TypeScript file rather than running it: `scripts/district.ts` needs `tsx`, and this list is
 * wanted on exactly the screen that reports tsx missing. When the shape changes the list comes back empty and
 * the field stays free text — the failure is a plain input box, never a wrong district.
 */
async function districtNames() {
  try {
    const source = await readFile(join(REPO, 'apps/dispatch/src/world/districts.ts'), 'utf8');

    return [...source.matchAll(/^\s{2}'?([a-z0-9-]{3,40})'?:\s*\{/gm)].map((match) => match[1]);
  } catch {
    return [];
  }
}

async function handle(request, response) {
  const url = new URL(request.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  /**
   * The console files its own capture, from its own page, on its own port — so this server answers a
   * cross-origin POST (201/2-03's round trip).
   *
   * It used to be a copy-paste: copy the JSON out of the map, switch apps, paste it in, type a slug. On a
   * phone that is the step where a measurement quietly stops being taken, and the README already names the
   * failure it produces — *"a measurement that reached the next session as a chat paste with its conditions
   * missing"*. The map knows the conditions; letting it POST them is the whole fix.
   *
   * `*` is the right origin here and stays narrow in practice: this server binds localhost, on a phone, and
   * every route it exposes is one the operator is holding the screen for.
   */
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'POST, GET, OPTIONS',
      'access-control-allow-origin': '*',
      'access-control-max-age': '600',
    });

    return response.end();
  }

  if (request.method === 'GET' && (path === '/' || path === '/index.html')) {
    return serveFile(response, join(HERE, 'app/index.html'));
  }
  if (request.method === 'GET' && /^\/app\/[\w.-]+$/.test(path)) {
    return serveFile(response, join(HERE, path.slice(1)));
  }
  if (request.method === 'GET' && path === '/api/state') {
    const target = {
      game: url.searchParams.get('game') || './game-src/original',
      out: url.searchParams.get('out') || './build/phone',
      ports: RUN_PORTS,
    };
    const checks = await runChecks(probe, target);

    return send(response, 200, {
      // What is committed here and not on the remote, and what is there and not here — the Push button reads
      // both: pushing while behind can only be rejected, and a button that can only fail is a trap.
      ahead: (await probe.git())?.ahead ?? 0,
      behind: (await probe.git())?.behind ?? 0,
      checks,
      districts: await districtNames(),
      job: runner.status(),
      // Read from git rather than remembered by the page: a capture written before a reload is still there,
      // and a panel that forgot filing it would refuse to commit it.
      pending: await pending(),
      ports: { app: RUN_PORTS[1], static: RUN_PORTS[0] },
      verdict: verdict(checks),
      // Which app URL to offer: a prebuilt copy is served as static files and vite is never started, which
      // on some arm64 CPUs is the only way in at all (`scripts/phone.sh`).
      webapp: await probe.exists('build/webapp/index.html'),
    });
  }
  if (request.method === 'GET' && path === '/api/log') {
    return streamLog(response);
  }
  // The same buffer the stream replays, as ONE answer — for a caller that cannot hold an event stream open
  // (the MCP server, `mcp.mjs`). Never a second buffer: the log a tool reads and the log the page shows are
  // the same lines, or a field report and the screen disagree about what happened.
  if (request.method === 'GET' && path === '/api/log/tail') {
    const lines = runner.backlog();
    const tail = Number(url.searchParams.get('tail')) || 80;

    return send(response, 200, { job: runner.status(), lines: lines.slice(-Math.max(1, tail)) });
  }
  // What may be run, straight off the table `buildJob` validates against — an agent asking "what can this
  // phone do" must be answered by the allowlist itself rather than by a list somebody keeps in step with it.
  // The map page's own channel (plan 002, the browser half). Three routes and no state of its own: the page
  // long-polls for a command, answers it, and an agent waits on that answer.
  if (request.method === 'GET' && path === '/api/map/poll') {
    const page = {
      fps: Number(url.searchParams.get('fps')) || 0,
      mode: url.searchParams.get('mode') ?? '',
      url: url.searchParams.get('url') ?? '',
    };

    return send(response, 200, { command: await mapBus.take({ page }) });
  }
  if (request.method === 'POST' && path === '/api/map/result') {
    const body = await readJson(request);

    return send(response, 200, mapBus.settle(body.id, body.result));
  }
  if (request.method === 'POST' && path === '/api/map/command') {
    const body = await readJson(request);

    return send(response, 200, await mapBus.submit(body));
  }
  if (request.method === 'GET' && path === '/api/map/state') {
    return send(response, 200, mapBus.attached());
  }
  // The one thing the bus above cannot do for itself: put the page on the screen. Everything else here talks
  // to a console somebody already opened, so this is what turns "no map is attached" from a dead end into a
  // step (plan 002).
  if (request.method === 'POST' && path === '/api/map/open') {
    const body = await readJson(request);
    const view = String(body.view ?? 'map');
    if (!LINK_NAMES.includes(view)) {
      return send(response, 400, { error: `no view '${view}' — one of ${LINK_NAMES.join(', ')}`, ok: false });
    }
    const links = consoleUrls({
      district: body.district ?? '',
      out: body.out ?? './build/phone',
      ports: { app: RUN_PORTS[1], static: RUN_PORTS[0] },
      webapp: await probe.exists('build/webapp/index.html'),
    });

    return send(
      response,
      200,
      await openConsole(
        {
          attached: () => mapBus.attached(),
          exists: existsSync,
          launch: (url) => run(OPEN_URL_BIN, [url]),
        },
        { timeoutMs: Number(body.timeoutMs) || undefined, url: links[view] },
      ),
    );
  }
  // The end of a run, told to the PERSON rather than to the agent: the page shows it and the phone buzzes.
  // Both halves are attempted whatever the other does — a console that has already been closed does not stop
  // the buzz, and a phone with no Termux:API does not stop the page from saying the run is over.
  if (request.method === 'POST' && path === '/api/map/release') {
    const body = await readJson(request);
    const note = String(body.note ?? '').slice(0, 120);
    const [map, signal] = await Promise.all([
      mapBus.submit({ args: { note }, kind: 'release' }),
      signalDone({ exists: existsSync, run: (bin, args) => run(bin, args, { timeout: SIGNAL_TIMEOUT_MS }) }, { note }),
    ]);

    return send(response, 200, { map, ok: true, signal });
  }
  if (request.method === 'GET' && path === '/api/jobs') {
    return send(
      response,
      200,
      Object.entries(JOBS).map(([id, job]) => ({
        forced: job.forced ?? null,
        id,
        knobs: Object.keys(job.knobs ?? {}),
        label: job.label,
        long: job.long === true,
        outSuffix: job.outSuffix ?? null,
      })),
    );
  }
  if (request.method === 'POST' && path.startsWith('/api/job/')) {
    const plan = buildJob(path.slice('/api/job/'.length), await readJson(request));
    // The env goes back with the status because the SERVER decides part of it — a map-only run converts into
    // its own folder, and a page still pointing its links at the folder it typed would open the other pak.
    return send(response, 200, { ...runner.start(plan), env: plan.env });
  }
  if (request.method === 'POST' && path === '/api/stop') {
    return send(response, 200, runner.stop());
  }
  if (request.method === 'POST' && path === '/api/capture') {
    const body = await readJson(request);
    const filed = await fileCapture(REPO, body, { device: deviceName(), node: process.version, probe });

    return send(response, 200, filed);
  }
  if (request.method === 'POST' && path === '/api/tiles') {
    const out = url.searchParams.get('out') || './build/phone';
    const filed = await writeTilesArchive(REPO, out, await readBody(request, MAX_UPLOAD));

    return send(response, 200, filed);
  }
  if (request.method === 'POST' && path === '/api/push') {
    return send(response, 200, await pushOnly());
  }
  if (request.method === 'POST' && path === '/api/commit') {
    return send(response, 200, await commit(await readJson(request)));
  }

  return send(response, 404, { error: `no route for ${request.method} ${path}` });
}

/** Captures written but not committed — the list the commit button acts on. */
async function pending() {
  try {
    const { stdout } = await run('git', ['status', '--porcelain', '--untracked-files=all', '--', 'docs/benchmarks'], {
      cwd: REPO,
    });

    return pendingCaptures(statusPaths(stdout));
  } catch {
    return [];
  }
}

/**
 * Push what is already committed.
 *
 * Separate from the commit for one reason: on 2026-08-24 the commit succeeded and only the push failed (no
 * credentials), and there was then no way to retry it from the panel at all — the capture was in, the
 * repository was not, and the button that could have sent it insisted on having something new to file.
 */
async function pushOnly() {
  const branch = (await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: REPO })).stdout.trim();
  // Refused here as well as disabled on the page: a page can be seconds stale, and a push while the remote
  // is ahead cannot succeed — git rejects it with `fetch first`, and the operator reads a failure where the
  // answer was "take the other side first" (2026-08-25).
  const state = await probe.git();
  if (state !== null && state.behind > 0) {
    throw new Error(`${state.behind} commit(s) from the remote are missing here — pull (rebase) before pushing`);
  }

  return runCommit({
    branch,
    log: (line) => runner.push(line),
    plan: { env: { GIT_TERMINAL_PROMPT: '0', HUSKY: '0' }, steps: [] },
    push: true,
    run: (command, args, env) => run(command, args, { cwd: REPO, env: { ...process.env, ...env } }),
  });
}

async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      throw new Error(`body over ${(limit / 1024 / 1024).toFixed(0)} MB`);
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function readJson(request) {
  const body = await readBody(request, MAX_JSON);

  return body.length === 0 ? {} : JSON.parse(body.toString('utf8'));
}

/** The origin URL, or an empty string when there is no remote at all. */
async function remoteUrl() {
  try {
    return (await run('git', ['remote', 'get-url', 'origin'], { cwd: REPO })).stdout.trim();
  } catch {
    return '';
  }
}

function send(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    // See the OPTIONS handler: the console posts its captures here from another port.
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
    'content-type': 'application/json',
  });
  response.end(payload);
}

function serveFile(response, file) {
  if (!existsSync(file)) {
    return send(response, 404, { error: `missing ${file}` });
  }
  response.writeHead(200, {
    'cache-control': 'no-store',
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
  });
  createReadStream(file).pipe(response);
}

/**
 * The log, as server-sent events.
 *
 * The backlog goes out first and that is the point: a phone screen sleeps, the browser drops the connection,
 * and a reconnect that showed an empty box would make a running convert look like a dead one.
 */
function streamLog(response) {
  response.writeHead(200, {
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'content-type': 'text/event-stream',
  });
  const write = (line) => response.write(`data: ${JSON.stringify(line)}\n\n`);
  const backlog = runner.backlog();
  if (backlog.length === 0) {
    // Nothing in memory means this panel has not run anything — which after a kill is exactly when the
    // operator most needs to see what the LAST one was doing when it stopped.
    const previous = runner.previous();
    if (previous.length > 0) {
      write('— from the previous session (the panel was restarted) —');
      for (const line of previous) {
        write(line);
      }
      write('— end of the previous session —');
    }
  }
  for (const line of backlog) {
    write(line);
  }
  listeners.add(write);
  // A comment frame every 20 s: Android's radio drops an idle connection long before a convert prints again.
  const keepAlive = setInterval(() => response.write(': keep-alive\n\n'), 20_000);
  response.on('close', () => {
    clearInterval(keepAlive);
    listeners.delete(write);
  });
}
