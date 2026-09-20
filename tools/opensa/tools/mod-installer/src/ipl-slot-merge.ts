import { openArchive } from '@opensa/renderware/archive/img-archive';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** An area's boot cost: text inst rows + all its binary-stream rows pass one 4096-slot buffer at boot. */
const AREA_ROW_CAP = 4000;

/**
 * Rows the LATER stages still append to a stock area — tree impostor LODs and the sa hole fill land in these
 * same files, after this fold has run. Reserved so the fold cannot spend the room they need: measured across
 * the 2026-08-16 `sa` build, the worst single area grew by 812 rows after the mods stage.
 */
const AREA_LATER_APPENDS = 900;

/** A mod IPL that could not be folded, so it keeps its own `IplEntityIndexArrays` slot. */
export interface KeptIpl {
  base: string;
  rows: number;
}

export interface SlotFoldResult {
  /** Mod IPLs left standing, worst first — each still costs a slot, and the caller must SAY so. */
  kept: KeptIpl[];
  merged: number;
  rows: number;
}

/** A stock area a fold may append to: how many text rows it has (the index base) and how many it can take. */
interface FoldHost {
  file: string;
  /** Rows it can still accept without crossing {@link AREA_ROW_CAP} minus {@link AREA_LATER_APPENDS}. */
  free: number;
  /** Text `inst` rows — what an appended row's `lod` link must be rebased past. */
  instRows: number;
}

/**
 * Free `IplEntityIndexArrays` slots held by STOCK text IPLs that have no binary streams: move their inst
 * rows into the least-loaded stream-backed stock host (appends never shift the host's indexes) and empty
 * their own inst block in place — the file keeps its other sections (enex/cull/grge…) and its gta.dat line,
 * but an inst-less IPL takes NO slot. Stock SA has exactly two such files (`int_cont`, `gen_int1`); the two
 * freed slots are the build's headroom for the user's own modloader IPL mods.
 */
export function compactStockInstIpls(gamePath: string, outPath: string): { compacted: number; rows: number } {
  const stockDatPath = join(gamePath, 'data', 'gta.dat');
  const datPath = join(outPath, 'data', 'gta.dat');
  if (!existsSync(stockDatPath) || !existsSync(datPath)) {
    return { compacted: 0, rows: 0 };
  }
  const stock = new Set(iplLines(readFileSync(stockDatPath, 'utf8')).map(([, base]) => base));
  const streamRows = allStreamRows(outPath);

  const donors: { file: string; rows: string[] }[] = [];
  const hosts: { file: string; total: number }[] = [];
  for (const [path, base] of iplLines(readFileSync(datPath, 'utf8'))) {
    if (!stock.has(base)) {
      continue; // generated/mod files are handled by mergeModInstIpls / the generators' own budgets
    }
    const file = join(outPath, path.replace(/\\/g, '/'));
    if (!existsSync(file)) {
      continue;
    }
    const text = readFileSync(file, 'utf8');
    const count = countInstRows(text);
    if (count === 0) {
      continue;
    }
    if (streamRows.has(base.replace(/\.ipl$/, ''))) {
      hosts.push({ file, total: count + (streamRows.get(base.replace(/\.ipl$/, '')) ?? 0) });
    } else {
      donors.push({ file, rows: instBlockRows(text) });
    }
  }

  const donorRows = donors.reduce((n, d) => n + d.rows.length, 0);
  const host = hosts.sort((a, b) => a.total - b.total)[0];
  // Same reserve as the fold: the tree LODs and the hole fill still append to this host afterwards.
  if (donors.length === 0 || !host || host.total + donorRows > AREA_ROW_CAP - AREA_LATER_APPENDS) {
    return { compacted: 0, rows: 0 };
  }

  const hostText = readFileSync(host.file, 'utf8');
  const hostCount = countInstRows(hostText);
  const moved: string[] = [];
  for (const donor of donors) {
    const offset = hostCount + moved.length;
    for (const row of donor.rows) {
      moved.push(rebaseLod(row, offset));
    }
    writeFileSync(donor.file, emptyInstSection(readFileSync(donor.file, 'utf8')));
  }
  writeFileSync(host.file, appendToInstSection(hostText, moved));

  return { compacted: donors.length, rows: moved.length };
}

/**
 * Fold mod-added text IPLs into a **stock host IPL** to save `IplEntityIndexArrays` slots: every gta.dat text
 * IPL with inst rows takes one slot of SA's **40-entry static array (no bounds check)** — stock uses 30 and
 * the LOD generators add ~9 more, so a handful of mod IPLs (each usually a few dozen rows) overflows it and
 * corrupts the CIplStore statics right behind the array (`gbIplsNeededAtPosn`/`ms_pQuadTree`/`ms_pPool` —
 * Junior_Djjr's CrashList: "Try mixing the IPL files"). Rows are APPENDED to the least-loaded stock area's
 * inst section — appends never shift existing indexes, so the host's binary-stream `lod` links stay valid —
 * and the mods' internal `lod` links are rebased by their offset in the host.
 *
 * Folded across as MANY hosts as it takes, biggest file first. One host was the shape until 2026-08-16, when
 * a map pack arrived with 13 IPLs / 16 172 rows: nothing fits a single 4 000-row area, and the fold being
 * all-or-nothing meant it folded NOTHING and said nothing — the build died on the slot guard at 62 of 40.
 * A file whose rows carry no internal `lod` link may also be SPLIT across hosts, since nothing in it
 * addresses its own row order; one that does link stays whole or stays put.
 *
 * Skipped (kept as their own file, and REPORTED): stock IPLs, files with companion `_stream` entries in
 * gta3.img (binary lod fields index THAT text file), files with sections beyond `inst` (nothing observed
 * ships them), and anything the hosts have no room for.
 */
export function mergeModInstIpls(gamePath: string, outPath: string): SlotFoldResult {
  const stockDatPath = join(gamePath, 'data', 'gta.dat');
  const datPath = join(outPath, 'data', 'gta.dat');
  if (!existsSync(stockDatPath) || !existsSync(datPath)) {
    return { kept: [], merged: 0, rows: 0 }; // no gta.dat — nothing registered, nothing to fold
  }
  const stock = new Set(iplLines(readFileSync(stockDatPath, 'utf8')).map(([, base]) => base));
  const dat = readFileSync(datPath, 'utf8');
  const streamRows = allStreamRows(outPath);

  const candidates: { base: string; file: string; inst: string[] }[] = [];
  const hosts: FoldHost[] = [];
  for (const [path, base] of iplLines(dat)) {
    const file = join(outPath, path.replace(/\\/g, '/'));
    if (!existsSync(file)) {
      continue;
    }
    if (stock.has(base)) {
      const rows = countInstRows(readFileSync(file, 'utf8'));
      if (rows > 0) {
        const total = rows + (streamRows.get(base.replace(/\.ipl$/, '')) ?? 0);
        hosts.push({ file, free: Math.max(0, AREA_ROW_CAP - AREA_LATER_APPENDS - total), instRows: rows });
      }
      continue;
    }
    if (streamRows.has(base.replace(/\.ipl$/, ''))) {
      continue; // binary streams index this text file — it must keep its own identity
    }
    const inst = instRows(readFileSync(file, 'utf8'));
    if (inst === null || inst.length === 0) {
      continue; // no inst rows (no slot taken), or non-inst sections present (don't split such a file)
    }
    candidates.push({ base, file, inst });
  }

  // Biggest first: a 2 863-row file has few homes and a 20-row one has many, so placing the small ones first
  // is how a fold ends up with room everywhere and nowhere.
  candidates.sort((a, b) => b.inst.length - a.inst.length);
  const planned = new Map<string, string[]>();
  const mergedBases = new Set<string>();
  const kept: KeptIpl[] = [];
  let folded = 0;
  for (const candidate of candidates) {
    if (!foldInto(hosts, candidate.inst, planned)) {
      kept.push({ base: candidate.base, rows: candidate.inst.length });
      continue;
    }
    mergedBases.add(candidate.base);
    folded += candidate.inst.length;
    rmSync(candidate.file);
  }
  if (mergedBases.size === 0) {
    return { kept: kept.sort((a, b) => b.rows - a.rows), merged: 0, rows: 0 };
  }
  for (const [file, rows] of planned) {
    writeFileSync(file, appendToInstSection(readFileSync(file, 'utf8'), rows));
  }

  const eol = dat.includes('\r\n') ? '\r\n' : '\n';
  const remaining = dat
    .split(/\r?\n/)
    .filter((line) => {
      const ref = parseIplLine(line);

      return ref === null || !mergedBases.has(ref[1]);
    })
    .join(eol)
    .replace(/\s*$/, '');
  writeFileSync(datPath, `${remaining}${eol}`);

  return { kept: kept.sort((a, b) => b.rows - a.rows), merged: mergedBases.size, rows: folded };
}

/** Stream rows per area across both map IMGs (exterior gta3.img + interior gta_int.img). */
function allStreamRows(outPath: string): Map<string, number> {
  const rows = imgStreamRows(join(outPath, 'models', 'gta3.img'));
  for (const [area, count] of imgStreamRows(join(outPath, 'models', 'gta_int.img'))) {
    rows.set(area, (rows.get(area) ?? 0) + count);
  }

  return rows;
}

/** Insert rows at the end of the first `inst … end` block, preserving the file's line endings. */
function appendToInstSection(text: string, rows: readonly string[]): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  let inInst = false;
  for (let i = 0; i < lines.length; i += 1) {
    const token = lines[i].trim().toLowerCase();
    if (!inInst && token === 'inst') {
      inInst = true;
    } else if (inInst && token === 'end') {
      return [...lines.slice(0, i), ...rows, ...lines.slice(i)].join(eol);
    }
  }
  throw new Error('host IPL has no inst section');
}

/** Data rows of the first `inst … end` block — the index space the appended rows continue. */
function countInstRows(text: string): number {
  let n = 0;
  let inInst = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('//')) {
      continue;
    }
    const token = line.toLowerCase();
    if (!inInst && token === 'inst') {
      inInst = true;
    } else if (inInst && token === 'end') {
      break;
    } else if (inInst) {
      n += 1;
    }
  }

  return n;
}

/** Remove the data rows of the first `inst … end` block, keeping the (now empty) section and all others. */
function emptyInstSection(text: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let inInst = false;
  let done = false;
  for (const line of lines) {
    const token = line.trim().toLowerCase();
    if (!done && !inInst && token === 'inst') {
      inInst = true;
      out.push(line);
      continue;
    }
    if (inInst && token === 'end') {
      inInst = false;
      done = true;
      out.push(line);
      continue;
    }
    if (!inInst) {
      out.push(line);
    }
  }

  return out.join(eol);
}

/**
 * Plan one mod file's rows into the hosts, or report that they do not fit. Rows that carry a `lod` link
 * address their own file by index, so such a file must land in ONE host, whole; a file with no links can be
 * spread over several. Mutates the hosts' remaining room — nothing is written until every file is placed.
 */
function foldInto(hosts: FoldHost[], inst: readonly string[], planned: Map<string, string[]>): boolean {
  const place = (host: FoldHost, rows: readonly string[]): void => {
    const target = planned.get(host.file) ?? [];
    for (const row of rows) {
      target.push(rebaseLod(row, host.instRows));
    }
    planned.set(host.file, target);
    host.instRows += rows.length;
    host.free -= rows.length;
  };
  if (inst.some(hasLodLink)) {
    // Best fit: the tightest host that still takes the whole file, so the big rooms stay big.
    const host = [...hosts].sort((a, b) => a.free - b.free).find((candidate) => candidate.free >= inst.length);
    if (!host) {
      return false;
    }
    place(host, inst);

    return true;
  }
  if (hosts.reduce((n, host) => n + host.free, 0) < inst.length) {
    return false;
  }
  let rest = inst;
  while (rest.length > 0) {
    const host = [...hosts].sort((a, b) => b.free - a.free)[0];
    const take = rest.slice(0, host.free);
    place(host, take);
    rest = rest.slice(take.length);
  }

  return true;
}

/** Whether the row points at another row of its own file — the reason a file may not be split. */
function hasLodLink(row: string): boolean {
  const lod = Number(row.split(',').pop());

  return Number.isInteger(lod) && lod >= 0;
}

/** Per area key (`<base>` of `<base>_streamN.ipl`): total binary INST rows across its streams in the IMG. */
function imgStreamRows(imgPath: string): Map<string, number> {
  const rows = new Map<string, number>();
  if (!existsSync(imgPath)) {
    return rows;
  }
  const buffer = readFileSync(imgPath);
  const archive = openArchive(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
  for (const name of archive.names) {
    const match = /^(.+)_stream\d+\.ipl$/i.exec(name);
    if (!match) {
      continue;
    }
    const area = match[1].toLowerCase();
    const data = archive.get(name);
    const count = data && data.byteLength >= 8 ? new DataView(data.slice(0, 8)).getUint32(4, true) : 0;
    rows.set(area, (rows.get(area) ?? 0) + count);
  }

  return rows;
}

/** Data rows of the first `inst … end` block. */
function instBlockRows(text: string): string[] {
  const rows: string[] = [];
  let inInst = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('//')) {
      continue;
    }
    const token = line.toLowerCase();
    if (!inInst && token === 'inst') {
      inInst = true;
    } else if (inInst && token === 'end') {
      break;
    } else if (inInst) {
      rows.push(line);
    }
  }

  return rows;
}

/** The file's inst data rows — or null when the file carries any OTHER section (we won't split those). */
function instRows(text: string): null | string[] {
  const rows: string[] = [];
  let section: null | string = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('//')) {
      continue;
    }
    if (section === null) {
      section = line.toLowerCase();
      if (section !== 'inst') {
        return null;
      }
      continue;
    }
    if (line.toLowerCase() === 'end') {
      section = null;
      continue;
    }
    rows.push(line);
  }

  return rows;
}

/** The gta.dat `IPL` lines (skipping `.zon`), as `[declared path, lowercased basename]`. */
function iplLines(dat: string): [string, string][] {
  const out: [string, string][] = [];
  for (const line of dat.split(/\r?\n/)) {
    const ref = parseIplLine(line);
    if (ref !== null) {
      out.push(ref);
    }
  }

  return out;
}

function parseIplLine(line: string): [string, string] | null {
  const match = /^IPL\s+(\S.*)$/i.exec(line.trim());
  if (!match || match[1].toLowerCase().endsWith('.zon')) {
    return null;
  }
  const path = match[1];
  const base = (path.split(/[\\/]/).pop() ?? path).toLowerCase();

  return [path, base];
}

/** Shift a row's `lod` column (last field) by `offset` — internal links keep pointing at their own rows. */
function rebaseLod(row: string, offset: number): string {
  const cells = row.split(',');
  const lod = Number(cells[cells.length - 1]);
  if (!Number.isInteger(lod) || lod < 0) {
    return row;
  }
  cells[cells.length - 1] = ` ${lod + offset}`;

  return cells.join(',');
}
