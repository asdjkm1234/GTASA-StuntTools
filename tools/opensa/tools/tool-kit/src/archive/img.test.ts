import { buildVer2Buffer, VER2_MAX_ENTRY_BYTES } from '@opensa/renderware/archive/img-archive';
import {
  closeSync,
  existsSync,
  ftruncateSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createImg, imgFamilyMembers, openImg, openImgFamily, writeImgFamily, writeImgFile } from './img';

/** Two-entry VER2 archive bytes to open + edit. */
function sampleImg(): Uint8Array {
  return buildVer2Buffer([
    { data: Uint8Array.of(1, 2, 3, 4), name: 'alpha.dff' },
    { data: Uint8Array.of(5, 6, 7, 8), name: 'beta.dff' },
  ]);
}

describe('EditableImg', () => {
  describe('negative cases', () => {
    it('returns null / false for an absent entry', () => {
      const img = openImg(sampleImg());
      expect(img.get('missing.dff')).toBeNull();
      expect(img.has('missing.dff')).toBe(false);
      expect(img.delete('missing.dff')).toBe(false);
    });

    it('reports a deleted entry as gone', () => {
      const img = openImg(sampleImg());
      expect(img.delete('alpha.dff')).toBe(true);
      expect(img.has('alpha.dff')).toBe(false);
      expect(img.names()).toEqual(['beta.dff']);
    });
  });

  describe('positive cases', () => {
    // IMG entries are sector-padded (2048) by the VER2 writer, so reads carry trailing zeros — assert prefixes.
    it('reads original entries (case-insensitive)', () => {
      const img = openImg(sampleImg());
      expect([...(img.get('ALPHA.DFF') ?? []).slice(0, 4)]).toEqual([1, 2, 3, 4]);
      expect(img.names()).toEqual(['alpha.dff', 'beta.dff']);
    });

    it('round-trips add / replace / delete through a rebuild', () => {
      const img = openImg(sampleImg());
      img.set('alpha.dff', Uint8Array.of(9, 9)); // replace
      img.set('gamma.dff', Uint8Array.of(7)); // add
      img.delete('beta.dff'); // remove

      const rebuilt = openImg(img.build());
      expect(rebuilt.names()).toEqual(['alpha.dff', 'gamma.dff']);
      expect([...(rebuilt.get('alpha.dff') ?? []).slice(0, 2)]).toEqual([9, 9]);
      expect([...(rebuilt.get('gamma.dff') ?? []).slice(0, 1)]).toEqual([7]);
      expect(rebuilt.has('beta.dff')).toBe(false);
    });
  });
});

describe('writeImgFamily', () => {
  let dir: string;

  /** An archive of `count` entries, each `bytes` long — enough to push a small cap over. */
  function padded(count: number, bytes: number): ReturnType<typeof openImg> {
    const img = openImg(buildVer2Buffer([]));
    for (let index = 0; index < count; index += 1) {
      img.set(`e${index}.dff`, new Uint8Array(bytes).fill(index + 1));
    }

    return img;
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'img-family-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  describe('negative cases', () => {
    it('never exceeds the cap, and never splits a single entry across files', () => {
      const written = writeImgFamily(padded(4, 3000), join(dir, 'veh.img'), 3 * 2048 + 2048);

      expect(written.length).toBeGreaterThan(1);
      for (const member of written) {
        expect(member.bytes).toBeLessThanOrEqual(3 * 2048 + 2048);
        expect(member.entries).toBeGreaterThan(0);
      }
    });

    it('deletes a stale sibling a shorter run leaves behind', () => {
      // A leftover vehicles3.img would stay registered in gta.dat and serve superseded entries.
      writeImgFamily(padded(4, 3000), join(dir, 'veh.img'), 3 * 2048 + 2048);
      expect(existsSync(join(dir, 'veh2.img'))).toBe(true);

      writeImgFamily(padded(1, 8), join(dir, 'veh.img'));

      expect(existsSync(join(dir, 'veh.img'))).toBe(true);
      expect(existsSync(join(dir, 'veh2.img'))).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('writes ONE file when everything fits, at the base name', () => {
      const written = writeImgFamily(padded(3, 8), join(dir, 'veh.img'));

      expect(written.map((member) => member.path)).toEqual([join(dir, 'veh.img')]);
      expect(written[0].entries).toBe(3);
    });

    it('spills into numbered siblings, keeping every entry and its bytes', () => {
      // A 3000-byte entry costs two whole sectors plus its 32-byte directory row, on top of the leading
      // directory sector every file starts with — so this cap holds exactly two of them.
      const twoEntries = 2048 + 2 * (2 * 2048 + 32);
      const written = writeImgFamily(padded(5, 3000), join(dir, 'veh.img'), twoEntries);

      expect(written.map((member) => member.path)).toEqual([
        join(dir, 'veh.img'),
        join(dir, 'veh2.img'),
        join(dir, 'veh3.img'),
      ]);
      const found = new Map<string, number>();
      for (const member of written) {
        const img = openImg(new Uint8Array(readFileSync(member.path)));
        for (const name of img.names()) {
          found.set(name, (img.get(name) ?? [])[0] ?? 0);
        }
      }
      expect(found.size).toBe(5);
      for (let index = 0; index < 5; index += 1) {
        expect(found.get(`e${index}.dff`)).toBe(index + 1);
      }
    });

    it('sizes a staged entry by stat, so planning reads nothing', () => {
      writeFileSync(join(dir, 'big.dff'), new Uint8Array(5000));
      const img = openImg(buildVer2Buffer([]));
      img.setFile('big.dff', join(dir, 'big.dff'));

      expect(img.size('big.dff')).toBe(5000);
      expect(img.size('absent.dff')).toBe(0);
    });
  });
});

describe('openImgFamily', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'img-family-open-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  /** A spilled family of `count` 3000-byte entries, two per member. */
  function spilled(count: number): string {
    const img = openImg(buildVer2Buffer([]));
    for (let index = 0; index < count; index += 1) {
      img.set(`e${index}.dff`, new Uint8Array(3000).fill(index + 1));
    }
    writeImgFamily(img, join(dir, 'veh.img'), 2048 + 2 * (2 * 2048 + 32));

    return join(dir, 'veh.img');
  }

  describe('negative cases', () => {
    it('throws when the base member is missing, and lists no members', () => {
      expect(imgFamilyMembers(join(dir, 'none.img'))).toEqual([]);
      expect(() => openImgFamily(join(dir, 'none.img'))).toThrow(/no archive family/);
    });

    it('stops at the first gap in the numbering', () => {
      const base = spilled(5);
      rmSync(join(dir, 'veh2.img'));

      expect(imgFamilyMembers(base)).toEqual([join(dir, 'veh.img')]);
      expect(openImgFamily(base).names()).toEqual(['e0.dff', 'e1.dff']);
    });
  });

  describe('positive cases', () => {
    it('sees every entry of every member, in member order, and reads each from its own file', () => {
      const base = spilled(5);

      expect(imgFamilyMembers(base)).toEqual([join(dir, 'veh.img'), join(dir, 'veh2.img'), join(dir, 'veh3.img')]);
      const img = openImgFamily(base);
      expect(img.names()).toEqual(['e0.dff', 'e1.dff', 'e2.dff', 'e3.dff', 'e4.dff']);
      for (let index = 0; index < 5; index += 1) {
        expect(img.get(`e${index}.dff`)?.[0]).toBe(index + 1);
      }
    });

    it('replaces an entry a sibling holds instead of adding a duplicate, and writes back as one family', () => {
      const base = spilled(5);
      const img = openImgFamily(base);
      img.set('e3.dff', Uint8Array.of(99));

      writeImgFamily(img, base);

      expect(imgFamilyMembers(base)).toEqual([join(dir, 'veh.img')]);
      const written = openImgFamily(base);
      expect(written.names()).toEqual(['e0.dff', 'e1.dff', 'e2.dff', 'e3.dff', 'e4.dff']);
      expect(written.get('e3.dff')?.[0]).toBe(99);
    });
  });
});

describe('EditableImg.setFile', () => {
  describe('negative cases', () => {
    it('refuses an oversized file on STAT, without reading it', () => {
      // `set` checks the ceiling against bytes it holds; staging deliberately holds none, so the same refusal
      // has to come off the file's size — otherwise the wrap lands mid-write, in the archive.
      const dir = mkdtempSync(join(tmpdir(), 'img-stage-'));
      const path = join(dir, 'huge.dff');
      const fd = openSync(path, 'w');
      ftruncateSync(fd, VER2_MAX_ENTRY_BYTES + 1); // sparse — costs no disk, no read
      closeSync(fd);

      expect(() => openImg(sampleImg()).setFile('huge.dff', path)).toThrow(/huge\.dff/);
      rmSync(dir, { force: true, recursive: true });
    });

    it('is undone by delete, like any other entry', () => {
      const dir = mkdtempSync(join(tmpdir(), 'img-stage-'));
      writeFileSync(join(dir, 'gamma.dff'), Uint8Array.of(7));
      const img = openImg(sampleImg());
      img.setFile('gamma.dff', join(dir, 'gamma.dff'));

      expect(img.delete('gamma.dff')).toBe(true);
      expect(img.get('gamma.dff')).toBeNull();
      rmSync(dir, { force: true, recursive: true });
    });
  });

  describe('positive cases', () => {
    it('adds and replaces exactly like set, and the last write of either kind wins', () => {
      const dir = mkdtempSync(join(tmpdir(), 'img-stage-'));
      writeFileSync(join(dir, 'alpha.dff'), Uint8Array.of(9, 9));
      writeFileSync(join(dir, 'gamma.dff'), Uint8Array.of(7));
      const img = openImg(sampleImg());
      img.setFile('alpha.dff', join(dir, 'alpha.dff')); // replace an original
      img.setFile('gamma.dff', join(dir, 'gamma.dff')); // add
      img.set('gamma.dff', Uint8Array.of(3)); // and back to bytes

      const rebuilt = openImg(img.build());
      expect(rebuilt.names()).toEqual(['alpha.dff', 'beta.dff', 'gamma.dff']);
      expect([...(rebuilt.get('alpha.dff') ?? []).slice(0, 2)]).toEqual([9, 9]);
      expect([...(rebuilt.get('gamma.dff') ?? []).slice(0, 1)]).toEqual([3]);
      rmSync(dir, { force: true, recursive: true });
    });
  });
});

describe('writeImgFile', () => {
  describe('negative cases', () => {
    it('throws on a VER2 name longer than 24 bytes', () => {
      const img = createImg();
      img.set('a-very-long-entry-name-way-past-24.dff', Uint8Array.of(1));
      expect(() => writeImgFile(img, join(tmpdir(), `img-${process.pid}-bad.img`))).toThrow(/name too long/);
    });

    it('REFUSES to pass the archive cap, and leaves no half-written file behind', () => {
      // Every archive writer in the repo goes through here, so this is the one place that can promise no
      // stage emits a file the next stage cannot open. A truncated archive looks finished, so it is removed.
      const dir = mkdtempSync(join(tmpdir(), 'img-cap-'));
      const path = join(dir, 'big.img');
      const img = createImg();
      for (let index = 0; index < 4; index += 1) {
        img.set(`e${index}.dff`, new Uint8Array(3000).fill(index + 1));
      }

      expect(() => writeImgFile(img, path, 3 * 2048)).toThrow(/would pass the .* archive cap at entry 'e1\.dff'/);
      expect(existsSync(path)).toBe(false);
      rmSync(dir, { force: true, recursive: true });
    });
  });

  describe('positive cases', () => {
    it('streams bytes identical to build() — sector padding, directory and order included', () => {
      const img = openImg(sampleImg());
      img.set('alpha.dff', Uint8Array.of(9, 9)); // replace
      img.set('gamma.dff', new Uint8Array(2049).fill(7)); // add spanning two sectors
      img.delete('beta.dff');

      const path = join(tmpdir(), `img-${process.pid}-roundtrip.img`);
      writeImgFile(img, path);
      const streamed = new Uint8Array(readFileSync(path));
      rmSync(path);

      expect(streamed).toEqual(img.build());
    });

    // The 24-byte name field is NUL-terminated only when shorter — TCs ship full 24-byte names (Carcer City).
    it('round-trips a full 24-byte entry name', () => {
      const img = createImg();
      img.set('cj_padlockgate_l_(d).dff', Uint8Array.of(1, 2));

      const path = join(tmpdir(), `img-${process.pid}-24byte.img`);
      writeImgFile(img, path);
      const reopened = openImg(new Uint8Array(readFileSync(path)));
      rmSync(path);

      expect(reopened.names()).toEqual(['cj_padlockgate_l_(d).dff']);
      expect([...(reopened.get('cj_padlockgate_l_(d).dff') ?? []).slice(0, 2)]).toEqual([1, 2]);
    });
  });
});
