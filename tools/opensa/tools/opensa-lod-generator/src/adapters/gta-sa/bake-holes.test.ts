/**
 * The hole-fill exemption at the BAKE level (plan 086 / gostown bridge): a model in `holeFillModels`
 * must survive `bakeCell` VERBATIM — the reduction tracks (drop-degenerate/transparent, decimate,
 * visibility-cull, coplanar) apply to everything else. The probe model's only triangle is degenerate,
 * so the ordinary chain provably deletes it; only the exemption can carry it through.
 */
import { encodeLodDff } from '@opensa/lod-common/encode-dff';
import { describe, expect, it } from 'vitest';

import type { Cell } from '../../core/types';

import { config as defaultConfig } from '../../lod.config';
import { createGtaSaLodAdapter } from './index';

/** One triangle with two coincident vertices — zero area, dropped by `dropDegenerateFaces`. */
const DEGENERATE = {
  colors: new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]),
  groups: [{ indices: Uint32Array.of(0, 1, 2), texture: 'girder' }],
  normals: new Float32Array(9),
  positions: new Float32Array([0, 0, 0, 0, 0, 0, 4, 0, 4]),
  uvs: new Float32Array(6),
};

function adapterWith(holeFillModels: readonly string[]): ReturnType<typeof createGtaSaLodAdapter> {
  const dff = encodeLodDff(DEGENERATE, 'bridge');
  const archive = {
    get: (name: string): ArrayBufferLike | null => (name === 'bridge.dff' ? dff.buffer.slice(0) : null),
    names: ['bridge.dff'],
  };

  return createGtaSaLodAdapter(
    'test',
    '/nonexistent',
    { ...defaultConfig, cellSize: 256, holeFillModels },
    { archives: [archive as never] },
  );
}

const CELL: Cell = {
  cx: 0,
  cy: 0,
  instances: [{ model: 'bridge', position: [128, 128, 0], rotation: [0, 0, 0, 1], txd: 'tx' }],
};

describe('bakeCell hole-fill exemption', () => {
  describe('negative cases', () => {
    it('the ordinary chain deletes the degenerate probe model', () => {
      const baked = adapterWith([]).bakeCell({ ...CELL, instances: [...CELL.instances] });

      expect(baked.mesh.groups).toHaveLength(0);
      expect(baked.mesh.positions).toHaveLength(0);
    });
  });

  describe('positive cases', () => {
    it('a holeFillModels instance merges verbatim past every reduction track', () => {
      const baked = adapterWith(['bridge']).bakeCell({ ...CELL, instances: [...CELL.instances] });

      expect(baked.mesh.groups).toHaveLength(1);
      expect(baked.mesh.positions).toHaveLength(9); // the 3 vertices, untouched
    });
  });
});
