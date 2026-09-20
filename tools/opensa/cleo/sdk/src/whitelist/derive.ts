/**
 * The dual-target whitelist derivation (plan cleo-sdk/003): both halves machine-derived, never
 * hand-listed. Our half is the LIVE handler registry (genuinely served opcodes — declared tiers
 * are degradation for foreign scripts, not support). The real-CLEO half is the vendored DB filtered
 * by a documented, CONSERVATIVE rule: the DB carries no CLEO-version attribution (its `CLEO`
 * extension mixes the classic CLEO 4 block with CLEO 5 ids like 0DD5/2xxx, and the module
 * extensions mix 4.x-era ids with 5-only 2xxx ranges), so we take the game's own opcodes plus the
 * contiguous classic CLEO 4 core only. False negatives possible (late-4.x module opcodes), false
 * positives not — a script passing the gate never needs more than plain CLEO 4 on SA 1.0 US.
 * Residual recorded in the plan's Measurements.
 */
import { createRecordingHost, type OpcodeDef, opcodeTable, ScriptRunner } from '@opensa/cleo';

/** The contiguous classic CLEO 4 opcode block on SA 1.0 US. */
export const CLEO4_BLOCK_FIRST = 0x0a8c;
export const CLEO4_BLOCK_LAST = 0x0aef;

/**
 * The IniFiles module block. CLEO 4.4's standard distribution ships the module, and the reference
 * install MEASURABLY loads it (`IniFiles.cleo` in cleo.log — `docs/gta-sa-original/cutscenes.md`).
 */
export const INI_MODULE_FIRST = 0x0af0;
export const INI_MODULE_LAST = 0x0af5;

export interface DerivedWhitelist {
  /** Served by our VM AND runnable under plain real CLEO 4 — the default authoring surface. */
  readonly dual: readonly number[];
  /** Every opcode the VM's handler registry serves — the hard ceiling for any target. */
  readonly vmServed: readonly number[];
}

export function deriveWhitelist(): DerivedWhitelist {
  const runner = new ScriptRunner({ host: createRecordingHost() });
  const vmServed = [...runner.registry.ids()].sort((a, b) => a - b);
  const real4 = new Set<number>();
  for (const def of opcodeTable().values()) {
    const classicCleo4 = def.extension === 'CLEO' && def.id >= CLEO4_BLOCK_FIRST && def.id <= CLEO4_BLOCK_LAST;
    if (def.extension === 'default' || classicCleo4) {
      real4.add(def.id);
    }
  }

  return { dual: vmServed.filter((id) => real4.has(id)), vmServed };
}

/**
 * The `sa-only` target's half: what real CLEO 4.4 on the REFERENCE install serves — the game's own
 * opcodes, the classic CLEO 4 core, and the IniFiles module. Wider than the dual rule's "plain
 * CLEO 4" on purpose (dual stays conservative: no module opcodes); still conservative against the
 * install itself, whose other loaded modules (FileSystemOperations, IntOperations, CLEO+) are not
 * claimed until a script needs one — extending this predicate is the way to claim them.
 */
export function servedByRealCleo44(def: OpcodeDef): boolean {
  if (def.extension === 'default') {
    return true;
  }
  if (def.extension === 'CLEO' && def.id >= CLEO4_BLOCK_FIRST && def.id <= CLEO4_BLOCK_LAST) {
    return true;
  }

  return def.extension === 'ini' && def.id >= INI_MODULE_FIRST && def.id <= INI_MODULE_LAST;
}
