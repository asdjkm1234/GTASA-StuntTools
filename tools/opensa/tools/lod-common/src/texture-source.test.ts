import { openArchive } from '@opensa/renderware/archive/img-archive';
import { buildArchiveBuffer } from '@opensa/renderware/archive/img-archive';
import { describe, expect, it } from 'vitest';

import type { SourceTexture, TextureSource } from './texture-source';

import { encodeLodTxd } from './encode-txd';
import { createTextureSource, resolveFrom } from './texture-source';

/** An archive with two TXDs sharing the name `leaves` — GREEN in `first.txd`, RED in `badlands.txd`. */
function collidingArchive(): ReturnType<typeof openArchive> {
  return openArchive(
    buildArchiveBuffer([
      { data: txdBytes({ leaves: solid(16, 0, 200, 0) }), name: 'first.txd' },
      { data: txdBytes({ bark: solid(16, 90, 60, 30), leaves: solid(16, 200, 0, 0) }), name: 'badlands.txd' },
      { data: new Uint8Array([1, 2, 3]), name: 'broken.txd' }, // unparseable — must be skipped
    ]),
  );
}

/** A solid-colour texture of the given size. */
function solid(size: number, r: number, g: number, b: number): SourceTexture {
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = 255;
  }

  return { hasAlpha: false, height: size, rgba, width: size };
}

/** Encode a real TXD holding the given name→texture map (reuses the LOD TXD encoder). */
function txdBytes(textures: Record<string, SourceTexture>): Uint8Array {
  const direct: TextureSource = { get: (name) => textures[name.toLowerCase()] ?? null };

  return encodeLodTxd(Object.keys(textures), direct, 64, 'gamma');
}

describe('createTextureSource', () => {
  describe('negative cases', () => {
    it('resolves an unknown name (and an unknown TXD) to null', () => {
      const source = createTextureSource([collidingArchive()]);
      expect(source.get('ghost')).toBeNull();
      expect(source.getFrom!('badlands', 'ghost')).toBeNull();
      expect(source.getFrom!('no_such_txd', 'leaves')).toBeNull();
    });

    it('skips an unparseable TXD without failing the index', () => {
      const source = createTextureSource([collidingArchive()]);
      expect(source.get('bark')).not.toBeNull(); // indexing survived broken.txd
    });
  });

  describe('positive cases', () => {
    it('getFrom returns each TXD OWN variant of a shared name (get keeps the legacy first-wins)', () => {
      const source = createTextureSource([collidingArchive()]);

      const flat = source.get('leaves')!;
      const own = source.getFrom!('badlands', 'leaves')!;
      expect(flat.rgba[1]).toBeGreaterThan(150); // first-wins → first.txd's GREEN
      expect(own.rgba[0]).toBeGreaterThan(150); // badlands' RED — the model's actual texture
      expect(own.rgba[1]).toBeLessThan(60);
    });

    it('resolveFrom falls back to the global index for names absent from the model TXD', () => {
      const source = createTextureSource([collidingArchive()]);
      // `bark` only exists in badlands — a model whose def txd is `first` still resolves it globally.
      expect(resolveFrom(source, 'first', 'bark')).not.toBeNull();
      // And a fake without getFrom keeps working through the helper.
      const bare: TextureSource = { get: (name) => (name === 'x' ? solid(4, 1, 1, 1) : null) };
      expect(resolveFrom(bare, 'anytxd', 'x')).not.toBeNull();
    });
  });
});
