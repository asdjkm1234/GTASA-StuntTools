import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseDff } from '../parsers/binary/dff';
import { parseIfp } from '../parsers/binary/ifp';
import { toArrayBuffer } from '../test-utils';
import { animatedFrames, clipForModel, frameBones, frameClip } from './frame-clip';

// The stock nodding donkey (an oil pump): a 6-frame clump whose arm and counterweight swing. Its clip lives in
// counxref.ifp under the MODEL's name — the fact that trips everyone the first time.
const IFP = 'fixtures/original/dff/anim-clump/counxref.ifp';
const DFF = 'fixtures/original/dff/anim-clump/nt_noddonkbase.dff';
const MODEL = 'nt_noddonkbase';

describe.skipIf(!existsSync(IFP) || !existsSync(DFF))('frame-clip (real nt_noddonkbase + counxref.ifp)', () => {
  const clump = parseDff(toArrayBuffer(readFileSync(DFF)));
  const animations = parseIfp(toArrayBuffer(readFileSync(IFP)));

  describe('negative cases', () => {
    it('finds nothing for a model the IFP does not carry', () => {
      expect(clipForModel(animations, 'not_in_this_ifp')).toBeUndefined();
    });

    it('leaves an unmentioned frame with an EMPTY track, so it holds its bind pose', () => {
      const clip = frameClip(clump.frames, clipForModel(animations, MODEL)!);

      // Some frames of the pump are static scenery; they must not be forced to the origin.
      expect(clip.tracks.some((track) => track.times.length === 0)).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('the clip is named after the MODEL, not after the IFP file or the def', () => {
      expect(clipForModel(animations, MODEL)?.name.toLowerCase()).toBe(MODEL);
    });

    it('bones mirror the clump’s FRAME hierarchy — parents and all', () => {
      const bones = frameBones(clump.frames);

      expect(bones).toHaveLength(clump.frames.length);
      bones.forEach((bone, index) => {
        expect(bone.parent).toBe(clump.frames[index].parentIndex);
        // Identity inverse-bind: we want the frame's WORLD matrix out of the sampler, not a skinning matrix.
        expect(bone.inverseBind).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
        expect(bone.bindRotation.every(Number.isFinite)).toBe(true);
      });
      expect(bones.filter((bone) => bone.parent === -1)).toHaveLength(1); // one root
    });

    it('tracks are index-aligned with the frames, and the clip actually lasts a while', () => {
      const clip = frameClip(clump.frames, clipForModel(animations, MODEL)!);

      expect(clip.tracks).toHaveLength(clump.frames.length);
      expect(clip.duration).toBeGreaterThan(0);
      for (const track of clip.tracks) {
        expect(track.quats).toHaveLength(track.times.length * 4);
        // Times run forward — the sampler binary-searches them.
        expect([...track.times]).toEqual([...track.times].sort((a, b) => a - b));
      }
    });

    it('knows which frames MOVE — and that their children move with them', () => {
      const moved = animatedFrames(clump.frames, clipForModel(animations, MODEL)!);

      expect(moved.size).toBeGreaterThan(0);
      expect(moved.size).toBeLessThan(clump.frames.length); // the pump's base does not move
      // Whatever hangs off a moving frame moves too, even though the clip never names it.
      for (let index = 0; index < clump.frames.length; index += 1) {
        const parent = clump.frames[index].parentIndex;
        if (parent >= 0 && moved.has(parent)) {
          expect(moved.has(index)).toBe(true);
        }
      }
    });
  });
});
