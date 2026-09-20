import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { openArchiveIndex } from '@opensa/tool-kit/archive/layout';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { applyIdeMerge, type MergeTargetKind, parseMergeFile } from './ide-merge';
import { generateMerge, generateStreamMerge } from './merge-gen';
import { applyStreamMerge, patchStreamLods } from './stream-merge';

/**
 * `merge-gen --mod` — convert a WHOLE mod folder to `.merge` edits, text files and binary streams together.
 *
 * **Why the whole folder and not a file at a time.** A stream's `lod` field indexes its area's TEXT IPL, so a
 * stream can only be converted once the same run knows what the text conversion did to that index space
 * ({@link generateMerge} returns it as `authorToFinal`). Converting the two separately is how the shipped
 * `0. Map Fixes Pack` came to carry links one row off in `law_stream1..4` and `law2_stream1`: the text merge
 * was right, the streams kept the AUTHOR's indexes, and stream merges apply LAST — so they wrote the author's
 * numbers over the installer's correct rebase. Nothing failed; the field just lost its LODs
 * (`docs/open-issues/ipl-row-removal-breaks-lod-links.md`).
 *
 * Every stream is GATED end to end: the generated merge is applied to the vanilla entry exactly as the
 * installer applies it (removal rebase first, merge second) and each instance's link must resolve, in OUR
 * merged text, to the same row the author's link resolved to in THEIRS. A stream that cannot prove that is
 * refused rather than written.
 */

export interface ModMergeOptions {
  /** The vanilla game tree the mod is expressed against. */
  readonly gamePath: string;
  readonly modPath: string;
  /** Write the `.merge` files and delete the whole files they replace (default: dry run). */
  readonly write?: boolean;
}

export interface ModMergeResult {
  /** Files that could not be expressed as a merge — nothing is written for these. */
  readonly refused: { path: string; reason: string }[];
  /** Files with no vanilla counterpart, or identical to it: the mod ships them as-is. */
  readonly skipped: string[];
  /** `.merge` files written (mod-relative), each replacing the whole file it was generated from. */
  readonly written: string[];
}

/** The mod's IMG folders, in the order {@link applyMod} merges them. */
const IMG_FOLDERS: readonly string[] = ['gta3_img', 'gta_int_img', 'cutscene_img'];

/** What one converted file needs from the run: where the mod lives, where findings go, and whether to write. */
interface ConvertContext {
  readonly modPath: string;
  readonly result: ModMergeResult;
  readonly write: boolean;
}

/** What a converted text IPL leaves behind for the streams that index it. */
interface ConvertedArea {
  readonly authorText: string;
  /** Author-layout inst index → our layout's, or undefined when the area's text is unchanged. */
  readonly authorToFinal?: number[];
  readonly finalText: string;
  /** Inst indexes the merge removes — the rebase the installer applies to the streams first. */
  readonly removedInst: number[];
}

/** Convert every convertible file of a mod folder into its `.merge`. Text first, then the streams that index it. */
export function convertModToMerges(options: ModMergeOptions): ModMergeResult {
  const { gamePath, modPath, write = false } = options;
  const result: ModMergeResult = { refused: [], skipped: [], written: [] };
  const vanillaData = indexByName(join(gamePath, 'data'));
  /** Per area: the author's text, our merged text, what the merge removed, and the author→final index map. */
  const converted = new Map<string, ConvertedArea>();

  for (const file of walk(join(modPath, 'data')).filter((path) => /\.(?:ide|ipl)$/i.test(path))) {
    convertTextFile(file, vanillaData.get(basename(file).toLowerCase()), converted, { modPath, result, write });
  }

  const archives = openArchiveIndex(gamePath);
  for (const folder of IMG_FOLDERS) {
    for (const file of walk(join(modPath, folder)).filter((path) => /_stream\d+\.ipl$/i.test(path))) {
      convertStream(file, archives, converted, { modPath, result, write });
    }
  }

  return result;
}

/** Area key shared by a text IPL and its streams: `LAw.IPL` & `law_stream2.ipl` → `law`. */
function areaKey(path: string): string {
  return basename(path)
    .replace(/_stream\d+\.ipl$/i, '')
    .replace(/\.ipl$/i, '')
    .toLowerCase();
}

/** Convert one binary stream entry, carrying its area's author→final index map, and gate the result. */
function convertStream(
  file: string,
  archives: { get: (name: string) => ArrayBuffer | null },
  converted: ReadonlyMap<string, ConvertedArea>,
  context: ConvertContext,
): void {
  const { modPath, result, write } = context;
  const label = relative(modPath, file);
  const vanillaEntry = archives.get(basename(file));
  if (!vanillaEntry) {
    result.skipped.push(label);

    return;
  }
  const area = converted.get(areaKey(file));
  const map = area?.authorToFinal;
  const modded = toArrayBuffer(readFileSync(file));
  // The base is the entry as the installer will have it when a stream merge runs: the text merge's removals
  // are mirrored into the streams FIRST (`patchAreaStreams`). Diffing against the raw vanilla entry instead
  // reads an already-correct rebase as "no change" and lets a link the author moved go unexpressed.
  const rebased = toArrayBuffer(patchStreamLods(new Uint8Array(vanillaEntry), area?.removedInst ?? [], label).bytes);
  const remap = map ? (lod: number): number => map[lod] ?? lod : undefined;
  const merge = generateStreamMerge(rebased, modded, parseBinaryIpl, remap);
  if (merge.kind === 'identical') {
    result.skipped.push(label);

    return;
  }
  const mismatch = area ? streamLinkMismatch(rebased, modded, merge.text, area) : null;
  if (mismatch) {
    result.refused.push({ path: label, reason: mismatch });

    return;
  }
  emit(file, merge.text, write, result, modPath);
}

/** Convert one `.ide`/`.ipl`, recording what an `.ipl` conversion did to the area's index space. */
function convertTextFile(
  file: string,
  vanilla: string | undefined,
  converted: Map<string, ConvertedArea>,
  context: ConvertContext,
): void {
  const { modPath, result, write } = context;
  const label = relative(modPath, file);
  if (!vanilla) {
    result.skipped.push(label);

    return;
  }
  const kind: MergeTargetKind = file.toLowerCase().endsWith('.ipl') ? 'ipl' : 'ide';
  const vanillaText = readFileSync(vanilla, 'utf8');
  const authorText = readFileSync(file, 'utf8');
  const merge = generateMerge(vanillaText, authorText, kind);
  if (merge.kind === 'refused') {
    if (merge.reason === 'files are identical') {
      result.skipped.push(label);
    } else {
      result.refused.push({ path: label, reason: merge.reason });
    }

    return;
  }
  if (kind === 'ipl') {
    const applied = applyIdeMerge(vanillaText, parseMergeFile(merge.text), 'ipl');
    converted.set(areaKey(file), {
      authorText,
      finalText: applied.text,
      removedInst: applied.removedInst,
      ...(merge.authorToFinal ? { authorToFinal: merge.authorToFinal } : {}),
    });
  }
  emit(file, merge.text, write, result, modPath);
}

/** Write `<file>.merge` and drop the whole file it replaces (or just record it, on a dry run). */
function emit(file: string, text: string, write: boolean, result: ModMergeResult, modPath: string): void {
  if (write) {
    writeFileSync(`${file}.merge`, text);
    rmSync(file);
  }
  result.written.push(`${relative(modPath, file)}.merge`);
}

/** Every file under `dir`, by lowercased bare name — the way the installer resolves a mod's data file. */
function indexByName(dir: string): Map<string, string> {
  const index = new Map<string, string>();
  for (const file of walk(dir)) {
    index.set(basename(file).toLowerCase(), file);
  }

  return index;
}

/** A row's identity for the link gate: model + position, or `none` for an unlinked/out-of-range index. */
function rowKey(row: undefined | { modelName: string; position: readonly number[] }): string {
  return row ? `${row.modelName.toLowerCase()}@${row.position.map((v) => v.toFixed(3)).join(',')}` : 'none';
}

/**
 * The end-to-end gate: apply the generated merge to the entry the installer will actually have (already
 * rebased for the text merge's removals) and require every link to resolve, in our merged text, to the row
 * the author's link resolved to in theirs. Returns the first mismatch, or null.
 */
function streamLinkMismatch(
  rebasedEntry: ArrayBuffer,
  moddedEntry: ArrayBuffer,
  mergeText: string,
  area: ConvertedArea,
): null | string {
  const authorRows = parseIpl(area.authorText);
  const finalRows = parseIpl(area.finalText);
  const applied = parseBinaryIpl(
    toArrayBuffer(applyStreamMerge(new Uint8Array(rebasedEntry), mergeText, 'gate').bytes),
  );
  const author = parseBinaryIpl(moddedEntry);
  const identity = (inst: { id: number; interior: number; position: readonly number[] }): string =>
    [inst.id, inst.interior, ...inst.position].map((value) => Number(value).toPrecision(6)).join(',');
  const byIdentity = new Map(applied.map((inst) => [identity(inst), inst]));
  for (const inst of author) {
    const ours = byIdentity.get(identity(inst));
    if (!ours) {
      return `instance ${identity(inst)} did not survive the merge`;
    }
    // A link into nothing is not a link the conversion may carry: both sides would resolve to "none" and the
    // merge would faithfully write a garbage index into the stream, which is what SA's parser reads.
    if (inst.lod >= 0 && !authorRows[inst.lod]) {
      return `instance ${identity(inst)} links to row ${inst.lod}, which does not exist in the author's own file`;
    }
    const wanted = rowKey(authorRows[inst.lod]);
    const got = rowKey(finalRows[ours.lod]);
    if (wanted !== got) {
      return `instance ${identity(inst)} links to ${wanted} in the author's layout but ${got} in ours`;
    }
  }

  return null;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function walk(dir: string): string[] {
  return existsSync(dir)
    ? readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);

        return statSync(full).isDirectory() ? walk(full) : [full];
      })
    : [];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name: string): string => {
    const at = process.argv.indexOf(name);
    if (at < 0 || at + 1 >= process.argv.length) {
      throw new Error(`missing ${name} <path>`);
    }

    return process.argv[at + 1];
  };
  const result = convertModToMerges({
    gamePath: arg('--vanilla'),
    modPath: arg('--mod'),
    write: process.argv.includes('--write'),
  });
  for (const path of result.written) {
    console.log(`merge   ${path}`);
  }
  for (const { path, reason } of result.refused) {
    console.log(`REFUSED ${path} — ${reason}`);
  }
  console.log(
    `${result.written.length} merges, ${result.refused.length} refused, ${result.skipped.length} left as-is` +
      `${process.argv.includes('--write') ? '' : ' (dry run — pass --write)'}`,
  );
  process.exitCode = result.refused.length > 0 ? 1 : 0;
}
