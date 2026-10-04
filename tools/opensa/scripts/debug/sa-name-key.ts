/**
 * sa-name-key — the game's own name hash (`CKeyGen::GetUppercaseKey`, 0x53CF30) for a list of names, so a
 * runtime log that prints `CBaseModelInfo::m_nKey` can be read back as MODEL NAMES. SA keeps no model-name
 * string at runtime: a model info carries only this key, which is why an ASI's census logs the number.
 *
 * It is CRC-32-IEEE (poly 0xEDB88320, initial 0xFFFFFFFF, no final xor) over the UPPERCASED name. Signed is
 * printed too because a log that formats the key as int32 shows the negative form (perfect-cutscene's does).
 *
 * Run: `npx tsx scripts/debug/sa-name-key.ts csgreenwood cswashington csplay`
 */
const TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let bit = 0; bit < 8; bit++) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  TABLE[i] = c >>> 0;
}

export function uppercaseKey(name: string): number {
  let key = 0xffffffff;
  for (const char of name.toUpperCase()) {
    key = (TABLE[(char.charCodeAt(0) ^ key) & 0xff] ^ (key >>> 8)) >>> 0;
  }

  return key >>> 0;
}

const names = process.argv.slice(2);
if (names.length === 0) {
  throw new Error('usage: tsx scripts/debug/sa-name-key.ts <name> [...more]');
}
for (const name of names) {
  const key = uppercaseKey(name);
  console.log(`${name.padEnd(20)} ${String(key).padStart(10)}  signed ${key | 0}`);
}
