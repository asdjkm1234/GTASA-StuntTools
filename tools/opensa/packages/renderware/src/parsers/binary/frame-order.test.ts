/**
 * The subjects are the real pair that found this: the blade mod's two side skirts. They are the SAME
 * hierarchy exported twice — the left one parent-first, the right one child-first — so the repaired right
 * file must come out shaped exactly like the left one, which no synthetic case could assert.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseDff } from './dff';
import { frameOrderReport, reorderFrameList } from './frame-order';

const CUSTOM = join(process.cwd(), 'fixtures', 'custom', 'dff');
const FORWARD = join(CUSTOM, 'wg_r_lr_bl1-forward-parent.dff');
const ORDERED = join(CUSTOM, 'wg_l_lr_bl1-ordered.dff');

function fileOf(absolute: string): ArrayBuffer {
  const data = readFileSync(absolute);

  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

/** A frame's identity across the reorder: its name and its parent's name (the hierarchy, not the numbering). */
function hierarchy(dff: ArrayBuffer): string[] {
  const { frames } = parseDff(dff);

  return frames.map((frame) => `${frame.name} <- ${frame.parentIndex < 0 ? '(root)' : frames[frame.parentIndex].name}`);
}

describe('frameOrderReport', () => {
  describe('negative cases', () => {
    it('reports nothing for a file with no clump', () => {
      expect(frameOrderReport(new Uint8Array(4).buffer)).toEqual({ forward: [], frames: 0 });
    });

    it.skipIf(!existsSync(ORDERED))('reports nothing for a parent-first list', () => {
      expect(frameOrderReport(fileOf(ORDERED))).toEqual({ forward: [], frames: 2 });
    });
  });

  describe('positive cases', () => {
    it.skipIf(!existsSync(FORWARD))('names the frame whose parent is declared after it', () => {
      // Frame 0 claims frame 1 as its parent — the read the real game cannot do.
      expect(frameOrderReport(fileOf(FORWARD))).toEqual({ forward: [0], frames: 2 });
    });
  });
});

describe('reorderFrameList', () => {
  describe('negative cases', () => {
    it('leaves a file with no clump alone', () => {
      expect(reorderFrameList(new Uint8Array(4).buffer)).toBeNull();
    });

    it.skipIf(!existsSync(ORDERED))('leaves an already-ordered list alone rather than rewriting it', () => {
      expect(reorderFrameList(fileOf(ORDERED))).toBeNull();
    });

    it('refuses a frame naming a parent outside the list', () => {
      const dff = new Uint8Array(fileOf(FORWARD));
      // FrameList @0x24 -> its Struct @0x30, payload at 0x3C, numFrames u32, so record 0 starts at 0x40
      // and its parent index sits 48 bytes in.
      new DataView(dff.buffer).setInt32(0x40 + 48, 9, true);

      expect(() => reorderFrameList(dff.buffer)).toThrow(/outside a list of 2/);
    });
  });

  describe('positive cases', () => {
    it.skipIf(!existsSync(FORWARD))('puts the parent first and leaves the file the same length', () => {
      const before = fileOf(FORWARD);
      const after = reorderFrameList(before);

      expect(after).not.toBeNull();
      expect(after?.byteLength).toBe(before.byteLength);
      expect(frameOrderReport(after!.buffer as ArrayBuffer)).toEqual({ forward: [], frames: 2 });
    });

    it.skipIf(!existsSync(FORWARD))('keeps the hierarchy it had — only the numbering moves', () => {
      const before = fileOf(FORWARD);
      const after = reorderFrameList(before)!;

      expect(hierarchy(after.buffer as ArrayBuffer).sort()).toEqual(hierarchy(before).sort());
    });

    it.skipIf(!existsSync(FORWARD) || !existsSync(ORDERED))(
      'lands on the shape its own mirrored sibling already ships',
      () => {
        const repaired = reorderFrameList(fileOf(FORWARD))!;
        const sibling = parseDff(fileOf(ORDERED));
        const fixed = parseDff(repaired.buffer as ArrayBuffer);

        expect(fixed.frames.map((frame) => frame.parentIndex)).toEqual(
          sibling.frames.map((frame) => frame.parentIndex),
        );
        expect(fixed.atomics.map((atomic) => atomic.frameIndex)).toEqual(
          sibling.atomics.map((atomic) => atomic.frameIndex),
        );
      },
    );

    it.skipIf(!existsSync(FORWARD))('is idempotent — a repaired file needs no second pass', () => {
      const repaired = reorderFrameList(fileOf(FORWARD))!;

      expect(reorderFrameList(repaired.buffer as ArrayBuffer)).toBeNull();
    });
  });
});
