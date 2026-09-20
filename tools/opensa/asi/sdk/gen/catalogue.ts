/**
 * The catalogue interfaces every `.asi` plugin's `gen/catalogue.ts` is typed against. A plugin's
 * catalogue is its machine source of truth: addresses, expected original bytes and strategies,
 * verified against the exe at every attach (never write unless the bytes still match). The
 * renderer ([render.ts](./render.ts)) turns a catalogue into the plugin's generated header; the
 * shared exe identity lives in [sa-fingerprint.ts](./sa-fingerprint.ts).
 */

/** A byte sequence expected at a runtime exe address — the per-patch original-byte verification (never write
 *  unless the bytes at `address` still match; a mismatch means an adjuster already owns the site → defer). */
export interface ByteAnchor {
  /** 1.0 US virtual address. */
  readonly address: number;
  /** The exact original bytes at `address`. */
  readonly bytes: readonly number[];
  /** Stable identifier, e.g. `IncludeEntity.entry`. */
  readonly name: string;
  readonly note?: string;
}

export interface CatalogueEntry {
  /**
   * DOCUMENTATION ONLY — the adjuster zones (FLA/OLA) known to overlap this entry, recorded so an RE session
   * can see what it is sharing the exe with. **Nothing reads it**: deferral is decided at runtime, per site,
   * by the byte-verify (`asi::VerifySitesOrDefer`) — an adjuster that owns a site is detected by its bytes,
   * never by this list. Do not add a zone here expecting coexistence behaviour to change; there is none to
   * change. Same for `strategy` and `summary`.
   */
  readonly conflictsWith?: readonly string[];
  /** kebab-case id, e.g. `ipldef-range`. */
  readonly id: string;
  /** Where the entry was derived from: the gta-reversed-modern file/function and the commit consulted
   *  at RE time (navigation for future RE sessions — the exe-side byte verify is the correctness referee). */
  readonly provenance: string;
  /** The byte-verify sites this patch touches (its `apply` confirms these before writing). */
  readonly sites: readonly ByteAnchor[];
  /** `hook` = detour/observe on a callable entry; `relocate` = repoint a too-small static array. */
  readonly strategy: 'hook' | 'relocate';
  readonly summary: string;
}

/** A byte sequence at a FILE offset — the version fingerprint reads these from the exe on DISK, so it identifies
 *  the build regardless of what an in-memory adjuster (FLA/OLA) has patched at runtime. */
export interface FileAnchor {
  /** The exact original bytes at `fileOffset`. */
  readonly bytes: readonly number[];
  /** Offset into the exe file. */
  readonly fileOffset: number;
  readonly name: string;
  readonly note?: string;
}

export interface Fingerprint {
  /** DISK-read anchor bytes proving the exe identity — file offsets, so a loaded FLA/OLA can't invalidate them. */
  readonly anchors: readonly FileAnchor[];
  /** Exact file size of the only accepted `gta_sa.exe`. */
  readonly exeSize: number;
  /** Its SHA1 (40 hex chars). */
  readonly sha1: string;
}
