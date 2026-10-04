/**
 * "Do these mods cover the work?" — shaped here, ANSWERED elsewhere.
 *
 * The tool that owns the data derives the readiness (for cutscenes that is `@opensa/vehicle-cutscene`'s
 * census, read out of the game's own IDE rows and archives). This file only turns that answer into
 * verdicts, and it deliberately knows nothing about what an `id` means — the moment it needs to, the
 * adapter belongs in the tool instead.
 */
import type { Verdict } from './verdict';

/** One unit of work the consumer offered to do. `id` is opaque here — it is only ever printed. */
export interface CoverageItem {
  readonly id: string;
  readonly ready: boolean;
  /** Why it is not ready, in the owning tool's words. Printed in `detail`, never interpreted. */
  readonly reason?: string;
}

export interface CoverageReport {
  readonly items: readonly CoverageItem[];
  /** Inputs the owning tool could not read at all — a broken mod folder, not a missing donor. */
  readonly unreadable?: readonly string[];
}

/**
 * Uncovered items are a WARNING, not a block: what has no donor keeps whatever it already had, which is a
 * correct and complete result — the user simply gets fewer custom ones than they may expect. The verdict
 * names them, because "12 of 21 covered" without the list is not actionable.
 *
 * `label` is the plural noun the consumer uses for an item ("cutscene slots"), so this file never has to
 * know one.
 */
export function checkCoverage(report: CoverageReport, label: string): Verdict[] {
  const verdicts: Verdict[] = (report.unreadable ?? []).map((source) => ({
    code: 'coverage.unreadable',
    detail: source,
    fix: `Remove or repair ${source}, then choose the folder again.`,
    level: 'error' as const,
    message: `${source} could not be read.`,
  }));

  if (report.items.length === 0) {
    verdicts.push({
      code: 'coverage.nothing-to-check',
      fix: `Choose a folder that holds ${label}.`,
      level: 'warning',
      message: `No ${label} were found.`,
    });

    return verdicts;
  }

  const uncovered = report.items.filter((item) => !item.ready);
  const covered = report.items.length - uncovered.length;

  if (uncovered.length > 0) {
    verdicts.push({
      code: 'coverage.incomplete',
      detail: uncovered.map((item) => (item.reason ? `${item.id} — ${item.reason}` : item.id)).join('\n'),
      fix: `Add a mod for the remaining ${label} if you want them replaced too — the rest stay as they are.`,
      level: 'warning',
      message: `${covered} of ${report.items.length} ${label} are covered.`,
    });

    return verdicts;
  }

  verdicts.push({
    code: 'coverage.complete',
    level: 'ok',
    message: `All ${report.items.length} ${label} are covered.`,
  });

  return verdicts;
}
