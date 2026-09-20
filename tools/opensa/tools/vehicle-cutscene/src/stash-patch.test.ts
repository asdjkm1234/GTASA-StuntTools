import { buildVer2Buffer, openArchive } from '@opensa/renderware/archive/img-archive';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { patchWheelStashes, STASH_SINK_Z } from './stash-patch';

const SYND_4A = new Uint8Array(readFileSync('fixtures/original/anim/synd_4a.ifp'));
const SMOKE1B = new Uint8Array(readFileSync('fixtures/original/anim/smoke1b.ifp'));

/** The measured cswashington wheel bind-corner distances (the vanilla cs DFF's wheel locals). */
const WASHINGTON_BINDS = new Map([
  [
    'cswashington',
    new Map([
      ['wheellb', 2.03],
      ['wheellf', 1.91],
      ['wheelrb', 2.03],
      ['wheelrf', 1.91],
    ]),
  ],
]);

function readChannel(
  ifp: Uint8Array,
  objectName: string,
  boneName: string,
): { frames: number; trans: [number, number, number] } {
  const view = new DataView(ifp.buffer, ifp.byteOffset, ifp.byteLength);
  const tag = (at: number): string => String.fromCharCode(ifp[at], ifp[at + 1], ifp[at + 2], ifp[at + 3]);
  const cstr = (at: number, max: number): string => {
    let out = '';
    for (let i = 0; i < max && ifp[at + i] !== 0; i += 1) {
      out += String.fromCharCode(ifp[at + i]);
    }

    return out;
  };
  const align = (value: number): number => (value + 3) & ~3;
  let pos = 8;
  let object = '';
  while (pos + 8 <= ifp.length) {
    const kind = tag(pos);
    const size = view.getUint32(pos + 4, true);
    if (kind === 'NAME') {
      object = cstr(pos + 8, size).toLowerCase();
      pos = align(pos + 8 + size);
    } else if (kind === 'DGAN' || kind === 'CPAN') {
      pos += 8;
    } else if (kind === 'ANIM') {
      const bone = cstr(pos + 8, 28)
        .trim()
        .toLowerCase();
      const keyframesAt = align(pos + 8 + size);
      if (object === objectName && bone === boneName && tag(keyframesAt) === 'KRT0') {
        const at = keyframesAt + 8 + 16;

        return {
          frames: view.getUint32(pos + 36, true),
          trans: [view.getFloat32(at, true), view.getFloat32(at + 4, true), view.getFloat32(at + 8, true)],
        };
      }
      pos = keyframesAt;
    } else {
      pos = align(pos + 8 + size);
    }
  }
  throw new Error(`${objectName} ${boneName} not found`);
}

describe('patchWheelStashes', () => {
  describe('negative cases', () => {
    it('leaves corner-valued wheel channels untouched (a driving scene is never a stash)', () => {
      const img = buildVer2Buffer([{ data: SMOKE1B, name: 'smoke1b.ifp' }]);
      const glendaleBinds = new Map([['csglendale92', new Map([['wheel', 2.04]])]]);
      expect(patchWheelStashes(img, glendaleBinds).bytes).toBeNull();
    });

    it('ignores zero channels whose bind is not a corner (axle-nested rigs)', () => {
      const img = buildVer2Buffer([{ data: SYND_4A, name: 'synd_4a.ifp' }]);
      const nearOriginBinds = new Map([['cswashington', new Map([['wheellb', 0.1]])]]);
      expect(patchWheelStashes(img, nearOriginBinds).bytes).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('sinks the synd_4a wheel stash underground and touches nothing else', () => {
      // The one stash site in all 148 scenes (measured 2026-08-14): four cswashington wheel
      // channels driven to the origin while their binds sit on the corners.
      const img = buildVer2Buffer([
        { data: SMOKE1B, name: 'smoke1b.ifp' },
        { data: SYND_4A, name: 'synd_4a.ifp' },
      ]);
      const { bytes, patched } = patchWheelStashes(img, WASHINGTON_BINDS);
      expect(patched.sort()).toEqual([
        'synd_4a.ifp cswashington wheellb',
        'synd_4a.ifp cswashington wheellf',
        'synd_4a.ifp cswashington wheelrb',
        'synd_4a.ifp cswashington wheelrf',
      ]);

      const out = openArchive(bytes!);
      const sunk = new Uint8Array(out.get('synd_4a.ifp')!);
      for (const bone of ['wheellb', 'wheellf', 'wheelrb', 'wheelrf']) {
        const { trans } = readChannel(sunk, 'cswashington', bone);
        expect(trans[0]).toBeCloseTo(0, 4);
        expect(trans[1]).toBeCloseTo(0, 4);
        expect(trans[2]).toBeCloseTo(STASH_SINK_Z, 4);
      }
      // The authored bare-hub look survives: the Axis channels keep their corner values.
      expect(readChannel(sunk, 'cswashington', 'axis_lb').trans[2]).toBeCloseTo(0.325, 3);
      // Unrelated scenes stay byte-identical.
      expect(Buffer.compare(Buffer.from(new Uint8Array(out.get('smoke1b.ifp')!)), Buffer.from(SMOKE1B))).toBe(0);
    });
  });
});
