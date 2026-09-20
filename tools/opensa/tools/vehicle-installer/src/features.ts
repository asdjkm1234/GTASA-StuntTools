/**
 * A vehicle mod's `features.txt` — the Modloader/IVF convention for declaring what a model can do beyond
 * plain geometry (`UP/DOWN_LIGHTS` for retractable headlights, and whatever else an author writes).
 *
 * We do not interpret the tokens here: the installer records them per model into `data/vehicle-features.txt`
 * and the CONVERTER decides what each one means. That keeps this file honest about what it is — a declaration
 * the mod ships, carried across the build without being second-guessed. The table it writes is parsed back
 * by `@opensa/renderware`'s `vehicle-features.parser`, which documents the format.
 */

/** `<model> <FEATURE>…` lines for `data/vehicle-features.txt`, sorted so a rebuild is byte-identical. */
export function formatFeatureTable(features: ReadonlyMap<string, readonly string[]>): string {
  const rows = [...features]
    .filter(([, list]) => list.length > 0)
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([model, list]) => `${model} ${[...list].sort((a, b) => a.localeCompare(b, 'en')).join(' ')}`);

  return [
    '# OpenSA vehicle features — one line per model, written by vehicle-installer from each mod folder',
    '# own `features.txt` (the Modloader/IVF convention). Read at BUILD time by opensa-pack; the runtime',
    '# modloader path never sees it.',
    ...rows,
    '',
  ].join('\n');
}

/** The declared features of one mod, uppercased and de-duplicated. Comments (`#`, `//`) and blanks drop. */
export function parseFeatures(text: string): string[] {
  const out = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const body = line.split(/#|\/\//)[0];
    for (const token of body.split(/[\s,;]+/)) {
      if (token !== '') {
        out.add(token.toUpperCase());
      }
    }
  }

  return [...out];
}
