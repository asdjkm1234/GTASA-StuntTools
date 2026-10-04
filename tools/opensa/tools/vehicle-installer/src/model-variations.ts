/**
 * `model-variations-extra.txt` — a vehicle mod's own section for **ModelVariations 10.7** (mod `11` of the
 * `sa` layer), the plugin that gives a stock slot behaviour the game's own data files cannot express:
 * which trailers it tows, how often, whether their colours match.
 *
 *   [tug]
 *   Trailers1={{bagboxa}},{{bagboxb}},{{tugstair}}
 *   Global=Trailers1
 *   TrailersSpawnChance=95
 *
 * The section is merged into the built `modloader/Model_Variations/ModelVariations_Vehicles.ini` by SECTION
 * NAME — replaced when it is already there, appended when it is not — so a rebake over the same mod changes
 * nothing the install did not. `[Settings]` is the plugin's own and is never written from a mod folder.
 *
 * `{{name}}` is a MODEL NAME, resolved to the id it holds in the built tree's IDEs: the plugin reads ids,
 * not names, in a value (`Error reading key %s in [%s]: invalid model id %s` is its own string).
 *
 * **A name no IDE in the tree defines is DROPPED, with a warning** (the user's call, 2026-08-19). Eight of
 * these files reference added cars (`{{205veh}}`, plan 102), and the ones naming a set this build does not
 * contain — `205veh`–`216veh`, trailers that arrive with the trains of add-vehicles 008+ — can never
 * resolve. Shipping the literal `{{…}}` was worse than dropping it: the plugin refuses the key, the truck
 * tows nothing, and the only record is a line in its own log that nobody reads.
 *
 * Dropping is done at the smallest unit that keeps the author's MEANING, because a value is a list of
 * choices and a bracket group is one trailer CHAIN:
 *
 *   - `Trailers1=584,{{211veh}}` → `Trailers1=584` — the stock trailer still tows, only the missing choice
 *     goes;
 *   - `Trailers1=[{{205veh}}-{{206veh}}]` → the whole GROUP goes: half a road train is not a smaller road
 *     train, it is a different vehicle;
 *   - a key left with nothing goes, and every `Global=` reference to that key goes with it — a dangling
 *     `Global=Trailers1` is the same refused key by another route.
 *
 * The file was found unread by the 212-folder census (session 28): eight trucks ship trailer behaviour the
 * built ini never carried.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ideModelNames } from './tuning-parts';

export const MODEL_VARIATIONS_EXTRA_FILE = 'model-variations-extra.txt';

/** Where ModelVariations 10.7 reads its vehicle sections from, inside the built game dir. */
export const MODEL_VARIATIONS_INI = join('modloader', 'Model_Variations', 'ModelVariations_Vehicles.ini');

/** The plugin's own settings block — a mod folder may not write it. */
const SETTINGS_SECTION = 'settings';

/** One `[name]` block of an ini file: the header's name and every line under it, verbatim. */
export interface IniSection {
  /** A comment line written above the header when the section is created — `### blade` over `[536]`. */
  readonly caption?: string;
  readonly lines: readonly string[];
  readonly name: string;
}

const SECTION_HEADER = /^\[([^\]]+)\]$/;
const PLACEHOLDER = /\{\{([^}]+)\}\}/g;

/** Apply a mod folder's `model-variations-extra.txt` (if it ships one) to the built game dir. Returns warnings. */
export function applyModelVariations(folderPath: string, entries: readonly string[], outPath: string): string[] {
  const file = entries.find((name) => name.toLowerCase() === MODEL_VARIATIONS_EXTRA_FILE);
  if (!file) {
    return [];
  }
  const sections = parseIniSections(readFileSync(join(folderPath, file), 'latin1'));
  const warnings: string[] = [];
  const writable = sections.filter((section) => {
    if (section.name.toLowerCase() === SETTINGS_SECTION) {
      warnings.push(`${MODEL_VARIATIONS_EXTRA_FILE}: [${section.name}] is the plugin's own block — not written`);

      return false;
    }

    return true;
  });
  if (writable.length === 0) {
    return warnings;
  }
  const path = join(outPath, MODEL_VARIATIONS_INI);
  if (!existsSync(path)) {
    warnings.push(
      `${MODEL_VARIATIONS_EXTRA_FILE}: ${MODEL_VARIATIONS_INI} is not in the tree — ModelVariations 10.7 is ` +
        `not in this build; ${writable.length} section(s) not written`,
    );

    return warnings;
  }
  const names = ideModelNames(outPath);
  let text = readFileSync(path, 'latin1');
  for (const section of writable) {
    const { lines: resolved, warnings: dropped } = resolveSectionLines(section, names);
    warnings.push(...dropped);
    text = mergeIniSection(text, { lines: resolved, name: section.name });
  }
  writeFileSync(path, text, 'latin1');

  return warnings;
}

/**
 * Merge single KEYS into a section, keeping every other key it already has — the section-level merge above
 * replaces a block outright, which is right for a mod's authored file and wrong for two writers that own
 * different keys of the same section (`add-vehicles` 004 owns `Global`, 006 owns the tuning keys).
 * Creates the section when the file has none.
 */
export function mergeIniKeys(
  text: string,
  section: string,
  keys: ReadonlyMap<string, string>,
  /** A comment written above a section this call CREATES — an id-keyed section says whose id it is. */
  caption?: string,
): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => headerName(line)?.toLowerCase() === section.toLowerCase());
  if (start === -1) {
    return mergeIniSection(text, {
      ...(caption === undefined ? {} : { caption }),
      lines: [...keys].map(([key, value]) => `${key}=${value}`),
      name: section,
    });
  }
  let end = start + 1;
  while (end < lines.length && headerName(lines[end]) === null) {
    end += 1;
  }
  const body = lines.slice(start + 1, end);
  const written = new Set<string>();
  for (const [index, line] of body.entries()) {
    const name = line.split('=')[0].trim().toLowerCase();
    const value = [...keys].find(([key]) => key.toLowerCase() === name);
    if (value) {
      body[index] = `${value[0]}=${value[1]}`;
      written.add(value[0].toLowerCase());
    }
  }
  const fresh = [...keys].filter(([key]) => !written.has(key.toLowerCase())).map(([key, value]) => `${key}=${value}`);
  // Above the trailing blanks, so re-running writes the same bytes.
  let at = body.length;
  while (at > 0 && body[at - 1].trim() === '') {
    at -= 1;
  }
  body.splice(at, 0, ...fresh);
  lines.splice(start + 1, end - start - 1, ...body);

  return lines.join(text.includes('\r\n') ? '\r\n' : '\n');
}

/**
 * Replace the `[section]` block of `text` with this one, or append it when the file has none. Everything
 * outside the block is left byte-for-byte as it was — the plugin's `[Settings]` included.
 */
export function mergeIniSection(text: string, section: IniSection): string {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const block = [...(section.caption === undefined ? [] : [section.caption]), `[${section.name}]`, ...section.lines];
  const start = lines.findIndex((line) => headerName(line)?.toLowerCase() === section.name.toLowerCase());
  if (start !== -1) {
    let end = start + 1;
    while (end < lines.length && headerName(lines[end]) === null) {
      end += 1;
    }
    // Trailing blanks of the replaced block go with it: re-running writes the same bytes either way.
    while (end > start + 1 && lines[end - 1].trim() === '') {
      end -= 1;
    }
    lines.splice(start, end - start, ...block);

    return lines.join(newline);
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }

  return [...lines, '', ...block, ''].join(newline);
}

/** The `[name]` blocks of an ini file, in order. Lines before the first header are dropped (a mod ships none). */
export function parseIniSections(text: string): IniSection[] {
  const sections: { lines: string[]; name: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') {
      continue;
    }
    const name = headerName(line);
    if (name !== null) {
      sections.push({ lines: [], name });
    } else {
      sections[sections.length - 1]?.lines.push(line);
    }
  }

  return sections;
}

/** The value of one key inside one section, or undefined when either is absent. */
export function readIniKey(text: string, section: string, key: string): string | undefined {
  const block = parseIniSections(text).find(({ name }) => name.toLowerCase() === section.toLowerCase());
  const line = block?.lines.find((entry) => entry.split('=')[0].trim().toLowerCase() === key.toLowerCase());

  return line === undefined ? undefined : line.slice(line.indexOf('=') + 1).trim();
}

/** Substitute every `{{model}}` with the id that model holds in the tree; an unknown one is reported and kept. */
export function resolvePlaceholders(
  line: string,
  names: ReadonlyMap<string, number>,
  onMissing: (name: string) => void,
): string {
  return line.replace(PLACEHOLDER, (whole, name: string) => {
    const id = names.get(name.trim().toLowerCase());
    if (id === undefined) {
      onMissing(name.trim());

      return whole;
    }

    return String(id);
  });
}

/** A `Global=Trailers1,514` whose `Trailers1` was just dropped loses that reference — and itself if empty. */
function dropReferences(
  section: IniSection,
  lines: readonly string[],
  emptied: ReadonlySet<string>,
  warnings: string[],
): { lines: string[]; warnings: string[] } {
  const out: string[] = [];
  for (const line of lines) {
    const at = line.indexOf('=');
    const key = at === -1 ? '' : line.slice(0, at).trim();
    if (at === -1 || emptied.has(key.toLowerCase())) {
      out.push(line);
      continue;
    }
    const items = line.slice(at + 1).split(',');
    const kept = items.filter((item) => !emptied.has(item.trim().toLowerCase()));
    if (kept.length === items.length) {
      out.push(line);
      continue;
    }
    if (kept.length === 0) {
      warnings.push(
        `${MODEL_VARIATIONS_EXTRA_FILE}: [${section.name}] ${key} referenced only dropped key(s) — dropped too`,
      );
      continue;
    }
    out.push(`${key}=${kept.map((item) => item.trim()).join(',')}`);
  }

  return { lines: out, warnings };
}

/** `[tug]` → `tug`; anything else → null. */
function headerName(line: string): null | string {
  return SECTION_HEADER.exec(line.trim())?.[1].trim() ?? null;
}

/**
 * One section's lines with every unresolvable model name dropped: the item that names it, the key it empties,
 * and any `Global=` reference to a key that went. See this file's header for why the unit is the item.
 */
function resolveSectionLines(
  section: IniSection,
  names: ReadonlyMap<string, number>,
): { lines: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const emptied = new Set<string>();
  const lines: string[] = [];
  for (const line of section.lines) {
    // A line that resolves whole is written back AS AUTHORED (ids substituted, the author's spacing kept);
    // only a line that loses something is rebuilt from its surviving items.
    const gone: string[] = [];
    const whole = resolvePlaceholders(line, names, (name) => gone.push(name));
    const at = line.indexOf('=');
    if (gone.length === 0 || at === -1) {
      lines.push(whole);
      continue;
    }
    const key = line.slice(0, at).trim();
    const kept: string[] = [];
    const missing: string[] = [];
    for (const item of line.slice(at + 1).split(',')) {
      const lost: string[] = [];
      const resolved = resolvePlaceholders(item, names, (name) => lost.push(name));
      if (lost.length > 0) {
        missing.push(...lost);
        continue;
      }
      kept.push(resolved.trim());
    }
    const named = missing.map((name) => `'${name}'`).join(', ');
    if (kept.length === 0) {
      emptied.add(key.toLowerCase());
      warnings.push(
        `${MODEL_VARIATIONS_EXTRA_FILE}: [${section.name}] ${key} names only ${named}, which no IDE in the ` +
          'tree defines — the key is dropped',
      );
      continue;
    }
    warnings.push(
      `${MODEL_VARIATIONS_EXTRA_FILE}: [${section.name}] ${key} drops ${named} — no IDE in the tree defines ` +
        `that model; ${kept.length} entry/entries kept`,
    );
    lines.push(`${key}=${kept.join(',')}`);
  }

  return emptied.size === 0 ? { lines, warnings } : dropReferences(section, lines, emptied, warnings);
}
