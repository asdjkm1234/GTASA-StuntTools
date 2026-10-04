import { buildVer2Buffer } from '@opensa/renderware/archive/img-archive';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkLodLinks, formatLodLink } from './lod-links';

let dir: string;

const IDE = ['objs', '100, house, houses, 300, 0', '200, LODhouse, houses, 800, 0', 'end', ''].join('\n');

/** One INST record of a binary stream: what the check reads out of `<area>_streamN.ipl`. */
interface BinaryRow {
  id: number;
  lod: number;
  position: [number, number, number];
}

/** A minimal `bnry` IPL: header, `numInst` @0x04, `instOffset` @0x1c, then 40-byte INST records. */
function binaryIpl(records: readonly BinaryRow[]): Uint8Array {
  const bytes = new Uint8Array(0x4c + records.length * 40);
  const view = new DataView(bytes.buffer);
  bytes.set([0x62, 0x6e, 0x72, 0x79]); // "bnry"
  view.setUint32(0x04, records.length, true);
  view.setUint32(0x1c, 0x4c, true);
  records.forEach((record, index) => {
    const at = 0x4c + index * 40;
    record.position.forEach((value, axis) => view.setFloat32(at + axis * 4, value, true));
    view.setFloat32(at + 24, 1, true); // rotation w
    view.setUint32(at + 28, record.id, true);
    view.setInt32(at + 32, 0, true); // interior
    view.setInt32(at + 36, record.lod, true);
  });

  return bytes;
}

/** A one-area game tree: `data/maps/town.ipl` + the IDE that names its models, registered in `gta.dat`. */
function tree(rows: readonly string[], streams: readonly { name: string; records: BinaryRow[] }[] = []): string {
  const game = join(dir, 'game');
  mkdirSync(join(game, 'data', 'maps'), { recursive: true });
  writeFileSync(join(game, 'data', 'gta.dat'), 'IDE DATA\\MAPS\\town.ide\nIPL DATA\\MAPS\\town.ipl\n');
  writeFileSync(join(game, 'data', 'maps', 'town.ide'), IDE);
  writeFileSync(join(game, 'data', 'maps', 'town.ipl'), ['inst', ...rows, 'end', ''].join('\n'));
  if (streams.length > 0) {
    mkdirSync(join(game, 'models'), { recursive: true });
    writeFileSync(
      join(game, 'models', 'gta3.img'),
      buildVer2Buffer(streams.map((stream) => ({ data: binaryIpl(stream.records), name: stream.name }))),
    );
  }

  return game;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lod-links-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe('checkLodLinks', () => {
  describe('negative cases', () => {
    it('reports a text link whose row shifted out from under it', () => {
      const game = tree([
        '100, house, 0, 10, 10, 5, 0, 0, 0, 1, 2',
        '200, LODhouse, 0, 500, 500, 5, 0, 0, 0, 1, -1',
        '200, LODhouse, 0, 10, 10, 5, 0, 0, 0, 1, -1',
      ]);

      const report = checkLodLinks(game);
      expect(report.checked).toBe(1);
      expect(report.broken).toHaveLength(0);

      const shifted = checkLodLinks(
        tree([
          '100, house, 0, 10, 10, 5, 0, 0, 0, 1, 1',
          '200, LODhouse, 0, 500, 500, 5, 0, 0, 0, 1, -1',
          '200, LODhouse, 0, 10, 10, 5, 0, 0, 0, 1, -1',
        ]),
      );
      expect(shifted.broken).toHaveLength(1);
      expect(formatLodLink(shifted.broken[0])).toContain('lod=1 → LODhouse');
      expect(Math.round(shifted.broken[0].distance)).toBe(693);
    });

    it('reports a binary stream link that points past its area, and one that points at a far row', () => {
      const game = tree(
        ['200, LODhouse, 0, 10, 10, 5, 0, 0, 0, 1, -1', '200, LODhouse, 0, 900, 900, 5, 0, 0, 0, 1, -1'],
        [
          {
            name: 'town_stream0.ipl',
            records: [
              { id: 100, lod: 1, position: [10, 10, 5] },
              { id: 100, lod: 7, position: [10, 10, 5] },
            ],
          },
        ],
      );

      const report = checkLodLinks(game);
      expect(report.checked).toBe(2);
      expect(report.outOfRange.map((link) => link.lod)).toEqual([7]);
      expect(report.broken.map((link) => link.from)).toEqual(['town_stream0.ipl']);
      expect(formatLodLink(report.outOfRange[0])).toContain('index is past the end');
    });
  });

  describe('positive cases', () => {
    it('passes links whose LOD stands where its owner stands, in text and in the stream', () => {
      const game = tree(
        ['100, house, 0, 10, 10, 5, 0, 0, 0, 1, 1', '200, LODhouse, 0, 10, 10.5, 5, 0, 0, 0, 1, -1'],
        [{ name: 'town_stream0.ipl', records: [{ id: 100, lod: 1, position: [12, 11, 5] }] }],
      );

      const report = checkLodLinks(game);
      expect(report).toMatchObject({ broken: [], checked: 2, outOfRange: [] });
    });

    it('counts nothing for rows that declare no LOD', () => {
      const report = checkLodLinks(tree(['100, house, 0, 10, 10, 5, 0, 0, 0, 1, -1']));
      expect(report).toMatchObject({ broken: [], checked: 0, outOfRange: [] });
    });
  });
});
