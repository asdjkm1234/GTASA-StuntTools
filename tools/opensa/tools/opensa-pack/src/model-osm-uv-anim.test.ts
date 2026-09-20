/**
 * UV animations survive the `.osm` round trip (plan 099/01): the writer bakes what the builder resolved,
 * the runtime's `readModelOsm` hands it back. Writer and reader sit in different packages and can only
 * drift silently, which is the same reason `vehicle-osm.test.ts` exists — this pins the animated lane on
 * the asset the plan is about, the Pacific Park ferris wheel's light ring.
 */
import type { AssetFileSystem } from '@opensa/renderware';

import { readModelOsm } from '@opensa/game/adapters/vehicle-osm';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildModelOsm } from './model-osm';

const FIXTURES = join(process.cwd(), 'fixtures', 'original');
const FERRIS = join(FIXTURES, 'mods', 'ferriswheel_lights.dff');
const ADMIRAL = join(FIXTURES, 'dff', 'vehicle', 'admiral.dff');

function fileOf(absolute: string): ArrayBuffer {
  const data = readFileSync(absolute);

  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

function fsFrom(files: Map<string, ArrayBuffer>): AssetFileSystem {
  return {
    get: (name: string): ArrayBuffer | null => files.get(name.toLowerCase()) ?? null,
    getText: (name: string): null | string => {
      const file = files.get(name.toLowerCase());

      return file ? new TextDecoder().decode(file) : null;
    },
    has: (name: string): boolean => files.has(name.toLowerCase()),
    names: [...files.keys()],
  };
}

describe.skipIf(!existsSync(FERRIS) || !existsSync(ADMIRAL))('readModelOsm (UV animations)', () => {
  describe('negative cases', () => {
    it('a model whose materials animate nothing writes no key at all, and reads back as none', () => {
      const fs = fsFrom(
        new Map([
          ['admiral.dff', fileOf(ADMIRAL)],
          ['admiral.txd', fileOf(join(FIXTURES, 'vehicles', 'admiral.txd'))],
        ]),
      );
      const built = buildModelOsm(fs, 'admiral');

      // Absent, not empty: an empty array would rewrite the DESC of every model in the pak for nothing.
      expect('uvAnimations' in built.fixture).toBe(false);
      expect(built.fixture.submeshes.some((submesh) => submesh.uvAnim !== undefined)).toBe(false);
      expect(readModelOsm('admiral', built.bytes).model.uvAnimations).toBeUndefined();
    });
  });

  describe('positive cases', () => {
    it("carries the ferris ring's `f13d` strip through the writer and back out of the reader", () => {
      const fs = fsFrom(
        new Map([
          ['ferriswheel_lights.dff', fileOf(FERRIS)],
          ['ferriswheel_lights.txd', fileOf(join(FIXTURES, 'mods', 'ferriswheel_lights.txd'))],
        ]),
      );
      const built = buildModelOsm(fs, 'ferriswheel_lights');
      const read = readModelOsm('ferriswheel_lights', built.bytes);

      expect(read.model.uvAnimations?.map((animation) => animation.name)).toEqual(['f13d']);
      expect(read.model.uvAnimations?.[0].keyframes).toHaveLength(261);
      expect(read.model.uvAnimations?.[0].duration).toBeCloseTo(29.25, 4);
      // The slot indexes the model's own list, so it has to survive JSON beside the animations it names.
      // One material, one clip — but a translucent group is emitted per spatial CLUSTER (the ring's strip
      // is two separate pieces), and every cluster of it points at the same slot.
      const animated = read.model.submeshes.filter((submesh) => submesh.uvAnim !== undefined);
      expect(animated.length).toBeGreaterThanOrEqual(1);
      expect(animated.every((submesh) => submesh.uvAnim === 0)).toBe(true);
    });
  });
});
