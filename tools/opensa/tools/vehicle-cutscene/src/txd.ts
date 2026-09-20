/**
 * TXD policy (plan 002 step 6): a converted slot ships an EMPTY `cs*.txd` — kilobytes where the
 * hand-made pack shipped 11.5 MB per car — and the textures resolve through the `txdp` parent chain
 * (txdcut.ide row → the vehicle's own TXD in gta3.img, which IS the mod's when the tool runs after
 * vehicle-installer) plus the resident generic `vehicle.txd`. Vanilla proves the route: its empty cs
 * TXDs resolve the same way.
 *
 * The closure check is fail-loud per slot: every texture name the converted DFF references must resolve
 * in (parent TXD ∪ generic vehicle.txd ∪ the runtime-generated plate textures), or the slot errors with
 * the missing names. `--self-contained-txd` is the documented escape hatch: copy the parent TXD bytes
 * into the cs TXD instead.
 */
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { readRw, RW_STRUCT, RW_TEXTURE_DICTIONARY, RW_TEXTURE_NATIVE, writeRw } from '@opensa/rw-codec/chunk';

import { toArrayBuffer } from './template';

/** SA's own runtime-generated plate textures — always resolvable, never in a dictionary on disk. */
const RUNTIME_TEXTURES: ReadonlySet<string> = new Set(['carpback', 'carplate']);

const SA_RW_VERSION = 0x1803ffff;

/** A valid, EMPTY texture dictionary (what the vanilla empty cs TXDs are — one sector, zero entries). */
export function emptyTxd(version = SA_RW_VERSION): Uint8Array {
  const struct = new Uint8Array(4);
  new DataView(struct.buffer).setUint16(0, 0, true); // texture count
  new DataView(struct.buffer).setUint16(2, 2, true); // device id: D3D9, like SA's own dictionaries

  return writeRw({
    chunks: [
      {
        children: [
          { data: struct, type: RW_STRUCT, version },
          { children: [], type: 0x03, version },
        ],
        type: RW_TEXTURE_DICTIONARY,
        version,
      },
    ],
    trailing: new Uint8Array(0),
  });
}

/** Whether the model wears the plate placeholder quads — the slots the plate bake (plan 003) serves.
 *  Derived from the asset, never from the branch: bikes/boats ship no plate materials and get none. */
export function referencesPlates(dff: Uint8Array): boolean {
  const clump = parseDff(toArrayBuffer(dff));

  return clump.geometries.some((geometry) =>
    geometry.materials.some((material) => {
      const name = material.texture?.name?.trim().toLowerCase();

      return name !== undefined && RUNTIME_TEXTURES.has(name);
    }),
  );
}

/** Lowercased texture names a dictionary carries (name field of each TextureNative struct). */
export function textureNames(txd: Uint8Array): string[] {
  const dictionary = readRw(txd).chunks.find((chunk) => chunk.type === RW_TEXTURE_DICTIONARY);
  const names: string[] = [];
  for (const child of dictionary?.children ?? []) {
    if (child.type !== RW_TEXTURE_NATIVE) {
      continue;
    }
    const struct = child.children?.find((inner) => inner.type === RW_STRUCT);
    if (!struct?.data || struct.data.length < 40) {
      continue;
    }
    // TextureNative struct: u32 platform, u32 filter/addressing, char[32] name, char[32] mask.
    const raw = struct.data.subarray(8, 40);
    const end = raw.indexOf(0);
    names.push(new TextDecoder().decode(raw.subarray(0, end < 0 ? raw.length : end)).toLowerCase());
  }

  return names;
}

/** Texture names the DFF references (diffuse + mask, lowercased) that `available` cannot resolve. */
export function unresolvedTextures(dff: Uint8Array, available: ReadonlySet<string>): string[] {
  const clump = parseDff(toArrayBuffer(dff));
  const missing = new Set<string>();
  for (const geometry of clump.geometries) {
    for (const material of geometry.materials) {
      for (const name of [material.texture?.name, material.texture?.maskName]) {
        const key = name?.trim().toLowerCase();
        if (key && !available.has(key) && !RUNTIME_TEXTURES.has(key)) {
          missing.add(key);
        }
      }
    }
  }

  return [...missing].sort();
}
