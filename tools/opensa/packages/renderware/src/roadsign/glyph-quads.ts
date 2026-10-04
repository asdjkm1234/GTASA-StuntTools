import type { RWRoadsign } from '../parsers/binary/types';

/**
 * 2dfx ROADSIGN text → glyph quads (plan 042 item 5 / plan 076). One textured quad per character, UV-mapped
 * into the `roadsignfont` glyph atlas (particle.txd, 32×512 = 4 columns × 32 rows of 8×16 px cells — layout
 * read off the texture itself). Pure geometry (no three, no GPU) so the three renderer AND the opensa-pack
 * converter build IDENTICAL quads — the shared-baker discipline (avoid the divergence a second copy invites).
 *
 * Positions are WORLD-space (GTA Z-up): roadsign entries store real city coordinates, NOT geometry-local ones
 * (verified empirically — entries land on real locations while their host road chunk sits elsewhere; treating
 * them as local threw the quads off the map). The consumer places them with an identity transform.
 */

/** Atlas cells 0–81 in reading order — ASCII with the "command" characters skipped. */
const ATLAS_ORDER = `!"&'()+,-./0123456789:;?ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]abcdefghijklmnopqrstuvwxyz{|}`;
const ATLAS_COLS = 4;
const ATLAS_ROWS = 32;

/**
 * Command characters → appended glyph cells (82+: arrows, fractions, plane, icons). `<`/`>`/`^`/`}`/`~`
 * verified against vanilla (junction boards: plane on AIRPORT, down arrows on the lane row); `#`/`%` read as
 * the diagonal exit arrows.
 */
const COMMAND_GLYPHS = new Map<string, number>(
  Object.entries({
    '#': 87, // ↗
    '%': 86, // ↖
    '<': 82, // ←
    '>': 83, // →
    '^': 84, // ↑
    '}': 94, // airplane (AIRPORT boards)
    '~': 85, // ↓ (lane indicators on the boards' bottom row)
  }),
);

/** Text colour palette (flags bits 4–5): white, black, grey, red — as [r, g, b] in 0..1. */
export const ROADSIGN_PALETTE: readonly (readonly [number, number, number])[] = [
  [1, 1, 1],
  [0, 0, 0],
  [0.5, 0.5, 0.5],
  [0.69, 0.063, 0.063],
];

/** Lift the text off the board face to avoid z-fighting (metres, along the plate normal). Small on purpose:
 *  the per-side quad pair already covers boards whose face varies by rotation family. */
const FACE_OFFSET = 0.05;
/** Text block inset: vanilla boards keep a margin — the glyph grid fills this share of the plate. */
const TEXT_INSET = 0.85;
const DEG_TO_RAD = Math.PI / 180;

/** One roadsign's character quads (world-space GTA positions + atlas UVs), tagged with its palette colour. */
export interface RoadsignGlyphQuads {
  /** Palette colour index (0 white, 1 black, 2 grey, 3 red) — see {@link ROADSIGN_PALETTE}. */
  colour: number;
  /** World-space GTA positions, 4 per quad (flat, 3 floats each). */
  positions: number[];
  /** Atlas UVs (v-down, DFF convention), 4 per quad (2 floats each). */
  uvs: number[];
}

/** Rotation Z→X→Y (radians) as a point transformer — allocation-free per corner.
 *  The order is solver-verified (scripts/debug/solve-roadsign.ts) across every observed sign family, and this
 *  function IS the convention: anything that has to compose or decompose a roadsign's Euler triple (the LOD
 *  generators, when they carry a plate onto a rotated instance) reads it from here rather than restating it. */
export function composeRoadsignRotation(
  rx: number,
  ry: number,
  rz: number,
): (x: number, y: number, z: number) => [number, number, number] {
  const [sx, cx] = [Math.sin(rx), Math.cos(rx)];
  const [sy, cy] = [Math.sin(ry), Math.cos(ry)];
  const [sz, cz] = [Math.sin(rz), Math.cos(rz)];

  return (x, y, z) => {
    // Z axis
    const x1 = x * cz - y * sz;
    const y1 = x * sz + y * cz;
    // X axis
    const y2 = y1 * cx - z * sx;
    const z2 = y1 * sx + z * cx;
    // Y axis
    const x3 = x1 * cy + z2 * sy;
    const z3 = -x1 * sy + z2 * cy;

    return [x3, y2, z3];
  };
}

/** Glyph cell for a character, or null when it draws nothing (`_` = space) / is unknown. */
export function roadsignGlyphIndex(char: string): null | number {
  if (char === '_' || char === ' ') {
    return null;
  }
  // A Map, not an object literal: a bare `OBJ[char]` lookup reaches the prototype, so
  // `roadsignGlyphIndex('toString')` returned a Function and violated this function's `null | number`
  // contract (plan 077). A Map has no such inherited keys, which kills the class rather than guarding it.
  const command = COMMAND_GLYPHS.get(char);
  if (command !== undefined) {
    return command;
  }
  const index = ATLAS_ORDER.indexOf(char);

  return index >= 0 ? index : null;
}

/**
 * Build one sign's character quads. The plate is vertical (width along local X, lines advancing −Y, text
 * normal −Z), rotated by the entry's XYZ degrees and lifted {@link FACE_OFFSET} off the board on BOTH sides
 * (the visible face varies by rotation family; the buried copy costs nothing — identical UVs overlap into one
 * letterform). Returns null when the sign draws no glyphs.
 */
export function roadsignGlyphQuads(sign: RWRoadsign): null | RoadsignGlyphQuads {
  const positions: number[] = [];
  const uvs: number[] = [];
  const [plateWidth, plateHeight] = sign.plateSize;
  const lineCount = sign.lines.length;
  const charWidth = (plateWidth * TEXT_INSET) / sign.charsPerLine;
  // Fixed quarter-plate line slots like vanilla — dividing by the actual line count stretched 1–2-line boards
  // into giant letters; the text block is centred vertically instead.
  const charHeight = (plateHeight * TEXT_INSET) / 4;
  const [rx, ry, rz] = sign.rotation.map((deg) => deg * DEG_TO_RAD);
  const rotate = composeRoadsignRotation(rx, ry, rz);

  for (let line = 0; line < lineCount; line += 1) {
    const text = sign.lines[line];
    const top = (lineCount * charHeight) / 2 - line * charHeight;
    for (let column = 0; column < Math.min(sign.charsPerLine, text.length); column += 1) {
      const glyph = roadsignGlyphIndex(text[column]);
      if (glyph === null) {
        continue;
      }
      const left = (-plateWidth * TEXT_INSET) / 2 + column * charWidth;
      for (const offset of [-FACE_OFFSET, FACE_OFFSET]) {
        const corners = [
          [left, top, offset],
          [left, top - charHeight, offset],
          [left + charWidth, top - charHeight, offset],
          [left + charWidth, top, offset],
        ];
        for (const [x, y, z] of corners) {
          const [wx, wy, wz] = rotate(x, y, z);
          positions.push(sign.position[0] + wx, sign.position[1] + wy, sign.position[2] + wz);
        }
        const cellU = (glyph % ATLAS_COLS) / ATLAS_COLS;
        const cellV = Math.floor(glyph / ATLAS_COLS) / ATLAS_ROWS;
        // DFF-style v-down UVs (same convention the TXD pipeline renders everywhere else).
        uvs.push(
          cellU,
          cellV,
          cellU,
          cellV + 1 / ATLAS_ROWS,
          cellU + 1 / ATLAS_COLS,
          cellV + 1 / ATLAS_ROWS,
          cellU + 1 / ATLAS_COLS,
          cellV,
        );
      }
    }
  }

  return positions.length > 0 ? { colour: sign.colour, positions, uvs } : null;
}
