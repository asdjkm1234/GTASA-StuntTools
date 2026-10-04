/**
 * Opaque pointer tokens (plan 097/05 decision 1). A script stores "pointers" in 32-bit vars and — the
 * corpus's measured behaviour — derives offsets with PLAIN integer arithmetic (`000A ADD_VAL` as often
 * as `0A8E INT_ADD`: firela does `frame += 16` with 000A). So a token IS a number whose low 12 bits
 * are the byte offset: adding a small offset changes only those bits and the token stays decodable.
 *
 * Layout: `0x50000000 | (entry << 12) | offset` — positive int32, clear of real SA addresses
 * (< 0x00C9_0000), the stdlib buffer tokens (0x4000_xxxx) and list tokens (0x4C00_xxxx).
 * 16 bits of entry (65 536 live tokens), 12 bits of offset (structs read ≤ 0x658+…).
 */
const TAG = 0x50000000;
const TAG_MASK = 0xf000_0000;
const ENTRY_SHIFT = 12;
const ENTRY_MASK = 0xffff;
const OFFSET_MASK = 0xfff;

/** What a token points AT — the domain the atlas resolves reads/writes/calls against. */
export type TokenTarget =
  /** A vehicle's RpClump (CVehicle+0x18 read). */
  | { readonly car: number; readonly kind: 'clump' }
  /** A part's RwFrame (GetFrameFromName / carNodes read). Offset 16 is its modelling CMatrix. */
  | { readonly car: number; readonly kind: 'frame'; readonly part: number }
  /** The vehicle-pool byte map (CPool+0x4 read); token offset indexes the SLOT. */
  | { readonly car: number; readonly kind: 'vehicle' }
  /** `CPools::ms_pVehiclePool` — the pool object itself. */
  | { readonly kind: 'pool' }
  /** A CVehicle (GET_VEHICLE_POINTER). */
  | { readonly kind: 'poolBytes' };

/** Mints and resolves tokens for one runner's lifetime. Identical targets share one token, so a
 *  script comparing two pointers for equality gets SA's answer. */
export class TokenTable {
  private readonly byKey = new Map<string, number>();
  private readonly targets: TokenTarget[] = [];

  /** The token number for a target at offset 0 (minting on first sight). */
  mint(target: TokenTarget): number {
    const key = keyOf(target);
    const existing = this.byKey.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const entry = this.targets.push(target) - 1;
    if (entry > ENTRY_MASK) {
      throw new RangeError('native token table exhausted (65 536 live tokens)');
    }
    const token = TAG | (entry << ENTRY_SHIFT);
    this.byKey.set(key, token);

    return token;
  }

  /** The target behind a token-shaped number, or null when the entry was never minted. */
  resolve(value: number): null | { offset: number; target: TokenTarget } {
    if (!isNativeToken(value)) {
      return null;
    }
    const target = this.targets[tokenEntry(value)];

    return target ? { offset: tokenOffset(value), target } : null;
  }
}

export function isNativeToken(value: number): boolean {
  return (value & TAG_MASK) === TAG;
}

export function tokenEntry(value: number): number {
  return (value >> ENTRY_SHIFT) & ENTRY_MASK;
}

export function tokenOffset(value: number): number {
  return value & OFFSET_MASK;
}

function keyOf(target: TokenTarget): string {
  switch (target.kind) {
    case 'clump':
      return `clump:${target.car}`;
    case 'frame':
      return `frame:${target.car}:${target.part}`;
    case 'pool':
      return 'pool';
    case 'poolBytes':
      return 'poolBytes';
    case 'vehicle':
      return `vehicle:${target.car}`;
  }
}
