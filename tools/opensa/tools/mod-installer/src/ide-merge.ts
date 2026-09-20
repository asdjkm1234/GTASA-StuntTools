import { readFileSync, writeFileSync } from 'node:fs';

/**
 * The `<target>.merge` convention: a mod ships `multiobj.ide.merge` next to the game path it wants to EDIT
 * (not replace) — directives describe line-level changes applied to the CURRENT `--out` state of the target,
 * so merge-mods stack with each other and with earlier whole-file replacements. Grammar:
 *
 *   remove from "objs":
 *   1682, ap_radar1_01, ap_misc1bit, 100, 2097152
 *
 *   add to "anim":
 *   1682, ap_radar1_01, ap_misc1bit, radar, 600, 0
 *
 *   replace in "inst":
 *   - 710, vgs_palm01, 0, 2110.67, -977.73, 66.13, 0, 0, 0, 1, -1
 *   + 710, vgs_palm01, 0, 2110.67, -977.73, -300.0, 0, 0, 0, 1, -1
 *
 * Semantics depend on the TARGET file kind (plan 007) — IPL rows can't be keyed by ID (`inst` IDs repeat,
 * `occl` rows have none) and their ORDER is data (binary streams + `lod` columns reference rows by index):
 *
 * - `.ide` — `remove` deletes the section's entries by ID (the rest of the line is documentation — float
 *   formatting differs between tools, so byte-matching would be brittle); `add` appends to the section
 *   (created at the end of the file when absent), replacing a same-ID entry so stacking stays deterministic.
 * - `.ipl` — index-safe operations only: `add` appends verbatim before the section's `end` and `replace`
 *   swaps a row in place, so pre-existing rows keep their indexes; `remove` matches the full
 *   (whitespace-normalized) line, and for `inst` performs the full REBASE a mod author does by hand (plan
 *   008): every surviving row's `lod` above the removed index is decremented (an orphaned link — a row still
 *   pointing at the removed one — is an error), and the removed ORIGINAL indexes are reported so the
 *   installer can patch the area's binary streams the same way.
 * - `replace` (both kinds) — `-`/`+` line pairs; the `-` line is matched whitespace-normalized inside the
 *   section and replaced in place by the `+` line. First match wins (write the pair twice for duplicated
 *   stock rows); no match → warning.
 *
 * `#`/`//` comments are ignored.
 */

export interface MergeDirective {
  action: 'add' | 'remove' | 'replace';
  /** Raw entry lines under an add/remove directive (first cell = the ID key for `.ide` targets). */
  entries: string[];
  /** `-`/`+` line pairs of a replace directive. */
  pairs?: { from: string; to: string }[];
  section: string;
}

/** Which semantics the merge target uses — see the module doc. */
export type MergeTargetKind = 'ide' | 'ipl';

const DIRECTIVE = /^(remove from|add to|replace in)\s+"(\w+)"\s*:?$/i;

/**
 * Apply a parsed merge onto the target file's text; returns the new text + non-fatal warnings.
 * `removedInst` lists the ORIGINAL inst indexes deleted by `remove from "inst"` (`.ipl` targets, ascending) —
 * the installer patches the area's binary streams with exactly this list (plan 008).
 */
export function applyIdeMerge(
  targetText: string,
  directives: readonly MergeDirective[],
  kind: MergeTargetKind = 'ide',
): {
  removedInst: number[];
  text: string;
  warnings: string[];
} {
  const newline = targetText.includes('\r\n') ? '\r\n' : '\n';
  const lines = targetText.split(/\r?\n/);
  const warnings: string[] = [];
  const removedInst: number[] = [];

  for (const directive of directives) {
    if (directive.action === 'replace') {
      for (const pair of directive.pairs ?? []) {
        warnings.push(...replaceLine(lines, directive.section, pair));
      }
      continue;
    }
    for (const entry of directive.entries) {
      if (directive.action === 'remove') {
        warnings.push(...applyRemove(lines, directive.section, entry, kind, removedInst));
      } else if (kind === 'ide') {
        removeById(lines, directive.section, idOf(entry)); // same-id entry in the section is replaced
        addToSection(lines, directive.section, entry);
      } else {
        addToSection(lines, directive.section, entry); // ipl: append verbatim — never touch existing rows
      }
    }
  }

  return { removedInst, text: lines.join(newline), warnings };
}

/**
 * Merge `<mergePath>` into `<targetPath>` on disk (the installer entry point). Returns warnings + the
 * removed inst indexes (original space) the caller must mirror into the area's binary streams.
 */
export function mergeIdeFile(mergePath: string, targetPath: string): { removedInst: number[]; warnings: string[] } {
  const directives = parseMergeFile(readFileSync(mergePath, 'utf8'));
  const kind: MergeTargetKind = targetPath.toLowerCase().endsWith('.ipl') ? 'ipl' : 'ide';
  const { removedInst, text, warnings } = applyIdeMerge(readFileSync(targetPath, 'utf8'), directives, kind);
  writeFileSync(targetPath, text);

  return { removedInst, warnings };
}

/** Parse a `.merge` file into directives. Throws on lines outside a directive or malformed headers. */
export function parseMergeFile(text: string): MergeDirective[] {
  const directives: MergeDirective[] = [];
  let current: MergeDirective | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw).trim();
    if (line.length === 0) {
      continue;
    }
    const header = DIRECTIVE.exec(line);
    if (header) {
      current = directiveFrom(header[1], header[2]);
      directives.push(current);
      continue;
    }
    if (/^(?:remove|add|replace)\b/i.test(line)) {
      throw new Error(`malformed merge directive: "${line}" (expected e.g. 'add to "anim":')`);
    }
    if (!current) {
      throw new Error(`merge entry outside any directive: "${line}"`);
    }
    feedEntryLine(current, line);
  }
  assertPairsClosed(directives);

  return directives;
}

/** Append an entry inside the section (before its `end`), creating the section at the file end if absent. */
function addToSection(lines: string[], section: string, entry: string): void {
  const bounds = sectionBounds(lines, section);
  if (bounds) {
    lines.splice(bounds.end, 0, entry);

    return;
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  lines.push(section, entry, 'end', '');
}

/** Feed one `-`/`+` line into the replace directive's pair list, enforcing strict alternation. */
function appendPairLine(directive: MergeDirective, line: string): void {
  const pairs = directive.pairs!;
  const last = pairs[pairs.length - 1];
  if (line.startsWith('-')) {
    if (last && last.to === '') {
      throw new Error(`replace in "${directive.section}": '-' line without its '+' replacement: "${last.from}"`);
    }
    pairs.push({ from: line.slice(1).trim(), to: '' });

    return;
  }
  if (line.startsWith('+')) {
    if (!last || last.to !== '') {
      throw new Error(`replace in "${directive.section}": '+' line without a preceding '-' line: "${line}"`);
    }
    last.to = line.slice(1).trim();

    return;
  }
  throw new Error(`replace in "${directive.section}": expected a '-' or '+' line, got: "${line}"`);
}

/** Route a remove entry by target kind and section; inst removals go through the rebasing path. */
function applyRemove(
  lines: string[],
  section: string,
  entry: string,
  kind: MergeTargetKind,
  removedInst: number[],
): string[] {
  if (kind === 'ide') {
    return removeEntryById(lines, section, entry);
  }
  if (section === 'inst') {
    return removeInstWithRebase(lines, entry, removedInst);
  }

  return removeEntryByLine(lines, section, entry);
}

/** Every replace pair must have both its `-` and `+` line by the end of the file. */
function assertPairsClosed(directives: readonly MergeDirective[]): void {
  for (const directive of directives) {
    const open = directive.pairs?.find((pair) => pair.to === '');
    if (open) {
      throw new Error(`replace in "${directive.section}": '-' line without its '+' replacement: "${open.from}"`);
    }
  }
}

/** A fresh directive for the parsed header verb + section. */
function directiveFrom(verb: string, section: string): MergeDirective {
  const lower = verb.toLowerCase();
  const action = lower.startsWith('remove') ? 'remove' : lower.startsWith('replace') ? 'replace' : 'add';

  return { action, entries: [], section: section.toLowerCase(), ...(action === 'replace' ? { pairs: [] } : {}) };
}

/** Route one entry line into the current directive (a `-`/`+` pair line or a plain ID-keyed entry). */
function feedEntryLine(current: MergeDirective, line: string): void {
  if (current.action === 'replace') {
    appendPairLine(current, line);

    return;
  }
  if (/^[+-]\s/.test(line)) {
    throw new Error(`'-'/'+' pair lines belong under a 'replace in "…":' directive: "${line}"`);
  }
  if (idOf(line) === null) {
    throw new Error(`merge entry has no numeric ID: "${line}"`);
  }
  current.entries.push(line);
}

/** The numeric ID in an entry's first cell, or null. */
function idOf(entry: string): null | number {
  const id = Number(entry.split(',')[0].trim());

  return Number.isFinite(id) ? id : null;
}

/** The integer in the row's LAST comma cell (the text-inst `lod` column), or null. */
function lastCellInt(line: string): null | number {
  const cells = stripComment(line).split(',');
  const value = Number(cells[cells.length - 1].trim());

  return cells.length > 1 && Number.isInteger(value) ? value : null;
}

/** Comment-stripped, whitespace-collapsed form used for full-line matching. */
function normalizeLine(line: string): string {
  return stripComment(line).trim().replace(/\s+/g, ' ');
}

/** Delete the section's entries whose ID matches; true when something was removed. */
function removeById(lines: string[], section: string, id: null | number): boolean {
  const bounds = sectionBounds(lines, section);
  if (!bounds || id === null) {
    return false;
  }
  let removed = false;
  for (let at = bounds.end - 1; at > bounds.start; at -= 1) {
    if (idOf(stripComment(lines[at])) === id) {
      lines.splice(at, 1);
      removed = true;
    }
  }

  return removed;
}

/** `.ide` remove: delete the section's entries matching the ID; warning when nothing matched. */
function removeEntryById(lines: string[], section: string, entry: string): string[] {
  const id = idOf(entry);

  return removeById(lines, section, id) ? [] : [`remove from "${section}": id ${id} not found — skipped`];
}

/** `.ipl` remove for sections WITHOUT index coupling (`occl`, `cull`, …): delete the first matching row. */
function removeEntryByLine(lines: string[], section: string, entry: string): string[] {
  const bounds = sectionBounds(lines, section);
  if (!bounds) {
    return [`remove from "${section}": section not found — skipped`];
  }
  const wanted = normalizeLine(entry);
  for (let at = bounds.start + 1; at < bounds.end; at += 1) {
    if (normalizeLine(lines[at]) === wanted) {
      lines.splice(at, 1);

      return [];
    }
  }

  return [`remove from "${section}": line not found — skipped: ${entry}`];
}

/**
 * `.ipl` `remove from "inst"` (plan 008): delete the matched row AND rebase every surviving row's `lod` —
 * links above the removed index shift down by one; a link pointing AT the removed row is an error (the merge
 * must re-point or sink the referencing row first — an orphaned link is silent in-game corruption). The
 * removed row's ORIGINAL inst index (pre-any-removal space, instances only — comments don't count) is added
 * to `removedInst` for the installer's binary-stream patch.
 */
function removeInstWithRebase(lines: string[], entry: string, removedInst: number[]): string[] {
  const bounds = sectionBounds(lines, 'inst');
  if (!bounds) {
    return ['remove from "inst": section not found — skipped'];
  }
  const wanted = normalizeLine(entry);
  let instIndex = -1;
  let lineAt = -1;
  let walk = 0;
  for (let at = bounds.start + 1; at < bounds.end; at += 1) {
    const bare = normalizeLine(lines[at]);
    if (bare.length === 0) {
      continue; // comment/blank rows are transparent to the game parser and to indexing
    }
    if (bare === wanted && lineAt < 0) {
      instIndex = walk;
      lineAt = at;
    }
    walk += 1;
  }
  if (lineAt < 0) {
    return [`remove from "inst": line not found — skipped: ${entry}`];
  }

  for (let at = bounds.start + 1; at < bounds.end; at += 1) {
    if (at === lineAt || normalizeLine(lines[at]).length === 0) {
      continue;
    }
    const lod = lastCellInt(lines[at]);
    if (lod === null || lod < 0) {
      continue;
    }
    if (lod === instIndex) {
      throw new Error(
        `remove from "inst": row "${normalizeLine(lines[at])}" still links to the removed row (lod ${lod}) — ` +
          're-point or sink the referencing row first',
      );
    }
    if (lod > instIndex) {
      lines[at] = withLastCellInt(lines[at], lod - 1);
    }
  }
  lines.splice(lineAt, 1);

  // report in ORIGINAL index space: shift past every earlier-removed original at/below this position
  let original = instIndex;
  for (const removed of removedInst) {
    if (removed <= original) {
      original += 1;
    }
  }
  removedInst.push(original);
  removedInst.sort((a, b) => a - b);

  return [];
}

/** Swap the first row matching the pair's `-` line (normalized) for its `+` line, keeping the row's index. */
function replaceLine(lines: string[], section: string, pair: { from: string; to: string }): string[] {
  const bounds = sectionBounds(lines, section);
  if (!bounds) {
    return [`replace in "${section}": section not found — skipped`];
  }
  const wanted = normalizeLine(pair.from);
  const matches: number[] = [];
  for (let at = bounds.start + 1; at < bounds.end; at += 1) {
    if (normalizeLine(lines[at]) === wanted) {
      matches.push(at);
    }
  }
  if (matches.length === 0) {
    return [`replace in "${section}": line not found — skipped: ${pair.from}`];
  }
  lines[matches[0]] = pair.to;

  return matches.length > 1
    ? [`replace in "${section}": ${matches.length} rows matched — replaced the first (repeat the pair to hit the rest)`]
    : [];
}

/** Line indexes of a `section … end` block: `start` = header line, `end` = its `end` line. */
function sectionBounds(lines: string[], section: string): null | { end: number; start: number } {
  for (let at = 0; at < lines.length; at += 1) {
    if (lines[at].trim().toLowerCase() !== section) {
      continue;
    }
    for (let stop = at + 1; stop < lines.length; stop += 1) {
      if (lines[stop].trim().toLowerCase() === 'end') {
        return { end: stop, start: at };
      }
    }
  }

  return null;
}

function stripComment(line: string): string {
  return line.replace(/(?:#|\/\/).*$/, '');
}

/** Rewrite the integer in the row's last comma cell, preserving the rest of the line (incl. any comment). */
function withLastCellInt(line: string, value: number): string {
  const cut = line.lastIndexOf(',');

  return line.slice(0, cut + 1) + line.slice(cut + 1).replace(/-?\d+/, String(value));
}
