import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { applyIdeMerge, type MergeTargetKind, parseMergeFile } from './ide-merge';
import { canonicalInstance, formatInstanceRow } from './stream-merge';

/**
 * `merge-gen` (plans 007/008): turn a whole-file replacement of a stock data file — or a whole binary-stream
 * entry — into the `.merge` edit that reproduces it, so map packs stop clobbering each other and stack in mod
 * order.
 *
 * Text files: per-section line diff (canonical rows — floats at 6 significant digits, since mod exporters
 * reformat them) classified into the grammar:
 *
 * - aligned modifications → `replace` pairs (row keeps its index);
 * - `.ipl` `inst` deletions → `remove` directives, found by ITERATIVE SIMULATION: apply one remove (whose
 *   apply-time rebase shifts every later lod, in text and streams), re-diff, repeat — the author's hand-made
 *   rebase edits collapse into nothing (plan 008);
 * - insertions → `add` (appends; a mid-section insert is RELOCATED to the end — row position is meaningless
 *   to the game, only indexes matter — with the added rows' own `lod` links remapped from the author's layout
 *   into the final one). Every surviving row keeps its vanilla index, so companion streams stay valid.
 * - `.ide` deletions → `remove` by id (must be unique in the section); brand-new ids → `add`;
 *
 * then GATES on a roundtrip. For `.ipl` inst the check is SEMANTIC: the applied file must place the same rows
 * (lod column aside) and every row's lod must resolve to the same TARGET ROW as in the author's file —
 * layout-independent link equivalence. For `.ide`, per-section row multisets.
 *
 * The inst conversion also returns `authorToFinal` — the author-layout→final-layout inst index map — which
 * {@link generateStreamMerge} uses to re-express the author's binary streams against the converted text.
 */
export type ConvertResult =
  | { authorToFinal?: number[]; kind: 'merge'; text: string }
  | { kind: 'refused'; reason: string };

/** One `section … end` block (semantic rows only) or the raw lines between blocks. */
type Block = { lines: string[]; type: 'outside' } | { name: string; rows: string[]; type: 'section' };

export function generateMerge(vanillaText: string, moddedText: string, kind: MergeTargetKind): ConvertResult {
  if (semanticLines(vanillaText) === semanticLines(moddedText)) {
    return { kind: 'refused', reason: 'files are identical' };
  }
  const skeleton = compareSkeleton(parseBlocks(vanillaText), parseBlocks(moddedText));
  if (skeleton) {
    return { kind: 'refused', reason: skeleton };
  }

  return kind === 'ipl' ? convertIpl(vanillaText, moddedText) : convertIde(vanillaText, moddedText);
}

// ---------------------------------------------------------------------------------------------------- .ide

/**
 * Express a modded binary stream as a `.merge` over the vanilla entry (plan 008). The modded instances' lod
 * links live in the AUTHOR's text layout — `remapLod` (from the area's text conversion, identity when the
 * text is unchanged) carries them into the final layout. Instance identity = id+interior+pos+rot; a lod-only
 * difference becomes a `replace` pair. Returns `identical` when nothing differs after the remap.
 */
export function generateStreamMerge(
  vanillaEntry: ArrayBuffer,
  moddedEntry: ArrayBuffer,
  parse: (
    buffer: ArrayBuffer,
  ) => { id: number; interior: number; lod: number; position: readonly number[]; rotation: readonly number[] }[],
  remapLod: (authorLod: number) => number = (lod) => lod,
): { kind: 'identical' } | { kind: 'merge'; text: string } {
  const vanilla = parse(vanillaEntry);
  const modded = parse(moddedEntry).map((inst) => ({ ...inst, lod: inst.lod < 0 ? inst.lod : remapLod(inst.lod) }));
  // Identity = id + interior + position ONLY: mod tools re-export streams with recomputed quaternions
  // (-q ≡ q rotationally) — rotation or lod differences become replace pairs, not remove+add churn.
  const identity = (inst: (typeof vanilla)[number]): string =>
    [inst.id, inst.interior, ...inst.position].map((value) => Number(value).toPrecision(6)).join(',');
  const vMap = new Map(vanilla.map((inst) => [identity(inst), inst]));
  const mMap = new Map(modded.map((inst) => [identity(inst), inst]));

  const pairs: { from: string; to: string }[] = [];
  const adds: string[] = [];
  const removes: string[] = [];
  for (const [key, mInst] of mMap) {
    const vInst = vMap.get(key);
    if (!vInst) {
      adds.push(formatInstanceRow(mInst as never));
    } else if (
      canonicalInstance(vInst as never) !== canonicalInstance(mInst as never) &&
      !quatEquivalent(vInst, mInst)
    ) {
      pairs.push({ from: formatInstanceRow(vInst as never), to: formatInstanceRow(mInst as never) });
    }
  }
  for (const [key, vInst] of vMap) {
    if (!mMap.has(key)) {
      removes.push(formatInstanceRow(vInst as never));
    }
  }
  if (pairs.length + adds.length + removes.length === 0) {
    return { kind: 'identical' };
  }
  const out: string[] = [];
  emitSection(out, 'inst', pairs, removes, adds);

  return { kind: 'merge', text: out.join('\n') + '\n' };
}

// ---------------------------------------------------------------------------------------------------- .ipl

/**
 * Layout-independent inst equivalence: same rows (lod aside) and every row's lod resolves to the same TARGET
 * row. Non-inst sections compare as sorted canonical multisets. Returns the first mismatch, or null.
 */
export function iplSemanticMismatch(aText: string, bText: string): null | string {
  const aSections = sections(aText);
  const bSections = sections(bText);
  if (aSections.map((s) => s.name).join() !== bSections.map((s) => s.name).join()) {
    return 'section layout differs';
  }
  for (let at = 0; at < aSections.length; at += 1) {
    const name = aSections[at].name;
    if (name === 'inst') {
      const a = instFingerprint(aSections[at].rows);
      const b = instFingerprint(bSections[at].rows);
      if (a !== b) {
        return 'inst rows / links differ';
      }
      continue;
    }
    const bag = (rows: readonly string[]): string => rows.map(canonicalRow).sort().join('|');
    if (bag(aSections[at].rows) !== bag(bSections[at].rows)) {
      return `"${name}" rows differ`;
    }
  }

  return null;
}

/**
 * A row's comparison key: comment-stripped, whitespace-collapsed, numeric cells rounded to 6 significant
 * digits, name cells lowercased. Mod tools re-export data files with reformatted floats
 * (`1640.078125` → `1640.08`) — byte comparison would read the whole file as edited; 6 significant digits is
 * exactly the observed exporter precision, and a sub-6th-digit coordinate nudge is far below visibility.
 */
function canonicalRow(line: string): string {
  const bare = normalizeLine(line);
  if (bare.length === 0) {
    return '';
  }

  return bare
    .split(',')
    .map((cell) => {
      const trimmed = cell.trim();
      const numeric = Number(trimmed);

      return trimmed !== '' && Number.isFinite(numeric) ? numeric.toPrecision(6) : trimmed.toLowerCase();
    })
    .join(',');
}

/**
 * Align two row lists (LCS on canonical rows) and classify: positionally paired delete+insert runs become
 * replace pairs; leftovers are removals/additions. `alignment` lists the surviving (a-idx, b-idx)
 * correspondences — matches AND pair replacements.
 */
function classifyDiff(
  aRows: readonly string[],
  bRows: readonly string[],
): {
  added: { idx: number; row: string }[];
  alignment: [number, number][];
  pairs: { from: string; to: string }[];
  removed: { idx: number; row: string }[];
} {
  const a = aRows.map(canonicalRow);
  const b = bRows.map(canonicalRow);
  const lcs = lcsTable(a, b);
  const pairs: { from: string; to: string }[] = [];
  const removed: { idx: number; row: string }[] = [];
  const added: { idx: number; row: string }[] = [];
  const alignment: [number, number][] = [];

  let i = 0;
  let j = 0;
  // Pair a hunk's deletions to its insertions: rows that differ ONLY in the lod cell pair up first (the
  // hand-rebase shape), the remainder pairs positionally — so a deletion next to an unrelated lod edit is
  // classified as the removal, not spliced into a misleading replace.
  const bareKey = (canon: string): string => canon.slice(0, canon.lastIndexOf(','));
  const hunkFlush = (deletions: number[], insertions: number[]): void => {
    const freeInsertions = [...insertions];
    const matchedPairs: [number, number][] = [];
    const unmatchedDeletions: number[] = [];
    for (const del of deletions) {
      const at = freeInsertions.findIndex((ins) => bareKey(a[del]) === bareKey(b[ins]));
      if (at >= 0) {
        matchedPairs.push([del, freeInsertions[at]]);
        freeInsertions.splice(at, 1);
      } else {
        unmatchedDeletions.push(del);
      }
    }
    const positional = Math.min(unmatchedDeletions.length, freeInsertions.length);
    for (let p = 0; p < positional; p += 1) {
      matchedPairs.push([unmatchedDeletions[p], freeInsertions[p]]);
    }
    for (const [del, ins] of matchedPairs.sort((x, y) => x[0] - y[0])) {
      pairs.push({ from: aRows[del], to: bRows[ins] });
      alignment.push([del, ins]);
    }
    for (let p = positional; p < unmatchedDeletions.length; p += 1) {
      removed.push({ idx: unmatchedDeletions[p], row: aRows[unmatchedDeletions[p]] });
    }
    for (const ins of freeInsertions.slice(positional)) {
      added.push({ idx: ins, row: bRows[ins] });
    }
  };
  const isMatch = (): boolean => i < a.length && j < b.length && a[i] === b[j];
  while (i < a.length || j < b.length) {
    if (isMatch()) {
      alignment.push([i, j]);
      i += 1;
      j += 1;
      continue;
    }
    const deletions: number[] = [];
    const insertions: number[] = [];
    while ((i < a.length || j < b.length) && !isMatch()) {
      if (j >= b.length || (i < a.length && lcs[i + 1][j] >= lcs[i][j + 1])) {
        deletions.push(i);
        i += 1;
      } else {
        insertions.push(j);
        j += 1;
      }
    }
    hunkFlush(deletions, insertions);
  }

  return { added, alignment, pairs, removed };
}

/** Refusal reason when the files' section/outside skeletons differ, else null. */
function compareSkeleton(vanilla: readonly Block[], modded: readonly Block[]): null | string {
  const names = (blocks: readonly Block[]): string =>
    blocks
      .filter((block) => block.type === 'section')
      .map((block) => block.name)
      .join(',');
  if (names(vanilla) !== names(modded)) {
    return `section layout differs (vanilla: ${names(vanilla)}; modded: ${names(modded)})`;
  }
  const outside = (blocks: readonly Block[]): string =>
    blocks
      .filter((block) => block.type === 'outside')
      .flatMap((block) => block.lines)
      .map(canonicalRow)
      .filter((line) => line.length > 0)
      .join('\n');
  if (outside(vanilla) !== outside(modded)) {
    return 'changes outside any section — not expressible as section directives';
  }

  return null;
}

function convertIde(vanillaText: string, moddedText: string): ConvertResult {
  const vanillaSections = sections(vanillaText);
  const moddedSections = sections(moddedText);
  const out: string[] = [];
  for (let at = 0; at < vanillaSections.length; at += 1) {
    const vanilla = vanillaSections[at];
    const { added, pairs, removed } = classifyDiff(vanilla.rows, moddedSections[at].rows);
    if (pairs.length + added.length + removed.length === 0) {
      continue;
    }
    for (const line of removed) {
      const id = line.row.split(',')[0].trim();
      if (vanilla.rows.filter((row) => row.split(',')[0].trim() === id).length > 1) {
        return { kind: 'refused', reason: `removes one of several id-${id} rows in "${vanilla.name}" — ambiguous` };
      }
    }
    emitSection(
      out,
      vanilla.name,
      pairs,
      removed.map((r) => r.row),
      added.map((a) => a.row),
    );
  }
  if (out.length === 0) {
    return { kind: 'refused', reason: 'no expressible changes found' };
  }
  const text = out.join('\n') + '\n';
  const applied = applyIdeMerge(vanillaText, parseMergeFile(text), 'ide').text;
  const bag = (t: string): string =>
    sections(t)
      .map((s) => `${s.name}:${s.rows.map(canonicalRow).sort().join('|')}`)
      .join('\n');
  if (bag(applied) !== bag(moddedText)) {
    return { kind: 'refused', reason: 'roundtrip mismatch: applied sections differ from the modded file' };
  }

  return { kind: 'merge', text };
}

// ------------------------------------------------------------------------------------------------- streams

function convertIpl(vanillaText: string, moddedText: string): ConvertResult {
  // Phase 1 — inst removals by iterative simulation: each applied remove rebases the text (the author's
  // manual lod-shift edits then compare equal and drop out of the residual diff).
  let current = vanillaText;
  const removeDirectives: string[] = [];
  for (;;) {
    const currentInst = sectionRows(current, 'inst');
    const moddedInst = sectionRows(moddedText, 'inst');
    const { removed } = classifyDiff(currentInst, moddedInst);
    if (removed.length === 0) {
      break;
    }
    const line = removed[0].row;
    removeDirectives.push(line);
    try {
      current = applyIdeMerge(current, parseMergeFile(`remove from "inst":\n${line}`), 'ipl').text;
    } catch (error) {
      return { kind: 'refused', reason: error instanceof Error ? error.message : String(error) };
    }
  }

  // Phase 2 — residual per-section pairs/adds against the post-remove text; inst adds are appended with
  // their lod links remapped author→final.
  const out: string[] = [];
  if (removeDirectives.length > 0) {
    out.push('remove from "inst":', ...removeDirectives, '');
  }
  const currentSections = sections(current);
  const moddedSections = sections(moddedText);
  let authorToFinal: number[] | undefined;
  for (let at = 0; at < currentSections.length; at += 1) {
    const section = currentSections[at];
    const { added, pairs, removed } = classifyDiff(section.rows, moddedSections[at].rows);
    if (section.name !== 'inst') {
      if (added.length + pairs.length + removed.length > 0) {
        emitSection(
          out,
          section.name,
          pairs,
          removed.map((r) => r.row),
          added.map((a) => a.row),
        );
      }
      continue;
    }

    // inst: build the author→final index map, then remap lod cells of '+' pair rows and added rows.
    const map = instAuthorToFinal(section.rows, moddedSections[at].rows, added);
    authorToFinal = map;
    const remap = (row: string): string => remapLodCell(row, map, moddedSections[at].rows.length);
    emitSection(
      out,
      'inst',
      pairs.map((pair) => ({ from: pair.from, to: remap(pair.to) })),
      [],
      added.map((a) => remap(a.row)),
    );
  }
  if (out.length === 0) {
    return { kind: 'refused', reason: 'no expressible changes found' };
  }

  const text = out.join('\n') + '\n';
  let applied: string;
  try {
    applied = applyIdeMerge(vanillaText, parseMergeFile(text), 'ipl').text;
  } catch (error) {
    return { kind: 'refused', reason: error instanceof Error ? error.message : String(error) };
  }
  const mismatch = iplSemanticMismatch(applied, moddedText);
  if (mismatch) {
    return { kind: 'refused', reason: `roundtrip mismatch: ${mismatch}` };
  }

  return { authorToFinal, kind: 'merge', text };
}

function emitSection(
  out: string[],
  section: string,
  pairs: readonly { from: string; to: string }[],
  removed: readonly string[],
  added: readonly string[],
): void {
  if (removed.length > 0) {
    out.push(`remove from "${section}":`, ...removed, '');
  }
  if (pairs.length > 0) {
    out.push(`replace in "${section}":`);
    for (const pair of pairs) {
      out.push(`- ${pair.from}`, `+ ${pair.to}`);
    }
    out.push('');
  }
  if (added.length > 0) {
    out.push(`add to "${section}":`, ...added, '');
  }
}

// ------------------------------------------------------------------------------------------------- shared

/**
 * Author-layout inst index → final-layout inst index. Final layout = post-remove survivors in vanilla order,
 * then the added rows appended in author order. Survivor correspondence comes from the LCS alignment.
 */
function instAuthorToFinal(
  finalSurvivors: readonly string[],
  authorRows: readonly string[],
  added: readonly { idx: number; row: string }[],
): number[] {
  const map = new Array<number>(authorRows.length).fill(-1);
  const { alignment } = classifyDiff(finalSurvivors, authorRows);
  for (const [finalIdx, authorIdx] of alignment) {
    map[authorIdx] = finalIdx;
  }
  added.forEach((add, order) => {
    map[add.idx] = finalSurvivors.length + order;
  });

  return map;
}

/** Sorted multiset of `row-without-lod → link-target-row-without-lod` — the inst section's true semantics. */
function instFingerprint(rows: readonly string[]): string {
  const bare = rows.map((row) => {
    const canon = canonicalRow(row);

    return canon.slice(0, canon.lastIndexOf(','));
  });
  const lods = rows.map((row) => {
    const canon = canonicalRow(row);
    const lod = Number(canon.slice(canon.lastIndexOf(',') + 1));

    return Number.isInteger(lod) && lod >= 0 && lod < rows.length ? lod : -1;
  });

  return rows
    .map((_, i) => `${bare[i]} -> ${lods[i] === -1 ? '-1' : bare[lods[i]]}`)
    .sort()
    .join('\n');
}

/** Standard LCS length table for the two canonical row lists. */
function lcsTable(a: readonly string[], b: readonly string[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  return table;
}

/** CLI: `tsx merge-gen.ts --vanilla <file> --modded <file> --out <file.merge>` (kind from the modded extension). */
function main(argv: readonly string[]): void {
  const arg = (name: string): string => {
    const at = argv.indexOf(name);
    if (at < 0 || at + 1 >= argv.length) {
      throw new Error(`missing ${name} <path>`);
    }

    return argv[at + 1];
  };
  const vanilla = arg('--vanilla');
  const modded = arg('--modded');
  // A stream indexes its area's TEXT layout, so converting one alone can only carry the AUTHOR's indexes into
  // a file whose rows we are about to renumber — the defect that shipped in `0. Map Fixes Pack`. Folder mode
  // is the only path that has the text conversion's index map to hand.
  if (/_stream\d+\.ipl$/i.test(modded)) {
    console.error(
      `${modded} is a binary stream — convert the whole mod instead, so its lod links can be re-expressed ` +
        'against the converted text IPL: npx tsx tools/mod-installer/src/merge-gen-mod.ts ' +
        '--vanilla <game-dir> --mod <mod-dir> [--write]',
    );
    process.exitCode = 1;

    return;
  }
  const kind: MergeTargetKind = modded.toLowerCase().endsWith('.ipl') ? 'ipl' : 'ide';
  const result = generateMerge(readFileSync(vanilla, 'utf8'), readFileSync(modded, 'utf8'), kind);
  if (result.kind === 'refused') {
    console.error(`not convertible: ${result.reason}`);
    process.exitCode = 1;

    return;
  }
  writeFileSync(arg('--out'), result.text);
  console.log(`wrote ${arg('--out')}`);
}

function normalizeLine(line: string): string {
  return line
    .replace(/(?:#|\/\/).*$/, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Split a data file into `section … end` blocks and the raw lines between them. */
function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let outside: string[] = [];
  let section: Extract<Block, { type: 'section' }> | null = null;
  for (const line of text.split(/\r?\n/)) {
    const bare = normalizeLine(line);
    if (section) {
      if (bare === 'end') {
        blocks.push(section);
        section = null;
      } else if (bare.length > 0) {
        // comment-only / blank rows are transparent to the game parser AND to lod indexing — skip them so a
        // mod dropping a comment doesn't read as a row deletion
        section.rows.push(line);
      }
      continue;
    }
    if (/^\w+$/.test(bare) && bare !== 'end' && bare.length > 0) {
      if (outside.length > 0) {
        blocks.push({ lines: outside, type: 'outside' });
        outside = [];
      }
      section = { name: bare.toLowerCase(), rows: [], type: 'section' };
      continue;
    }
    outside.push(line);
  }
  if (section) {
    blocks.push(section); // unterminated section — tolerated, roundtrip will judge
  }
  if (outside.length > 0) {
    blocks.push({ lines: outside, type: 'outside' });
  }

  return blocks;
}

/**
 * Same instance state up to quaternion noise and sign (-q and q are the same rotation) and lod. Mod tools
 * write rotations with ~5 decimals — component drift below 5e-4 is far under a visible angle, while a real
 * rotation edit moves components by orders of magnitude more.
 */
function quatEquivalent(
  a: { lod: number; rotation: readonly number[] },
  b: { lod: number; rotation: readonly number[] },
): boolean {
  if (a.lod !== b.lod) {
    return false;
  }
  const TOLERANCE = 5e-4;
  const same = a.rotation.every((v, i) => Math.abs(v - b.rotation[i]) <= TOLERANCE);
  const negated = a.rotation.every((v, i) => Math.abs(v + b.rotation[i]) <= TOLERANCE);

  return same || negated;
}

/** Rewrite the row's lod cell (last cell) from author index space into the final one. */
function remapLodCell(row: string, authorToFinal: readonly number[], authorCount: number): string {
  const cut = row.lastIndexOf(',');
  const cell = row
    .slice(cut + 1)
    .replace(/(?:#|\/\/).*$/, '')
    .trim();
  const lod = Number(cell);
  if (cut < 0) {
    return row;
  }
  if (!Number.isInteger(lod)) {
    // A malformed lod cell (seen in the wild: a bare "-" at a mod file's last row) crashes SA's sscanf-based
    // inst parser with a garbage index — repair to the obvious intent, "no LOD".
    return `${row.slice(0, cut + 1)} -1`;
  }
  if (lod < 0) {
    return row;
  }
  if (lod >= authorCount || authorToFinal[lod] < 0) {
    throw new Error(`row links to author inst index ${lod} which has no final position: ${row}`);
  }

  return row.slice(0, cut + 1) + row.slice(cut + 1).replace(/-?\d+/, String(authorToFinal[lod]));
}

function sectionRows(text: string, name: string): string[] {
  return sections(text).find((section) => section.name === name)?.rows ?? [];
}

function sections(text: string): Extract<Block, { type: 'section' }>[] {
  return parseBlocks(text).filter((block): block is Extract<Block, { type: 'section' }> => block.type === 'section');
}

/** The file's semantic lines: comments stripped, blank lines dropped — what SA's data parser actually reads. */
function semanticLines(text: string): string {
  return text
    .split(/\r?\n/)
    .map(canonicalRow)
    .filter((line) => line.length > 0)
    .join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
