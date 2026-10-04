import { parseColLibrary } from '@opensa/renderware/parsers/binary/col';
import { toArrayBuffer } from '@opensa/renderware/test-utils';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { droppedCollisionModels, warnDroppedCollisions } from './col-replace';

/**
 * The real library the field case came from: `laxref.col`, 148 collision models. Mod 60 shipped a copy
 * without `ferseat01_LAx`/`lodseat01_LAx`, the IMG contract replaced the entry whole, and the loss was
 * invisible until the real game reported "model ID 3752 does not have loaded collision" months later.
 * A synthetic two-block library would not exercise the thing that made this silent: that a `.col` is a
 * LIBRARY, and a plausible replacement of it can be missing any subset of a hundred-odd models.
 */
const LAXREF = 'fixtures/original/col/laxref.col';

describe('droppedCollisionModels', () => {
  describe('negative cases', () => {
    it('names every model a partial replacement deletes', () => {
      const full = load();
      const partial = keepBlocks(full, 100);

      const dropped = droppedCollisionModels(full, partial);

      expect(dropped).toHaveLength(parseCount(full) - 100);
      expect(dropped).toContain('ferseat01_lax');
      expect(new Set(dropped).size).toBe(dropped.length);
    });

    it('reports a replacement that keeps nothing at all as losing the whole library', () => {
      const full = load();

      expect(droppedCollisionModels(full, new Uint8Array())).toHaveLength(parseCount(full));
    });
  });

  describe('positive cases', () => {
    it('reports nothing when the replacement carries every model', () => {
      expect(droppedCollisionModels(load(), load())).toEqual([]);
    });

    it('reports nothing when the replacement only ADDS models', () => {
      const partial = keepBlocks(load(), 100);

      expect(droppedCollisionModels(partial, load())).toEqual([]);
    });
  });
});

describe('warnDroppedCollisions', () => {
  describe('negative cases', () => {
    it('warns with the count and the names when a .col replacement loses models', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      warnDroppedCollisions('laxref.col', load(), keepBlocks(load(), 147));

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/laxref\.col replaced — 1 collision model\(s\) LOST/);
      warn.mockRestore();
    });
  });

  describe('positive cases', () => {
    it('stays silent for a NEW entry, for a non-.col entry and for a lossless replacement', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const partial = keepBlocks(load(), 100);

      warnDroppedCollisions('laxref.col', undefined, partial); // nothing there to lose
      warnDroppedCollisions('laxref.dff', load(), partial); // not a library — never parsed
      warnDroppedCollisions('laxref.col', load(), load());

      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});

/**
 * The first `count` COL blocks of a library, cut at a block boundary — a REAL partial library, exactly the
 * shape a mod ships. Walks the same `fourcc + u32 size` framing the parser does.
 */
function keepBlocks(bytes: Uint8Array, count: number): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  for (let i = 0; i < count && offset + 8 <= bytes.byteLength; i += 1) {
    offset += 8 + view.getUint32(offset + 4, true);
  }

  return bytes.subarray(0, offset);
}

function load(): Uint8Array {
  const buffer = readFileSync(LAXREF);

  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function parseCount(bytes: Uint8Array): number {
  return parseColLibrary(toArrayBuffer(bytes)).length;
}
