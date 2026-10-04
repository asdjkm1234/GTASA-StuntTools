import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { existsSync, readFileSync } from 'node:fs';

import { gameArg, openGameArchive, positionalArgs } from '../lib/game';

/**
 * Per-texture format/alpha report for TXDs — does this material have ALPHA to blend? Vanilla routes a
 * model through blended render states only on its alpha pass: a DXT1 no-alpha texture draws OPAQUE even
 * on an IdeFlag.ADDITIVE def (085 row H — casinolights* vs the circus neon's DXT3 glow textures). The
 * target is an archive entry (`vgnfremnt1`/`vgnfremnt1.txd`) or a filesystem path.
 * Run: `npx tsx scripts/debug/txd-alpha.ts <txd> [...more] [--game original]`.
 */
const archive = openGameArchive(gameArg());
for (const target of positionalArgs()) {
  let buffer = archive.get(target.endsWith('.txd') ? target : `${target}.txd`);
  if (!buffer && existsSync(target)) {
    const raw = readFileSync(target);
    // parseTxd takes the same ArrayBuffer shape the archive reader returns.
    buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  }
  if (!buffer) {
    console.log(`${target}: NOT FOUND`);
    continue;
  }
  const txd = parseTxd(buffer);
  console.log(`=== ${target}`);
  for (const tex of txd.textures) {
    console.log(`  ${tex.name}: ${tex.width}x${tex.height} format=${tex.format} hasAlpha=${tex.hasAlpha}`);
  }
}
