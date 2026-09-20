import { encodeBinaryIpl } from '@opensa/map-placement/ipl-binary-write';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Archive } from './io';

import { resolveCells } from './resolve';

/** A gta3 archive with no binary streams — these tests exercise the text-IPL path only. */
const noStreams = { get: () => null, names: [] } as unknown as Archive;

/** A fake IMG archive serving the given binary IPL entries (one leaf instance per listed id). */
function binaryArchive(entries: Record<string, number[]>): Archive {
  const buffers = new Map(
    Object.entries(entries).map(([name, ids]) => {
      const bytes = encodeBinaryIpl(
        ids.map((id) => ({ id, interior: 0, lod: -1, position: [10, 10, 10], rotation: [0, 0, 0, 1] })),
      );

      return [name, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer];
    }),
  );

  return { get: (name: string) => buffers.get(name) ?? null, names: [...buffers.keys()] };
}

/** Write a synthetic game dir (one IDE + one text IPL under data/) and resolve its cells. */
function resolve(ide: string, ipl: string, archive: Archive = noStreams): ReturnType<typeof resolveCells> {
  const dir = mkdtempSync(join(tmpdir(), 'opensa-resolve-'));
  mkdirSync(join(dir, 'data'));
  writeFileSync(join(dir, 'data', 'x.ide'), ide);
  writeFileSync(join(dir, 'data', 'x.ipl'), ipl);

  return resolveCells(dir, [archive], 256);
}

const models = (cells: ReturnType<typeof resolveCells>): string[] =>
  cells.flatMap((cell) => cell.instances.map((instance) => instance.model)).sort();

const IDE = [
  'objs',
  '1, conhoos2, txda, 300, 0',
  '2, lod_conhoos2, txdlod, 1500, 0', // twin named with an underscore — the name heuristic missed it
  '3, lodplate, txdlod, 1500, 0',
  'end',
].join('\n');

describe('resolveCells', () => {
  describe('negative cases', () => {
    it('skips an instance that is an IPL LOD target regardless of naming (ground truth, not names)', () => {
      const ipl = [
        'inst',
        '1, conhoos2, 0, 10,10,10, 0,0,0,1, 1', // HD → its lod field targets index 1
        '2, lod_conhoos2, 0, 10,10,10, 0,0,0,1, -1', // the far-LOD stand-in — must NOT be baked (z-fighting)
        'end',
      ].join('\n');

      expect(models(resolve(IDE, ipl))).toEqual(['conhoos2']);
    });

    it('skips interior instances', () => {
      const ipl = ['inst', '1, conhoos2, 5, 10,10,10, 0,0,0,1, -1', 'end'].join('\n');

      expect(resolve(IDE, ipl)).toHaveLength(0);
    });

    it('skips vegetation (handled by lod-trees-generator)', () => {
      const ide = ['objs', '9, ash1_hi, txda, 300, 0', 'end'].join('\n');
      const ipl = ['inst', '9, ash1_hi, 0, 10,10,10, 0,0,0,1, -1', 'end'].join('\n');

      expect(resolve(ide, ipl)).toHaveLength(0);
    });

    it('skips timed (tobj) instances — a baked lit window would glow round the clock', () => {
      const ide = ['tobj', '8, lampwin_nt, txda, 300, 0, 20, 6', 'end'].join('\n');
      const ipl = ['inst', '8, lampwin_nt, 0, 10,10,10, 0,0,0,1, -1', 'end'].join('\n');

      expect(resolve(ide, ipl)).toHaveLength(0);
    });

    it('excludes script-gated binary groups (no companion text IPL) — barriers must not bake into cells', () => {
      const ide = ['objs', '1, conhoos2, txda, 300, 0', '4, roadblock, txda, 100, 0', 'end'].join('\n');
      const archive = binaryArchive({ 'barriers2.ipl': [4], 'x_stream0.ipl': [1] });

      expect(models(resolve(ide, 'inst\nend', archive))).toEqual(['conhoos2']); // stream baked, barriers2 not
    });
  });

  describe('positive cases', () => {
    it('keeps an untargeted lod-named base sheet (nothing points at it)', () => {
      const ipl = ['inst', '3, lodplate, 0, 10,10,10, 0,0,0,1, -1', 'end'].join('\n');

      expect(models(resolve(IDE, ipl))).toEqual(['lodplate']);
    });

    it('bakes the always-open script groups (engine extraIpl parity: truthsfarm)', () => {
      const ide = ['objs', '5, truthbarn, txda, 200, 0', 'end'].join('\n');
      const archive = binaryArchive({ 'truthsfarm.ipl': [5] });

      expect(models(resolve(ide, 'inst\nend', archive))).toEqual(['truthbarn']);
    });

    it('buckets instances into cells by position', () => {
      const ipl = [
        'inst',
        '1, conhoos2, 0, 10,10,10, 0,0,0,1, -1',
        '1, conhoos2, 0, 300,10,10, 0,0,0,1, -1', // next cell over (256-unit grid)
        'end',
      ].join('\n');
      const cells = resolve(IDE, ipl);

      expect(cells).toHaveLength(2);
      expect(cells.map((cell) => `${cell.cx},${cell.cy}`).sort()).toEqual(['0,0', '1,0']);
    });
  });
});
