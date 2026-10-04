/**
 * The way a measurement leaves the phone: filed into the repository, not read off a screen.
 *
 * `CLAUDE.md`'s standing rule is that every measured number is committed to `docs/benchmarks/` BEFORE it is
 * analysed, and the phone is where that rule is hardest to keep — the capture is a JSON blob behind a copy
 * button on a device with no editor worth the name, so it reaches the next session as a chat paste with its
 * conditions missing, or it does not reach it at all.
 *
 * So the panel takes the blob, writes the file the family's format asks for, stamps the conditions it can
 * PROVE (device, pak recipe, commit) into the note rather than trusting them to memory, and commits it.
 *
 * Two things it will not do, both deliberate:
 *
 * - **it never commits code.** Only the paths it just wrote are staged, and the commit names those paths, so
 *   a dirty worktree on a phone cannot be swept into a data commit;
 * - **it refuses a capture with no note.** A row nobody can place is a row nobody can compare, which the
 *   benchmark readme says in its first paragraph.
 */

/** The performance family's folder for our own engine, and the only place this panel writes captures. */
export const CAPTURE_DIR = 'docs/benchmarks/opensa-engine';
/** Long enough to say what the run was for. Shorter than this is not a note, it is a placeholder. */
const MIN_NOTE = 12;
/** Any letter of the Cyrillic block, including its supplements — the one script this repository keeps meeting. */
const CYRILLIC = /[\u0400-\u052F]/;

/** PMTiles v3 archives start with these seven bytes — an HTML error page saved as `tiles.pmtiles` does not. */
const PMTILES_MAGIC = 'PMTiles';

/** Where a capture lands: the family's naming rule, `<engine>/YYYY-MM-DD-<surface>-<what>.json`. */
export function capturePath(date, slug) {
  const clean = slugify(slug);
  if (clean === '') {
    throw new Error('a capture needs a name — it becomes the file name and the row nobody can place without');
  }
  // The family's rule is `YYYY-MM-DD-<surface>-<what>.json`, so a name is at least two words. One word is
  // what gets typed when the point is to test the button rather than to keep the run: `test` on 2026-08-23
  // and a row of keyboard mash on 2026-08-25, both of which had to be renamed by hand afterwards.
  if (!clean.includes('-')) {
    throw new Error(
      `'${clean}' is one word — a capture is named <surface>-<what>, like 'mobile-pinned-district-inventory'`,
    );
  }

  return `${CAPTURE_DIR}/${date}-${clean}.json`;
}

/**
 * Refuse anything that is not actually a PMTiles archive.
 *
 * The archive arrives from a browser download the operator picks out of a file dialog, and the neighbouring
 * files in that folder are HTML pages and half-finished downloads. One placed beside the pak under the right
 * name is silent by nature: the flat map simply draws nothing, exactly like a map that has not loaded.
 */
export function checkTilesArchive(bytes) {
  const head = Buffer.from(bytes.subarray(0, PMTILES_MAGIC.length)).toString('latin1');
  if (head !== PMTILES_MAGIC) {
    throw new Error(`that file is not a PMTiles archive (starts with "${head.replace(/[^\x20-\x7e]/g, '.')}")`);
  }

  return { bytes: bytes.byteLength };
}

/**
 * The git commands for filing exactly these paths.
 *
 * `HUSKY=0` because the phone has no dev tree: `phone:setup` installs with `--omit=dev`, so the pre-commit
 * hook's prettier, eslint and tsc are not there to run. It is husky's own opt-out and it edits nothing —
 * `npm pkg delete scripts.prepare` would leave the worktree dirty on the one machine where `git status` is
 * hardest to read.
 */
export function commitPlan(paths, subject) {
  if (paths.length === 0) {
    throw new Error('nothing to commit');
  }
  const outside = paths.filter((path) => !path.startsWith(`${CAPTURE_DIR}/`));
  if (outside.length > 0) {
    throw new Error(`this panel files data, never code — refusing ${outside.join(', ')}`);
  }
  const header = `chore(bench): ${subject}`.slice(0, 90);

  return {
    // GIT_TERMINAL_PROMPT=0: a push that needs credentials must FAIL rather than wait for a username on a
    // terminal nobody is looking at — a blocked git is indistinguishable, from the page, from a slow one.
    env: { GIT_TERMINAL_PROMPT: '0', HUSKY: '0' },
    steps: [
      ['git', ['add', '--', ...paths]],
      // The paths are named on the commit too, so whatever else is staged in this worktree stays behind.
      ['git', ['commit', '-m', header, '--', ...paths]],
    ],
  };
}

/** What the panel knows about the run without asking, from the pak's own `report.json`. */
export function pakFacts(report) {
  const build = report?.build;
  if (!build) {
    return { commit: null, pak: null };
  }
  const rect = Array.isArray(build.rect) ? build.rect.join(',') : 'auto-fit';

  return {
    commit: build.commit ?? null,
    pak: `${build.game ?? 'unknown'} rect ${rect} textures ${build.textures ?? 'unstated'} built ${build.at ?? 'unknown'}`,
  };
}

/**
 * The captures on disk that are not committed yet, out of `git status`'s paths.
 *
 * The panel used to remember what IT had filed, in the page's own memory — so a reload, a restarted server
 * or a phone that put the browser to sleep left a written capture that the panel then refused to commit
 * because it had forgotten writing it. The repository is the state; the page only shows it.
 */
export function pendingCaptures(paths) {
  return paths.filter((path) => path.startsWith(`${CAPTURE_DIR}/`) && path.endsWith('.json')).sort();
}

/**
 * Run a commit plan, writing every command and its output to the log AS IT HAPPENS.
 *
 * The order matters and it is the whole point: the first version collected the output and pushed it to the
 * log only after every step had succeeded, so a failed commit or push left the operator with one short line
 * on the page and no evidence anywhere — on the device where reading a terminal is hardest. Now the log
 * carries the failing command and git's own words, and the error the page shows is the first line of them.
 */
export async function runCommit({ branch, log, plan, push, run }) {
  const steps = push === true ? [...plan.steps, ['git', ['push', '-u', 'origin', branch]]] : [...plan.steps];
  for (const [command, args] of steps) {
    log(`$ ${command} ${args.join(' ')}`);
    let result;
    try {
      result = await run(command, args, plan.env);
    } catch (error) {
      const said = `${error?.stderr ?? ''}${error?.stdout ?? ''}`.trim() || String(error?.message ?? error);
      log(`— ${command} failed: ${said}`);
      throw new Error(`${command} ${args[0]} failed — ${said.split('\n')[0]}`, { cause: error });
    }
    const said = `${result?.stdout ?? ''}${result?.stderr ?? ''}`.trim();
    if (said !== '') {
      log(said);
    }
  }

  return { branch, pushed: push === true, steps: steps.length };
}

/** `Ganton, RGBA8 A/B` → `ganton-rgba8-a-b`. */
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * The capture as it will be written: the operator's note first, with the conditions the panel can prove
 * appended to it.
 *
 * The facts are appended to `note` rather than put in a key of their own because the family's format has one
 * place for conditions and a reader of ten-year-old rows should not have to know which tool wrote which.
 */
export function withNote(payload, note, facts) {
  const trimmed = String(note ?? '').trim();
  if (trimmed.length < MIN_NOTE) {
    throw new Error(
      `say what this run was for (at least ${MIN_NOTE} characters) — a row with no conditions cannot be compared`,
    );
  }
  // English only, repo-wide (`CLAUDE.md`) — and this panel is the one writing committed files on a device
  // whose operator types Russian, so it is where the rule has to be enforced rather than cleaned up later
  // (2026-08-24: the first capture landed with a Russian note and had to be rewritten after the fact).
  if (CYRILLIC.test(trimmed)) {
    throw new Error('the note must be in English — this file is committed, and the repository is English only');
  }
  const proven = [
    facts.device,
    facts.node ? `node ${facts.node}` : null,
    facts.pak ? `pak ${facts.pak}` : null,
    facts.commit ? `commit ${facts.commit}` : null,
    'captured through tools-debug/phone-console',
  ].filter((part) => part !== null && part !== '');

  return { ...payload, note: `${trimmed} — ${proven.join(' · ')}` };
}
