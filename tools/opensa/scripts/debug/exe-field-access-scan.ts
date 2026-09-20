import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

/**
 * The completeness scan behind an engine patch: every instruction in the shipping exe that touches a struct
 * field at a given offset with a given width, and which of them sit in a context we recognise. perfect-map
 * 004 nearly shipped with one `RemoveIpl` read of `lastBuilding` unpatched (the loop back-edge re-read),
 * and 011 (`asi/perfect-map/docs/plans/011-ipldef-dummy-range.md`, step 2) was the first time the scan was
 * run to the end — this is that method, kept.
 *
 * Run: `npx tsx scripts/debug/exe-field-access-scan.ts --offset 0x26,0x28 [--width 16|32|8]
 *        [--context 0x8e3fb0,0xbc4094,0x34] [--window 150] [--exe <gta_sa.exe>] [--dis <objdump listing>]
 *        [--all] [--json]`
 *
 * Disassembles the exe with `i686-w64-mingw32-objdump` (brew install mingw-w64; `--dis` reuses a saved
 * listing), then lists every access `0x<offset>(%reg…)` of the requested width. A site is IN CONTEXT when an
 * instruction within ±`window` lines contains one of the `--context` literals — a pool/global address or a
 * `$0x<sizeof>` stride is what marks the base register as the struct you mean. Default output is the
 * in-context sites; `--all` prints every site with its context verdict; `(%esp)`/`(%ebp)` bases are tagged
 * `stack`. Classifying the survivors is still a reading job — the tool narrows 192 to 34 on 011's question (8 of the 192 are `fldcw`, an x87 control word), it does not say
 * which 3 are the readers; see the plan for what a finished classification looks like.
 */

interface Site {
  readonly address: number;
  readonly context: readonly string[];
  readonly mnemonic: string;
  readonly stack: boolean;
  readonly text: string;
}

const args = process.argv.slice(2);
const flag = (name: string): null | string => {
  const i = args.indexOf(name);

  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};
const has = (name: string): boolean => args.includes(name);

const offsets = (flag('--offset') ?? '')
  .split(',')
  .filter(Boolean)
  .map((o) => Number.parseInt(o, 16));
if (offsets.length === 0 || offsets.some((o) => Number.isNaN(o))) {
  console.error(
    'usage: exe-field-access-scan.ts --offset 0x26[,0x28] [--width 16] [--context 0x...,...] [--window 150]',
  );
  process.exit(1);
}
const width = Number(flag('--width') ?? 16);
const window = Number(flag('--window') ?? 150);
const context = (flag('--context') ?? '')
  .split(',')
  .filter(Boolean)
  .map((c) => c.toLowerCase());
const exe = flag('--exe') ?? 'game-src/original/gta_sa.exe';
const disPath = flag('--dis');

function disassemble(): string[] {
  if (disPath !== null) {
    return readFileSync(disPath, 'utf8').split('\n');
  }
  if (!existsSync(exe)) {
    console.error(`exe not found: ${exe} (pass --exe or --dis)`);
    process.exit(1);
  }
  const run = spawnSync('i686-w64-mingw32-objdump', ['-d', '-M', 'att', '--no-show-raw-insn', exe], {
    encoding: 'utf8',
    maxBuffer: 1 << 30,
  });
  if (run.error || run.status !== 0) {
    console.error(`objdump failed (${run.error?.message ?? run.stderr}) — brew install mingw-w64, or pass --dis`);
    process.exit(1);
  }

  return run.stdout.split('\n');
}

// AT&T shapes of a width-N access: a mnemonic suffixed for that width, a sign/zero-extending load, or a
// register operand of that width. 32-bit is the default operand size on i386, so it matches any `l`/none.
const REG = {
  8: '%[abcd][lh]\\b',
  16: '%(?:[abcd]x|[sd]i|[bs]p)\\b',
  32: '%e(?:[abcd]x|[sd]i|[bs]p)\\b',
}[width as 8 | 16 | 32];
const MNEMONIC = {
  8: '\\b(?:mov[sz]bl|mov[sz]bw|[a-z]+b)\\b',
  16: '\\b(?:mov[sz]wl|[a-z]+w)\\b',
  32: '\\b[a-z]+l?\\b',
}[width as 8 | 16 | 32];
if (REG === undefined || MNEMONIC === undefined) {
  console.error('--width must be 8, 16 or 32');
  process.exit(1);
}
const offsetAlt = offsets.map((o) => `0x${o.toString(16)}`).join('|');
const MEMORY = new RegExp(`(?:^|[^0-9a-fx])(?:${offsetAlt})\\(%[a-z]+(?:,%[a-z]+(?:,[1248])?)?\\)`);
const WIDTH = new RegExp(`${MNEMONIC}|${REG}`);
const LINE = /^\s*([0-9a-f]+):\t(.*)$/;

const lines = disassemble();
const sites: Site[] = [];
for (let i = 0; i < lines.length; i++) {
  const m = LINE.exec(lines[i]);
  if (!m || !MEMORY.test(m[2]) || !WIDTH.test(m[2])) {
    continue;
  }
  const text = m[2].replace(/\s+/g, ' ').trim();
  const hits = new Set<string>();
  if (context.length > 0) {
    for (let j = Math.max(0, i - window); j < Math.min(lines.length, i + window); j++) {
      const low = lines[j].toLowerCase();
      for (const c of context) {
        if (low.includes(c)) {
          hits.add(c);
        }
      }
    }
  }
  sites.push({
    address: Number.parseInt(m[1], 16),
    context: [...hits].sort(),
    mnemonic: text.split(' ')[0],
    stack: /\(%e[sb]p/.test(text),
    text,
  });
}

const inContext = context.length === 0 ? sites : sites.filter((s) => s.context.length > 0);
const shown = has('--all') ? sites : inContext;

if (has('--json')) {
  console.log(
    JSON.stringify(
      { context, inContext: inContext.length, offsets, sites: shown, total: sites.length, width, window },
      null,
      2,
    ),
  );
} else {
  for (const s of shown) {
    const tags = [s.stack ? 'stack' : null, s.context.length > 0 ? `ctx:${s.context.join('+')}` : null].filter(Boolean);
    console.log(`${s.address.toString(16).padStart(8, ' ')}  ${s.text.padEnd(36)} ${tags.join(' ')}`);
  }
  const byMnemonic = new Map<string, number>();
  for (const s of sites) {
    byMnemonic.set(s.mnemonic, (byMnemonic.get(s.mnemonic) ?? 0) + 1);
  }
  console.log(
    `\n${sites.length} ${width}-bit accesses to ${offsets.map((o) => `+0x${o.toString(16)}`).join('/')}` +
      (context.length > 0 ? `, ${inContext.length} in context (${context.join(', ')}, ±${window} lines)` : '') +
      ` — by mnemonic: ${[...byMnemonic.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')}`,
  );
}
