/**
 * The resume point of a run (plan 006): `<out>/.work-<target>/resume.json`, written after every stage and on
 * failure, read back by `--resume` to re-enter a failed run at its last finished step instead of stage 1.
 *
 * The whole safety of the feature is the REFUSAL: a resumed build over changed sources, a changed config or
 * changed code is a build nobody can reproduce, and it would be SILENT — the tree builds, it just does not
 * contain what the sources say. So the manifest carries what the run was made of, and a resume whose
 * fingerprint differs on any of it is refused, naming the difference.
 */
import type { BuildTarget } from '@opensa/tool-kit/target';

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const RESUME_FILE = 'resume.json';

/** What a resume compares — the run's identity minus its progress. */
export type ResumeIdentity = Pick<ResumeManifest, 'commit' | 'configHash' | 'sources' | 'target'>;

export interface ResumeManifest {
  /** `git rev-parse HEAD` of the run — a step's OUTPUT depends on the code that wrote it. */
  readonly commit: string;
  /** Hash of the resolved run config (target, excludes, until, procobj knobs, split buckets, …). */
  readonly configHash: string;
  /** Set when a step threw; cleared when the resume re-enters it. */
  readonly failed?: { readonly error: string; readonly step: string };
  /** Per source root, the fingerprint the run was made from. */
  readonly sources: Readonly<Record<string, SourceFingerprint>>;
  readonly stages: readonly ResumeStage[];
  readonly startedAt: string;
  readonly target: BuildTarget;
}

/** The manifest handles a run holds while it works — see {@link openResumeSession}. */
export interface ResumeSession {
  /** A step the run being resumed finished, or undefined (fresh run, or not done). */
  readonly doneStep: (name: string) => ResumeStage | undefined;
  /** The manifest of the run being resumed; null for a fresh run. */
  readonly previous: null | ResumeManifest;
  readonly recordFailure: (step: string, error: unknown) => void;
  readonly recordStep: (name: string, dir: string, seconds: number) => void;
}

/** One finished step of the run — a chain stage, a target (`sa`), or a target sub-step (`opensa-lod`, `pack`). */
export interface ResumeStage {
  /** The dir the step produced (a work stage dir or the final target dir). */
  readonly dir: string;
  readonly doneAt: string;
  readonly name: string;
  readonly seconds: number;
}

/** A cheap fingerprint of one source root: how many files, how many bytes, and the newest mtime. */
export interface SourceFingerprint {
  readonly bytes: number;
  readonly files: number;
  readonly newestMtimeMs: number;
}

/**
 * Refuse a resume whose identity differs from the run it would continue — naming every difference, because
 * the person reading it has to decide between re-running from scratch and putting the source back.
 */
export function assertResumable(previous: ResumeManifest, current: ResumeIdentity, work: string): void {
  const differences: string[] = [];
  if (previous.target !== current.target) {
    differences.push(`target: was ${previous.target}, now ${current.target}`);
  }
  if (previous.commit !== current.commit) {
    differences.push(
      `code: the run was made at ${previous.commit.slice(0, 10)}, HEAD is now ${current.commit.slice(0, 10)}`,
    );
  }
  if (previous.configHash !== current.configHash) {
    differences.push(`config: was ${previous.configHash}, now ${current.configHash} (a flag differs from the run's)`);
  }
  const roots = new Set([...Object.keys(previous.sources), ...Object.keys(current.sources)]);
  for (const root of [...roots].sort()) {
    const before = previous.sources[root];
    const after = current.sources[root];
    if (before === undefined || after === undefined) {
      differences.push(`${root}: ${before === undefined ? 'appeared' : 'disappeared'} since the run`);
    } else if (
      before.files !== after.files ||
      before.bytes !== after.bytes ||
      before.newestMtimeMs !== after.newestMtimeMs
    ) {
      differences.push(
        `${root}: changed since the run (${before.files} files / ${before.bytes} B → ${after.files} / ${after.bytes} B, ` +
          `newest ${new Date(before.newestMtimeMs).toISOString()} → ${new Date(after.newestMtimeMs).toISOString()})`,
      );
    }
  }
  if (differences.length > 0) {
    throw new Error(
      `--resume refused: ${work}/${RESUME_FILE} describes a run this one cannot continue — a resumed build over ` +
        `changed inputs is a build nobody can reproduce. Run without --resume.\n  ${differences.join('\n  ')}`,
    );
  }
}

/** Fingerprint every source root that exists (`--game`, each `mods-src/<game>/<stage>` folder). Metadata only. */
export function fingerprintSources(roots: Readonly<Record<string, string>>): Record<string, SourceFingerprint> {
  const out: Record<string, SourceFingerprint> = {};
  for (const [name, root] of Object.entries(roots)) {
    if (!existsSync(root)) {
      continue;
    }
    let files = 0;
    let bytes = 0;
    let newestMtimeMs = 0;
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (entry.isFile()) {
          const stat = statSync(path);
          files += 1;
          bytes += stat.size;
          newestMtimeMs = Math.max(newestMtimeMs, Math.floor(stat.mtimeMs));
        }
      }
    };
    walk(root);
    out[name] = { bytes, files, newestMtimeMs };
  }

  return out;
}

/** The repo's HEAD, or `unknown` outside a checkout — a resume from `unknown` to `unknown` is allowed. */
export function gitHead(cwd = process.cwd()): string {
  try {
    return execSync('git rev-parse HEAD', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown';
  }
}

/** A stable hash of the resolved run config — key order does not matter, values do. */
export function hashRunConfig(config: unknown): string {
  return createHash('sha1').update(stableJson(config)).digest('hex').slice(0, 12);
}

/**
 * Open the run's resume point. A fresh run WIPES the work dir and starts a manifest; `resume` reads the
 * manifest a failed run left, refuses it if the identity differs ({@link assertResumable}), keeps the work
 * dir, and clears the `failed` mark so the re-entered step records itself afresh.
 */
export function openResumeSession(options: {
  identity: ResumeIdentity;
  log: (message: string) => void;
  resume: boolean;
  work: string;
}): ResumeSession {
  const { identity, log, resume, work } = options;
  const previous = resume ? readResume(work) : null;
  if (resume && previous === null) {
    throw new Error(`--resume: nothing to resume — ${work} holds no ${RESUME_FILE} (no failed run of this target)`);
  }
  if (previous !== null) {
    assertResumable(previous, identity, work);
    const last = previous.stages[previous.stages.length - 1];
    log(
      previous.failed
        ? `resuming ${identity.target} after '${previous.failed.step}' failed (last finished step: ${last?.name ?? 'none'}, ${last?.doneAt ?? previous.startedAt})`
        : `resuming ${identity.target} — every recorded step is done`,
    );
  } else {
    rmSync(work, { force: true, recursive: true });
    mkdirSync(work, { recursive: true });
  }
  let manifest: ResumeManifest = previous
    ? { ...previous, failed: undefined }
    : { ...identity, stages: [], startedAt: new Date().toISOString() };
  writeResume(work, manifest);

  return {
    doneStep: (name) => previous?.stages.find((stage) => stage.name === name),
    previous,
    recordFailure(step, error): void {
      manifest = { ...manifest, failed: { error: error instanceof Error ? error.message : String(error), step } };
      writeResume(work, manifest);
    },
    recordStep(name, dir, seconds): void {
      manifest = {
        ...manifest,
        stages: [...manifest.stages, { dir, doneAt: new Date().toISOString(), name, seconds }],
      };
      writeResume(work, manifest);
    },
  };
}

export function readResume(work: string): null | ResumeManifest {
  const path = join(work, RESUME_FILE);
  if (!existsSync(path)) {
    return null;
  }

  return JSON.parse(readFileSync(path, 'utf8')) as ResumeManifest;
}

export function writeResume(work: string, manifest: ResumeManifest): void {
  writeFileSync(join(work, RESUME_FILE), JSON.stringify(manifest, null, 2));
}

/** JSON with object keys sorted at every level, so two equal configs hash equal. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  }

  return JSON.stringify(value) ?? 'null';
}
