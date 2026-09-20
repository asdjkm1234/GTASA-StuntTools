/**
 * The shape of an answer to "can I proceed, and what do I tell the user?".
 *
 * The union is discriminated on `level` and the three members are NOT identical: an `error` must carry a
 * `fix`, because an error a user cannot act on is a crash with extra steps. That requirement is the reason
 * this type exists at all, so the compiler holds it rather than a review.
 */

/** A block. `fix` is required — see the note at the top of this file. */
export interface ErrorVerdict extends VerdictBase {
  /** What the user has to do before this can proceed. */
  readonly fix: string;
  readonly level: 'error';
}

/** Nothing to say beyond "this passed". */
export interface OkVerdict extends VerdictBase {
  readonly level: 'ok';
}

export type Verdict = ErrorVerdict | OkVerdict | WarningVerdict;

export type VerdictLevel = Verdict['level'];

/** Every verdict a run produced, plus the worst level among them. */
export interface VerdictReport {
  /** `ok` when there was nothing to report — an empty run blocks nobody. */
  readonly level: VerdictLevel;
  readonly verdicts: readonly Verdict[];
}

/** Worth saying, never a block. The consumer proceeds. */
export interface WarningVerdict extends VerdictBase {
  /** What to do about it, when there is something. */
  readonly fix?: string;
  readonly level: 'warning';
}

interface VerdictBase {
  /** Stable identifier a consumer can branch on or map to its own copy. Never parsed for meaning. */
  readonly code: string;
  /** The long form — paths, byte counts, the failing entries. For the log, not the headline. */
  readonly detail?: string;
  /** One line a non-developer can read. */
  readonly message: string;
}

const SEVERITY: Record<VerdictLevel, number> = { error: 2, ok: 0, warning: 1 };

/** Gather verdicts as they are — nothing is dropped, including the `ok`s — and report the worst level. */
export function collect(verdicts: readonly Verdict[]): VerdictReport {
  return { level: worstLevel(verdicts), verdicts };
}

/** The one question a consumer asks before it starts work. */
export function isBlocked(report: VerdictReport): boolean {
  return report.level === 'error';
}

/**
 * Run every check and collect all of it. Deliberately does NOT stop at the first error: a user who picked
 * two wrong folders should learn both at once.
 */
export function runChecks(checks: readonly (() => readonly Verdict[])[]): VerdictReport {
  return collect(checks.flatMap((check) => check()));
}

/** The worst of the levels present; `ok` for an empty list. */
export function worstLevel(verdicts: readonly Verdict[]): VerdictLevel {
  let worst: VerdictLevel = 'ok';

  for (const verdict of verdicts) {
    if (SEVERITY[verdict.level] > SEVERITY[worst]) {
      worst = verdict.level;
    }
  }

  return worst;
}
