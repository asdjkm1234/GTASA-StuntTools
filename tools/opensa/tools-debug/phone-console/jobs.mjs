/**
 * The rituals the panel can run, and the one rule that they run ONE at a time.
 *
 * Every job here is an existing command — `npm run phone`, `npm run phone:setup`, `git pull`. The panel adds
 * no build steps of its own and reimplements nothing: `scripts/phone.sh` is 369 lines of measured knowledge
 * about this device, and a second copy of it inside a web server would be a second thing to keep true.
 *
 * **One job at a time, and the refusal names what is running.** Two converts at once on a phone is an OOM
 * and two paks welded into one folder — the failure that cost a session on 2026-08-09. The queue depth is
 * one because the alternative is a queue nobody watches on a screen that sleeps.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Env a `phone` run may carry, with what each accepts. Anything else the form sends is DROPPED rather than
 *  passed on: this is the list `scripts/phone.sh` documents, and an unknown key is a typo that would
 *  otherwise be silently ignored by the shell script instead of reported here. */
export const PHONE_ENV = {
  ASTC_THREADS: /^\d{1,2}$/,
  BAKE: /^[01]$/,
  DISTRICT: /^[a-z0-9-]{1,40}$/,
  HEAP: /^\d{3,5}$/,
  LODONLY: /^[01]$/,
  MAPOBJ: /^[01]$/,
  MODELS: /^[01]$/,
  OUT: /^\.?\/?[\w./-]{1,80}$/,
  PEDS: /^[\w,]{1,200}$/,
  REBUILD: /^[01]$/,
  RECT: /^-?\d{1,4},-?\d{1,4},-?\d{1,4},-?\d{1,4}$/,
  SPAWN: /^-?\d{1,5},-?\d{1,5},-?\d{1,5}$/,
  TEXTURES: /^(astc|rgba8|bc)$/,
  VEHICLES: /^[\w,]{1,200}$/,
};

/**
 * What a MAP-ONLY run forces off, whatever the page sends.
 *
 * The button exists because "just the ground" is the run that is wanted most and is the one nobody remembers
 * how to ask for: it is two env vars, and getting either wrong costs a convert measured in hours rather than
 * one that is wrong on screen.
 *
 * - `MODELS=0` → `--no-models`: no vehicles, no peds, no model archives rewritten. The whole model half of
 *   the convert, and the pak the flat and 3D map read does not contain one of them.
 * - `BAKE=0` → no `--bake-collision`. Not tidiness: with no models there is nothing to run physics, and
 *   `scripts/phone.sh` says so in its own banner — the bake is work whose product this run cannot reach.
 *
 * `MAPOBJ` is deliberately NOT here. Its default is already 1 (convert only what the rect places), and the
 * map objects the rect places ARE the ground — turning them off would not be a leaner map, it would be an
 * empty one.
 */
export const MAP_ONLY = { BAKE: '0', MODELS: '0' };

/** What the panel can run. `long` jobs hold the terminal (they serve), so the page shows a stop button. */
export const JOBS = {
  districts: {
    args: ['node_modules/tsx/dist/cli.mjs', 'scripts/district.ts'],
    command: 'node',
    label: 'list the measurement districts',
    long: false,
  },
  // The one-tap ground run. It is the `phone` ritual with two things forced OFF and its own output folder —
  // see MAP_ONLY below for why each of the three is not a default the operator is asked to remember.
  map: {
    args: ['run', 'phone'],
    command: 'npm',
    forced: MAP_ONLY,
    knobs: PHONE_ENV,
    label: 'convert the ground and nothing else — no models, no collision bake',
    long: true,
  },
  // The baked 3D city map (201/6-01): the cell LOD tier as the world's ONLY tier. It is the `phone` ritual
  // with `--lod-only`, in its own folder — a pak with one tier and a pak with two are different builds, and
  // the reuse check compares recipes rather than folder names.
  map3d: {
    args: ['run', 'phone'],
    command: 'npm',
    forced: { LODONLY: '1' },
    knobs: PHONE_ENV,
    label: 'convert the baked 3D city map — the LOD tier as the only tier',
    long: true,
    outSuffix: '-map3d',
  },
  // The last tap in the measurement loop (plan 002): a page has to EXIST before an agent can read or drive
  // it, and until this job that first step was a person holding the phone. `open.mjs` builds the address
  // from the same rule the page's own links use, refuses one nothing is serving, and says which package is
  // missing when the phone cannot open a URL at all.
  open: {
    args: ['tools-debug/phone-console/open.mjs'],
    command: 'node',
    knobs: { DISTRICT: PHONE_ENV.DISTRICT, LINK: /^[a-z]{3,12}$/, OUT: PHONE_ENV.OUT },
    label: 'open one of the panel links in the browser on this phone',
    long: false,
  },
  phone: {
    args: ['run', 'phone'],
    command: 'npm',
    knobs: PHONE_ENV,
    label: 'convert if needed, verify the pak, serve, print the URLs',
    long: true,
  },
  pull: {
    // --ff-only: a panel that can produce a merge commit on a phone is a panel that can produce a conflict
    // nobody can resolve on a phone.
    args: ['pull', '--ff-only'],
    command: 'git',
    label: 'git pull --ff-only',
    long: false,
  },
  // The way out of a branch that has diverged, and the ONE history operation this panel runs. It is safe
  // here for a specific reason: what the phone commits is capture files under
  // `docs/benchmarks/opensa-engine/` that nobody else writes, and they are not on the remote yet — so they
  // are replayed on top rather than rewritten in place, and there is nothing to conflict with.
  rebase: {
    args: ['pull', '--rebase'],
    command: 'git',
    label: 'replay what this phone committed on top of the remote',
    long: false,
  },
  setup: {
    args: ['run', 'phone:setup'],
    command: 'npm',
    label: 'install what a run needs (idempotent)',
    long: false,
  },
  // The one-file console (201/2-02). It is here rather than in a terminal because the thing it produces is
  // checked BY OPENING IT on this device — a build whose whole claim is that it fetches nothing beside
  // itself is not verified by a build log.
  share: {
    args: ['run', 'build:share:dispatch'],
    command: 'npm',
    label: 'build the shareable console — one file, streams a real pak',
    long: false,
  },
  // `--no-save`, like every install this panel runs: `npm i <pkg>` writes the package into package.json, and
  // a dirty package.json on this device is a `git pull` that refuses (2026-08-23).
  sirv: {
    args: ['i', 'sirv', '--no-save', '--no-audit', '--no-fund'],
    command: 'npm',
    label: 'reinstall sirv — the static server that hands out the pak',
    long: false,
  },
  // The one job that is a shell line, and it is a FIXED one — no input reaches it. `rm -rf build/webapp`
  // would be the obvious command and is the wrong one: that path is routinely a symlink into shared storage,
  // so only its `assets/` is cleared (chunk names are content-hashed, and extracting over them leaves every
  // old chunk in place, indistinguishable from a live file when something is being diagnosed).
  webapp: {
    args: ['-c', 'rm -rf build/webapp/assets && tar -xzf prebuilt/opensa-webapp.tar.gz -C build/webapp'],
    command: 'bash',
    label: 're-unpack the prebuilt app over the served copy',
    long: false,
  },
};

/**
 * The one running job, its ring buffer, and the listeners watching it.
 *
 * The buffer is why a phone can watch a convert at all: the screen sleeps, the browser drops the connection,
 * and on reconnect the page must show what happened rather than an empty box waiting for the next line.
 */
export class JobRunner {
  /** @param {{cwd: string, logFile?: string, onLine: (line: string) => void, ringLines?: number}} options */
  constructor(options) {
    this.cwd = options.cwd;
    this.onLine = options.onLine;
    this.ringLines = options.ringLines ?? 400;
    /**
     * Where every line is ALSO written, and the reason it exists: this device kills Termux, which takes the
     * panel and its ring buffer with it — so the record of a convert that died was itself destroyed by the
     * thing that killed it, and "where did it die" could only be answered by watching it happen. The file
     * outlives the process.
     */
    this.logFile = options.logFile;
    this.lines = [];
    this.current = null;
    if (this.logFile !== undefined) {
      try {
        mkdirSync(dirname(this.logFile), { recursive: true });
      } catch {
        this.logFile = undefined;
      }
    }
  }

  /** Everything the buffer still holds, for a page that just connected. */
  backlog() {
    return this.lines;
  }

  /**
   * The tail of what the LAST session logged, for a panel that came up after a kill.
   *
   * Read from disk rather than memory on purpose: the interesting case is the one where this process is not
   * the process that wrote it.
   */
  previous(lines = 60) {
    if (this.logFile === undefined) {
      return [];
    }
    try {
      return readFileSync(this.logFile, 'utf8').split('\n').filter(Boolean).slice(-lines);
    } catch {
      return [];
    }
  }

  push(line) {
    const clean = stripAnsi(line);
    this.lines.push(clean);
    if (this.lines.length > this.ringLines) {
      this.lines.splice(0, this.lines.length - this.ringLines);
    }
    if (this.logFile !== undefined) {
      // Synchronous and unbuffered: the whole point is the line that was written a moment before the process
      // was killed, and a stream that batches is a stream that loses exactly that line.
      try {
        // LOCAL time, not `toISOString()`. The first log this wrote stamped UTC while the phone's clock read
        // UTC+3, so every line was three hours off the wall clock it was being compared against — on a file
        // whose whole job is answering "how long in did it die".
        appendFileSync(this.logFile, `${new Date().toLocaleTimeString('en-GB', { hour12: false })} ${clean}\n`);
      } catch {
        this.logFile = undefined;
      }
    }
    this.onLine(clean);
  }

  /** Start a job. Throws — by name — when one is already running. */
  start(plan) {
    if (this.current !== null) {
      throw new Error(`'${this.current.id}' is still running — stop it first`);
    }
    this.push('');
    this.push(`$ ${plan.command} ${plan.args.join(' ')}${describeEnv(plan.env)}`);
    for (const note of plan.dropped) {
      this.push(`  dropped ${note}`);
    }
    // `detached` puts the job in its own process group, so stopping it reaches every child — npm's shell,
    // the convert, vite and the static server. Killing the parent alone leaves a server holding its port,
    // which is the difference between a next run that works and one that says the port is busy.
    const child = spawn(plan.command, plan.args, {
      cwd: this.cwd,
      detached: true,
      env: { ...process.env, ...plan.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.current = { child, id: plan.id, since: Date.now() };
    const read = (stream) => {
      let rest = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        const parts = (rest + chunk).split('\n');
        rest = parts.pop() ?? '';
        for (const line of parts) {
          this.push(line);
        }
      });
    };
    read(child.stdout);
    read(child.stderr);
    child.on('close', (code, signal) => {
      this.push(`— ${plan.id} finished (${signal ?? `exit ${code}`})`);
      this.current = null;
    });
    child.on('error', (error) => {
      this.push(`— ${plan.id} could not start: ${error.message}`);
      this.current = null;
    });

    return this.status();
  }

  /** What is running, or null — the page polls this so a reopened panel knows the state. */
  status() {
    return this.current === null
      ? { running: false }
      : { id: this.current.id, running: true, since: this.current.since };
  }

  /** Stop the running job and everything it started. */
  stop() {
    if (this.current === null) {
      return { running: false };
    }
    const { child, id } = this.current;
    this.push(`— stopping ${id}…`);
    try {
      // Negative pid = the whole process group, which is what `detached` above bought.
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }

    return { running: true, stopping: true };
  }
}

/**
 * Turn a job id and the page's form into the exact process to spawn.
 *
 * Pure, so the interesting half — which env survives, and what a bad value does — is tested without starting
 * anything.
 */
export function buildJob(id, form = {}) {
  const job = JOBS[id];
  if (!job) {
    throw new Error(`unknown job '${id}' — known: ${Object.keys(JOBS).join(', ')}`);
  }
  const env = {};
  const dropped = [];
  for (const [key, raw] of Object.entries(form)) {
    const value = String(raw).trim();
    if (value === '') {
      continue;
    }
    const allowed = job.knobs?.[key];
    if (allowed === undefined) {
      dropped.push(`${key} (not a knob of this job)`);
    } else if (!allowed.test(value)) {
      dropped.push(`${key}=${value} (not the shape ${key} takes)`);
    } else {
      env[key] = value;
    }
  }
  if (job.forced) {
    // Last, so nothing the page sends can turn a map-only run back into a full one — and into its OWN folder,
    // because the alternative is worse than it looks: `phone.sh` checks an existing pak against the recipe it
    // was asked for and REFUSES when they differ, so a map-only run over a full pak's folder would serve
    // nothing, and forcing a rebuild instead would throw the full pak away every time the button is pressed.
    Object.assign(env, job.forced, { OUT: suffixedOut(env.OUT, job.outSuffix ?? '-map') });
  }

  return { args: job.args, command: job.command, dropped, env, id, label: job.label, long: job.long };
}

/**
 * The folder a map-only pak lives in: the requested one with `-map` on the end, idempotent.
 *
 * The default matches `scripts/phone.sh`'s own (`./build/phone`), so a form that sent no output folder — or
 * one whose value was dropped for its shape — still lands somewhere named for what it holds rather than in
 * whatever the last run used.
 */
export function mapOnlyOut(out) {
  return suffixedOut(out, '-map');
}

/**
 * The folder a build with its own recipe lives in: the requested one with `suffix` on the end, idempotent.
 *
 * Every such build needs one for the same reason (see `buildJob`): `phone.sh` refuses a pak whose recipe is
 * not the one asked for, so two recipes sharing a folder is a run that serves nothing or a rebuild that
 * throws the other pak away.
 */
export function suffixedOut(out, suffix) {
  const base = String(out ?? '')
    .trim()
    .replace(/\/+$/, '');
  const root = base === '' ? './build/phone' : base;

  return root.endsWith(suffix) ? root : `${root}${suffix}`;
}

function describeEnv(env) {
  const keys = Object.keys(env);

  return keys.length === 0 ? '' : `   [${keys.map((key) => `${key}=${env[key]}`).join(' ')}]`;
}

/**
 * Drop the terminal's own colour codes.
 *
 * `FORCE_COLOR=0` does not reach `scripts/phone-setup.sh`: it writes its headings with literal printf
 * escapes, as a shell script for a terminal should. On a page those bytes are not colour — they are
 * `[1m== environment[0m` across the middle of the line an operator is trying to read.
 *
 * The pattern is built from a character code rather than written as an escape, so the regex carries no
 * control character of its own.
 */
function stripAnsi(line) {
  return line.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[a-z]`, 'gi'), '');
}
