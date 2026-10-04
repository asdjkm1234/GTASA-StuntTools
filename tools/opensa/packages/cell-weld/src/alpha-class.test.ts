/**
 * The alpha CLASS through the whole planner, on REAL texels (plan 092).
 *
 * The field bug it pins: `wattspark1_LAe2` (the Watts Towers) showed its own far side and the towers behind
 * it through the near one. Its lattice textures spend 23.6 % of their texels on mid alpha — twelve times
 * `classifyAlpha`'s 2 % cutout bound — so they classed softBlend, welded as pipelineClass 2, and the blend
 * pipeline writes no depth. Generated histograms cannot prove this; the DXT3 sheets the game ships can.
 */
import { decodeOstex, ostexLayerBytes, ostexMipLayout } from '@opensa/engine-formats';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { TexturePlanner } from './textures';

const DIR = join(process.cwd(), 'fixtures', 'original', 'dff', 'alpha-class');

/** A one-dictionary filesystem for the planner. */
function plannerFor(txd: string): TexturePlanner {
  const data = readFileSync(join(DIR, `${txd}.txd`));
  const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const fs = {
    get: (name: string): ArrayBuffer | null => (name.toLowerCase() === `${txd}.txd` ? bytes : null),
    getText: (): null => null,
    has: (name: string): boolean => name.toLowerCase() === `${txd}.txd`,
    names: [`${txd}.txd`],
  } as unknown as ConstructorParameters<typeof TexturePlanner>[0];

  return new TexturePlanner(fs, new Map());
}

const WHITE = [255, 255, 255, 255] as const;

/** Share of a planned layer's mip-0 texels whose alpha sits ON the alpha test (128 ± 48) — the shape
 *  {@link sharpenAlpha} collapses. Read back out of the built `.ostex`, so it measures what SHIPS. */
function nearShareOf(planner: TexturePlanner, resolved: { arrayRef: number; layer: number }): number {
  const array = planner.build().find((entry) => entry.ref === resolved.arrayRef);
  if (!array) {
    throw new Error('planned array not found');
  }
  const ostex = decodeOstex(array.bytes);
  const layerBytes = ostexLayerBytes(ostex.format, ostex.width, ostex.height, ostex.mipCount);
  const mip = ostexMipLayout(ostex.format, ostex.width, ostex.height, 0);
  let near = 0;
  let total = 0;
  for (let row = 0; row < mip.rows; row += 1) {
    const start = resolved.layer * layerBytes + row * mip.bytesPerRow;
    for (let x = 0; x < mip.mipWidth; x += 1) {
      const alpha = ostex.payload[start + x * 4 + 3];
      if (alpha >= 80 && alpha <= 176) {
        near += 1;
      }
      total += 1;
    }
  }

  return near / total;
}

describe('alpha class on real dictionaries', () => {
  describe('negative cases', () => {
    it('leaves a uniform glass film in the blend pass (keypad_glass)', () => {
      const planner = plannerFor('kmb_keypadx');

      expect(planner.resolve('kmb_keypadx', 'keypad_glass', WHITE).alphaClass).toBe('softBlend');
    });

    it('does not touch a texture with no alpha at all (the towers’ wall)', () => {
      const planner = plannerFor('lae2tempshit');

      expect(planner.resolve('lae2tempshit', 'BLOCK2', WHITE).alphaClass).toBe('opaque');
    });

    it('does not let a vegetation caller decide the class for everyone else', () => {
      // The planner dedups by texture CONTENT and plans on FIRST use, so a dictionary shared between a
      // vegetation def and an ordinary one used to hand both whichever class arrived first — silently, by
      // build order. Whoever asks now gets what they asked for.
      const planner = plannerFor('kmb_keypadx');
      const plain = planner.resolve('kmb_keypadx', 'keypad_glass', WHITE);
      const vegetation = planner.resolve('kmb_keypadx', 'keypad_glass', WHITE, true);

      expect(plain.alphaClass).toBe('softBlend');
      expect(vegetation.alphaClass).toBe('cutout');
    });
  });

  describe('positive cases', () => {
    it('classes the Watts Towers lattice as a cutout with no caller preference (the field bug)', () => {
      const planner = plannerFor('lae2tempshit');

      expect(planner.resolve('lae2tempshit', 'wattsstax1_LAe', WHITE).alphaClass).toBe('cutout');
      expect(planner.resolve('lae2tempshit', 'wattsstax4_LAe', WHITE).alphaClass).toBe('cutout');
    });

    it('sharpens what a CALLER upgraded and leaves a mask its authored edge', () => {
      // The two upgrades are not the same operation. A vegetation caller can hand over a canopy that is
      // semi-transparent everywhere, and A2C would render it as a uniform screen door — so that one is
      // steepened around the reference (074, 2026-07-13). A mask already spends only a thin edge there, and
      // steepening it would throw away the antialiasing A2C exists to resolve.
      const washed = plannerFor('kmb_keypadx');
      const asked = washed.resolve('kmb_keypadx', 'keypad_glass', WHITE, true);
      expect(asked.alphaClass).toBe('cutout');
      expect(nearShareOf(washed, asked)).toBeLessThan(0.2); // was ~0.88 of the sheet before sharpening

      const mask = plannerFor('lae2tempshit');
      const lattice = mask.resolve('lae2tempshit', 'wattsstax1_LAe', WHITE);
      expect(lattice.alphaClass).toBe('cutout');
      expect(nearShareOf(mask, lattice)).toBeGreaterThan(0.02); // the authored edge survives, unsteepened
    });
  });
});
