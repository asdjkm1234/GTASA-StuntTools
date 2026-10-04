/**
 * Script-relative file references → VFS keys (plan 097/06 decision 5).
 *
 * CLEO file IO opcodes (`0AF0` ini reads and friends) name files the way a Windows game dir spells
 * them: backslashes, author casing, an optional `.\` game-dir prefix (`cleo\Car Left Door.ini`).
 * Every OpenSA loader lowercases VFS keys and uses forward slashes, so the reference must be
 * normalised before lookup. Pure — the future Files facet resolves through this.
 */

/** `cleo\Car Left Door.ini` → `cleo/car left door.ini` (backslashes, case, `.\` prefix, dup slashes). */
export function resolveScriptFilePath(ref: string): string {
  const forward = ref.replace(/\\/g, '/');

  return forward
    .replace(/^\.\//, '')
    .replace(/\/{2,}/g, '/')
    .replace(/^\//, '')
    .toLowerCase();
}
