/**
 * What an added car is CALLED, and what it SOUNDS like — the two things a stock slot has for free and a new
 * model id does not (plan 003). Both merges belong to `vehicle-installer`; this file only decides what to
 * feed them.
 *
 * **The name.** The GXT key is the car's own `gameName` — column 5 of its `vehicles.ide` row, which the
 * author writes and which is what the game looks the display name up by. The text is the folder's SECOND
 * field, the one that says what the car really is (`001veh - 1971 Chevrolet Vega - alfamodding (manana)` →
 * "1971 Chevrolet Vega"), and a `text.txt` line under the same key overrides it.
 *
 * **A key the game already defines is left alone.** 18 of the 115 added cars are train carriages that reuse
 * their base's `gameName` (`FREIGHT`, `STREAK`, `FRFLAT`) rather than taking one of their own — writing an
 * `.fxt` line for those would rename the STOCK train. The check is against the built `american.gxt` itself
 * (the keys are CRC hashes in it, so a name is looked up, never listed), not against a table of exceptions.
 *
 * **The sound.** `audio.txt` if the folder ships one; otherwise the FIRST `(base)`'s own row from the built
 * `gtasa_vehicleAudioSettings.cfg`, copied under this car's model name. That inheritance is the whole reason
 * the base is part of the folder name — an added id has no row of its own and is silent without one.
 */
import { gxtKeyHash, parseGxt } from '@opensa/renderware/parsers/binary/gxt';
import { parseVehicleDefs } from '@opensa/renderware/parsers/text/vehicle-defs.parser';
import { readAudioRow, retarget } from '@opensa/vehicle-installer/audio';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AddedVehicle } from './sources';

/** Where the game's own text lives — read to see which keys already exist. */
const AMERICAN_GXT = join('text', 'american.gxt');

/** What an added car contributes beyond a replacement car's own files. */
export interface AddedCarText {
  /** The audio row to merge, already named after this car; null when it has none and none can be inherited. */
  readonly audio: null | string;
  /** The display-name entry, or null when the game already defines that key (the train carriages). */
  readonly name: NameEntry | null;
  readonly warnings: readonly string[];
}

/** One GXT entry as the `.fxt` writer takes it. */
export interface NameEntry {
  readonly key: string;
  readonly text: string;
}

/** The `what it really is` field of a folder name — everything between the first and the second ` - `. */
export function describe(folderName: string): string {
  const fields = folderName.split(' - ');

  return (fields[1] ?? fields[0]).trim();
}

/**
 * The name and sound of one added car, resolved against the BUILT tree. `ideLine` is its `vehicles.ide` row
 * with the id already substituted — the same line the install merges.
 */
export function resolveAddedCarText(source: AddedVehicle, gameDir: string, ideLine: string): AddedCarText {
  const warnings: string[] = [];
  const gameName = vehicleGameName(ideLine);
  const shipsAudio = hasAudioFile(source);
  const audio = shipsAudio ? null : inheritAudio(source, gameDir, warnings);

  if (gameName === undefined) {
    warnings.push(`${source.name}: its vehicles.ide row has no gameName column — the car has no display name`);

    return { audio, name: null, warnings };
  }
  if (gameName.length > 7) {
    warnings.push(
      `${source.name}: gameName '${gameName}' is ${gameName.length} characters — a GXT key is 7, so the ` +
        `name will not resolve in game`,
    );
  }
  if (definesKey(gameDir, gameName)) {
    return { audio, name: null, warnings };
  }

  return { audio, name: { key: gameName, text: describe(source.name) }, warnings };
}

/** The `gameName` column (5) of a `cars` row, or undefined when the line is not one. */
export function vehicleGameName(ideLine: string): string | undefined {
  const [def] = parseVehicleDefs(`cars\n${ideLine}\nend`).values();

  return def?.gameName;
}

/** Does the built `american.gxt` already define this key? Keys are hashed in the file, so this is a lookup. */
function definesKey(gameDir: string, key: string): boolean {
  const path = join(gameDir, AMERICAN_GXT);
  if (!existsSync(path)) {
    return false;
  }
  const bytes = readFileSync(path);

  return parseGxt(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).has(gxtKeyHash(key));
}

/** Does the folder ship its own `audio.txt`? Then `applyVehicle` writes it and nothing is inherited. */
function hasAudioFile(source: AddedVehicle): boolean {
  return existsSync(join(source.folder, 'audio.txt'));
}

/** The base's audio row under this car's own model name — what an added id sounds like when it ships none. */
function inheritAudio(source: AddedVehicle, gameDir: string, warnings: string[]): null | string {
  const row = source.base === '' ? null : readAudioRow(gameDir, source.base);
  if (row === null) {
    warnings.push(
      `${source.name}: no audio.txt and no row for its base '${source.base}' in the audio table — the car ` +
        `will be silent`,
    );

    return null;
  }

  return retarget(row, source.slot);
}
