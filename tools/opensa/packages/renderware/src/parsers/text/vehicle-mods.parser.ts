/**
 * `data/vehicle-mods.txt` — an OpenSA data file, not one of SA's: which vehicle SLOTS a mod took over.
 *
 * Nothing about a mod survives the build. `vehicle-installer` merges each mod's rows into `handling.cfg`,
 * `vehicles.ide` and the rest, and the result is indistinguishable from stock — verified against a built
 * `carcols.dat`, which carries no marker and no residue. The installer nevertheless KNOWS the set while it
 * works, and used to throw it away; this file is that set, written down.
 *
 * Read at RUNTIME (unlike its neighbour {@link parseVehicleFeatures}, which the converter consumes at build
 * time), by video mode's car pick — a showcase run shows off the cars a player installed before it shows off
 * the stock ones (096 D10). Nothing else reads it, which is exactly what makes its failure mode mild: a
 * misspelled or missing file degrades that preference to "no preference" and changes nothing else.
 */

/**
 * Parse the ledger: the set of slot names a mod occupies, lowercased. `#` starts a comment; blank lines and
 * blank remainders are skipped.
 *
 * One name per line, and a line with several is read as several — the format is a list, and being strict
 * about which whitespace separates a list of names would only turn a hand-edit into a silent empty set.
 */
export function parseVehicleMods(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const body = line.split('#')[0].trim();
    if (body === '') {
      continue;
    }
    for (const name of body.split(/[\s,;]+/)) {
      if (name !== '') {
        out.add(name.toLowerCase());
      }
    }
  }

  return out;
}
