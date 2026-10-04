import { argValue, fromCwd } from '@opensa/tool-kit/cli';
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Splice named collision models from one `.col` LIBRARY into another, byte-for-byte: the base keeps every block it
 * has, and each named model's block is replaced by the donor's block (COL2/COL3 blocks — fourcc, u32 size, body
 * whose first 22 bytes are the model name). Nothing is re-encoded.
 *
 * Exists because a `.col` is a library and the IMG contract replaces it WHOLE (`docs/contracts/mods.md`): a mod
 * that ships `lae2_5.col` cut from STOCK to change one model silently reverts every fix an earlier mod's copy of
 * the same library carried — the installer only warns about models LOST, not models reverted. The honest shape
 * is "the previous layer's library + this mod's models", which is what this produces. Found 2026-08-17 on
 * `65. Watts towers GTA V to SA` (its `lae2_5.col` reverted three `0. Map Fixes Pack` fixes).
 *
 * Run:
 *   npx tsx scripts/debug/col-splice.ts --base <prev.col> --donor <mod.col> --models a,b,c --out <merged.col>
 *   npx tsx scripts/debug/col-splice.ts --list <file.col>       (block names + sizes, in file order)
 */
interface Block {
  readonly bytes: Uint8Array;
  readonly name: string;
}

function blocks(bytes: Uint8Array): Block[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Block[] = [];
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    const fourcc = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (!/^COL[234L]$/.test(fourcc) || size === 0 || offset + 8 + size > bytes.length) {
      break;
    }
    const nameBytes = bytes.subarray(offset + 8, offset + 30);
    const end = nameBytes.indexOf(0);
    const name = String.fromCharCode(...nameBytes.subarray(0, end < 0 ? 22 : end));
    out.push({ bytes: bytes.subarray(offset, offset + 8 + size), name });
    offset += 8 + size;
  }

  return out;
}

function main(): void {
  const list = argValue('--list');
  if (list !== undefined) {
    for (const block of blocks(new Uint8Array(readFileSync(fromCwd(list))))) {
      console.log(`${block.name}\t${block.bytes.length} B`);
    }

    return;
  }
  const base = argValue('--base');
  const donor = argValue('--donor');
  const models = argValue('--models');
  const out = argValue('--out');
  if (!base || !donor || !models || !out) {
    throw new Error('usage: col-splice.ts --base <prev.col> --donor <mod.col> --models a,b --out <merged.col>');
  }
  const wanted = new Set(models.split(',').map((name) => name.trim().toLowerCase()));
  const donorBlocks = new Map(
    blocks(new Uint8Array(readFileSync(fromCwd(donor)))).map((b) => [b.name.toLowerCase(), b]),
  );
  const merged: Uint8Array[] = [];
  const replaced: string[] = [];
  for (const block of blocks(new Uint8Array(readFileSync(fromCwd(base))))) {
    const key = block.name.toLowerCase();
    const swap = wanted.has(key) ? donorBlocks.get(key) : undefined;
    merged.push(swap ? swap.bytes : block.bytes);
    if (swap) {
      replaced.push(block.name);
    }
  }
  const missing = [...wanted].filter((name) => !replaced.some((r) => r.toLowerCase() === name));
  if (missing.length > 0) {
    throw new Error(`not in both libraries: ${missing.join(', ')}`);
  }
  const total = merged.reduce((sum, b) => sum + b.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const b of merged) {
    bytes.set(b, offset);
    offset += b.length;
  }
  writeFileSync(fromCwd(out), bytes);
  console.log(`${out}: ${merged.length} models, replaced ${replaced.join(', ')} from ${donor} (${total} B)`);
}

main();
