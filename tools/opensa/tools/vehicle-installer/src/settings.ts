import { parseCarcols } from '@opensa/renderware/parsers/text/carcols.parser';
import { parseCarmods } from '@opensa/renderware/parsers/text/carmods.parser';
import { parseHandling } from '@opensa/renderware/parsers/text/handling.parser';
import { parseVehicleDefs } from '@opensa/renderware/parsers/text/vehicle-defs.parser';

/** One custom colour a vehicle defines — a `col`-section line plus the symbolic name its carcols line references. */
export interface PaletteColor {
  /** The `R,G,B  # newN …` line to append to `carcols.dat`'s `col` section (`newN` is replaced with the id later). */
  line: string;
  /** The symbolic name (`new1`) the carcols line refers to. */
  name: string;
}

/** The lines a vehicle's `*.settings.txt` may contribute, one per stock data file (any may be absent). */
export interface VehicleSettings {
  /** A `carcols.dat` `car`/`car4` line (`model, c… ` — numeric or `newN` colour refs). */
  carcolsLine?: string;
  /** A `carmods.dat` `mods` line (`model, part, part …` — upgrade part ids). */
  carmodsLine?: string;
  /** A `handling.cfg` car-table line (`ID  mass …`). */
  handlingLine?: string;
  /** A `vehicles.ide` `cars`-section line (`id, model, txd, …`). */
  ideLine?: string;
  /** Custom colours (`newN`) to append to `carcols.dat`'s `col` section, resolving the carcols line's refs. */
  palette?: PaletteColor[];
}

/**
 * What an ADDED car writes where its model id goes (`<:id>, 001veh, 001veh, car, …`). The author cannot know
 * the id — it is allocated over the built tree — and a literal one would be a guess at a window they cannot
 * see. `applyVehicle` substitutes it when it is given an id; a `vehicles/` car never carries it.
 */
export const ID_PLACEHOLDER = '<:id>';

/** A handling line is the id + ~33 columns — require many fields so prose isn't taken for handling. */
const MIN_HANDLING_FIELDS = 20;

type Kind = 'carcolsLine' | 'carmodsLine' | 'handlingLine' | 'ideLine';

/**
 * Decode a settings file's BYTES into text, honouring the encoding it was actually saved in.
 *
 * A Windows editor happily writes `*.settings.txt` as UTF-16 — 8 of the 10 gostown vehicle mods ship it that
 * way — and read as UTF-8 every line comes out NUL-interleaved, matches no block shape, and the whole file is
 * dropped: the car then runs STOCK handling/ide/carcols under a mod model. That is what stood the 1965
 * Mustang ~12 cm too tall (it authors `suspension_lower_limit −0.045` and was running the stock −0.20).
 *
 * BOMs decide it when present; a BOM-less UTF-16 file is caught by the NUL bytes no text encoding puts in
 * ASCII text — their parity says which endianness. Anything else is read as UTF-8, and whatever fails to
 * classify then reaches {@link parseVehicleSettings}'s warning.
 */
export function decodeSettings(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return utf16(bytes.subarray(2), true);
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return utf16(bytes.subarray(2), false);
  }
  const head = bytes.subarray(0, 64);
  const nul = head.indexOf(0);
  if (nul >= 0) {
    return utf16(bytes, nul % 2 === 1);
  }
  const utf8 = Buffer.from(bytes).toString('utf8');

  return utf8.charCodeAt(0) === 0xfeff ? utf8.slice(1) : utf8;
}

/**
 * Parse a `*.settings.txt` (blank-line-separated blocks) into the lines it carries. Four single-line blocks
 * (ide/handling/carcols/carmods) are classified by **structure** + validated with the real engine parser; the
 * **palette** block is multi-line (`R,G,B  # newN …`).
 *
 * A block no parser recognises is dropped — but never in silence: `onWarn` gets it, because a dropped block
 * is indistinguishable in the output from a mod that simply ships stock data, and the install carries on
 * either way. An unknown ENCODING lands here as a wall of unrecognised blocks (see {@link decodeSettings}).
 */
export function parseVehicleSettings(text: string, onWarn?: (message: string) => void): VehicleSettings {
  const out: VehicleSettings = {};
  for (const block of text.split(/\r?\n\s*\n/)) {
    const lines = block
      .split(/\r?\n/)
      .map((row) => row.trim())
      .filter((row) => row !== '');
    if (lines.length === 0) {
      continue;
    }
    const palette = paletteColors(lines);
    if (palette.length > 0) {
      out.palette = [...(out.palette ?? []), ...palette];
      continue;
    }
    const kind = classify(lines[0]);
    if (kind) {
      out[kind] = lines[0];
    } else {
      onWarn?.(`dropped an unrecognised block: ${preview(lines[0])}`);
    }
  }

  return out;
}

function classify(line: string): Kind | null {
  if (line.includes(',')) {
    const cells = line.split(',').map((cell) => cell.trim());
    if (/^\d+$/.test(cells[0])) {
      return parseVehicleDefs(`cars\n${line}\nend`).size > 0 ? 'ideLine' : null;
    }
    const rest = cells.slice(1).filter((cell) => cell !== '');
    if (rest.length === 0) {
      return null;
    }
    // carcols values are palette ids — numeric, or a `newN` ref to a custom colour defined in the palette block.
    if (rest.every((cell) => /^(?:-?\d+|new\d+)$/i.test(cell))) {
      return parseCarcols(`car\n${line}\nend`).cars.size > 0 ? 'carcolsLine' : null;
    }
    // Part ids are word-only (`nto_b_l`) — reject prose (which has spaces/punctuation in a cell).
    if (rest.every((cell) => /^\w+$/.test(cell))) {
      return parseCarmods(`mods\n${line}\nend`).mods.size > 0 ? 'carmodsLine' : null;
    }

    return null;
  }
  if (line.split(/\s+/).length < MIN_HANDLING_FIELDS) {
    return null;
  }

  return parseHandling(line).size > 0 ? 'handlingLine' : null;
}

/** A palette line: 3 comma-separated integers, then a `# newN …` comment. */
function isPaletteLine(line: string): boolean {
  const hash = line.indexOf('#');
  if (hash < 0) {
    return false;
  }
  const rgb = line
    .slice(0, hash)
    .split(',')
    .map((cell) => cell.trim());

  return rgb.length === 3 && rgb.every((cell) => /^\d+$/.test(cell)) && /^new\d+$/i.test(paletteName(line));
}

/** Colours from a block whose lines are `R,G,B  # newN …` (empty when the block isn't a palette block). */
function paletteColors(lines: readonly string[]): PaletteColor[] {
  if (!isPaletteLine(lines[0])) {
    return [];
  }

  return lines.filter(isPaletteLine).map((line) => ({ line, name: paletteName(line) }));
}

/** The symbolic name = the first token after the `#`. */
function paletteName(line: string): string {
  return (
    line
      .slice(line.indexOf('#') + 1)
      .trim()
      .split(/\s+/)[0] ?? ''
  );
}

/** A dropped block quoted for a log line: one line, printable, short enough to read at a glance. */
function preview(line: string): string {
  const printable = [...line.slice(0, 60)].map((ch) => (ch < ' ' || ch === '\u007f' ? '·' : ch)).join('');

  return `"${printable}${line.length > 60 ? '…' : ''}"`;
}

/** UTF-16 text from `bytes` (BOM already removed); a trailing odd byte cannot start a code unit and is cut. */
function utf16(bytes: Uint8Array, littleEndian: boolean): string {
  const even = Buffer.from(bytes.subarray(0, bytes.length - (bytes.length % 2)));

  return (littleEndian ? even : even.swap16()).toString('utf16le');
}
