/** Shared text helpers for the line-oriented GTA map formats. */

/** Split into trimmed lines, dropping blank lines and `#` comments. */
export function cleanLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

/**
 * Walk the `sectionName … end` block structure shared by IDE and IPL files.
 * Lines outside any handled section (or inside one with no handler) are ignored;
 * `end` closes the current section.
 */
export function sectionedParse(lines: string[], handlers: Record<string, (row: string[]) => void>): void {
  let section: null | string = null;
  for (const line of lines) {
    if (section === null) {
      section = line.toLowerCase();
      continue;
    }
    if (line.toLowerCase() === 'end') {
      section = null;
      continue;
    }
    handlers[section]?.(splitRow(line));
  }
}

/**
 * Split an IDE/IPL row into cells the way the game does: `CFileLoader::LoadLine` turns every comma AND every
 * control character (tabs) into a space before the section loaders `sscanf` the line, so commas and
 * whitespace are ONE separator class and a missing comma is harmless — three mod `.settings.txt` ide rows
 * ship `593, dodo\t\tdodo, plane, …` and the game reads model `dodo`, txd `dodo`. A comma-only split read
 * the model as `dodo\t\tdodo` and appended a duplicate id row (open issue 2026-08-17). Empty cells cannot
 * exist under this reading, exactly as they cannot in the game.
 */
export function splitRow(line: string): string[] {
  return line.split(/[\s,]+/).filter((cell) => cell.length > 0);
}
