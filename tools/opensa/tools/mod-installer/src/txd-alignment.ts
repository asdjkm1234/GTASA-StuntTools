import { parseTxd } from '@opensa/renderware/parsers/binary/txd';

/**
 * A DXT raster whose side is not a multiple of 4 never loads in the real game and takes its WHOLE dictionary
 * down — every model on that TXD is never drawn (`docs/restrictions/dxt-raster-dimensions.md`, 2026-08-17:
 * five clone dictionaries and one mod's own 932×358 sign). The installer stays byte-faithful — a mod's TXD
 * is installed as shipped, and map-optimizer resamples any such raster later in the pipeline — but the mod
 * that BRINGS one is named here, at install time, instead of at the field round that finds the hole.
 */
export function unalignedDxtTextures(bytes: Uint8Array): string[] {
  let dictionary;
  try {
    dictionary = parseTxd(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  } catch {
    return []; // not a dictionary this parser reads — nothing to judge, and not this check's job to refuse
  }
  const found: string[] = [];
  for (const texture of dictionary.textures) {
    const dxt = String(texture.format).startsWith('dxt');
    if (dxt && (texture.width % 4 !== 0 || texture.height % 4 !== 0)) {
      found.push(`${texture.name} ${texture.width}x${texture.height} ${texture.format}`);
    }
  }

  return found;
}

/** Warn, per texture, when a `.txd` a mod ships (or one we merged its PNGs into) carries a non-aligned DXT raster. */
export function warnUnalignedDxt(entryName: string, bytes: Uint8Array, origin: string): void {
  if (!entryName.toLowerCase().endsWith('.txd')) {
    return;
  }
  for (const texture of unalignedDxtTextures(bytes)) {
    console.warn(
      `mod-installer: ${origin} ships ${entryName}: ${texture} — not a multiple of 4, the real game refuses ` +
        'the whole dictionary (map-optimizer will resample it)',
    );
  }
}
