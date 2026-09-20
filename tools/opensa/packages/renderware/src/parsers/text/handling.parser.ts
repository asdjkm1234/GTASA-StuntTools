/** One handling entry: the id + its raw fields (interpreted by the physics layer later). */
export interface HandlingEntry {
  /** Whitespace-separated fields after the id (mass, drag, dims, traction, gears, … + `F P` flags). */
  fields: string[];
  id: string;
}

/**
 * Is this a line of `handling.cfg`'s standard (car) table?
 *
 * The game decides it by the FIRST CHARACTER: `;` is a comment and each sub-table is marked with its own
 * punctuation (`!` bike, `$` flying, `%` boat, `^` anim group). Everything else is a car row, and the id may
 * therefore start with a DIGIT — which is exactly what an ADDED car's handling id looks like (`001VEH`, the
 * slot). A letter-only rule silently dropped that whole row: the car installed and ran STOCK physics, with
 * one warning that named the line and not the reason (2026-08-19, add-vehicles plan 002).
 */
export function isHandlingCarLine(line: string): boolean {
  return /^[A-Z0-9]/i.test(line.trim());
}

/**
 * Parse `handling.cfg` into a dict keyed by handling id. Only the **standard
 * (car) table** is read — see {@link isHandlingCarLine}. Fields are kept raw
 * (mixed numbers + `F`/`P` transmission flags + a hex flag); the physics
 * implementation maps columns later.
 */
export function parseHandling(text: string): Map<string, HandlingEntry> {
  const entries = new Map<string, HandlingEntry>();

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!isHandlingCarLine(line)) {
      continue; // comment / blank / a non-car sub-table line
    }
    const [id, ...fields] = line.split(/\s+/);
    entries.set(id, { fields, id });
  }

  return entries;
}
