import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const V9_COLUMNS = [
  'transmission_gear_inferred',
  'transmission_gear_source',
  'engine_load_inferred',
  'engine_load_source',
] as const;

class CsvValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'CsvValidationError';
  }
}

interface ParsedRecording {
  readonly collisionEvents: number;
  readonly rows: readonly ReadonlyMap<string, null | string>[];
  readonly version: number;
}

/**
 * Validate every `# event,<seconds>,collision,inferred,<impact>,<x>,<y>,<z>` line. The surface token must be
 * exactly `inferred`; a measured material name or any malformed field is rejected. Returns the count so the
 * caller can report whether a collision was parsed.
 */
function parseCollisionEvents(lines: readonly string[]): number {
  let count = 0;
  for (const line of lines) {
    if (!line.startsWith('# event,')) continue;
    const cells = line.split(',').map((cell) => cell.trim());
    if (cells[2] !== 'collision') continue;
    if (cells.length !== 8) throw new CsvValidationError(`collision event must have 8 fields: ${line}`);
    if (cells[3] !== 'inferred') throw new CsvValidationError(`collision surface token must be exactly inferred, got ${cells[3] ?? '<missing>'}`);
    const seconds = Number(cells[1]);
    const impact = Number(cells[4]);
    const position = [cells[5], cells[6], cells[7]].map((value) => Number(value));
    if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(impact) || impact < 0 || !position.every(Number.isFinite)) {
      throw new CsvValidationError(`collision event has invalid numbers: ${line}`);
    }
    count += 1;
  }

  return count;
}

function parseRecording(text: string): ParsedRecording {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const contract = lines.find((line) => line.startsWith('# gtasa_flight_recorder,'));
  const versionMatch = contract?.match(/(?:^|,)version=(\d+)(?:,|$)/);
  if (versionMatch === undefined || versionMatch === null) throw new CsvValidationError('missing recorder version contract');
  const version = Number(versionMatch[1]);
  const headerIndex = lines.findIndex((line) => !line.startsWith('#'));
  if (headerIndex < 0) throw new CsvValidationError('missing CSV header');
  const header = lines[headerIndex]?.split(',') ?? [];
  if (header.length === 0 || header.some((name) => name === '')) throw new CsvValidationError('invalid CSV header');
  if (new Set(header).size !== header.length) throw new CsvValidationError('duplicate CSV header column');
  const dataLines = lines.slice(headerIndex + 1).filter((line) => !line.startsWith('#'));
  if (dataLines.length === 0) throw new CsvValidationError('recording contains no samples');
  const rows = dataLines.map((line, rowIndex) => {
    const values = line.split(',');
    if (values.length !== header.length) {
      throw new CsvValidationError(`row ${rowIndex + 1} has ${values.length} columns; expected ${header.length}`);
    }
    return new Map(header.map((name, index) => [name, values[index] ?? null]));
  });
  const collisionEvents = parseCollisionEvents(lines);
  // A collision is a v9 signal: an older file carrying one is malformed state, not a valid recording.
  if (version < 9 && collisionEvents > 0) throw new CsvValidationError('pre-v9 recording must not contain collision events');
  return { collisionEvents, rows, version };
}

function finiteRange(value: null | string, minimum: number, maximum: number, label: string, row: number): number {
  const parsed = value === null || value.trim() === '' ? Number.NaN : Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new CsvValidationError(`row ${row}: ${label} must be in [${minimum},${maximum}]`);
  }
  return parsed;
}

export async function validateRecorderCsv(file: string): Promise<ParsedRecording> {
  const parsed = parseRecording(await readFile(file, 'utf8'));
  if (parsed.version < 9) {
    for (const [rowIndex, row] of parsed.rows.entries()) {
      for (const column of V9_COLUMNS) {
        if ((row.get(column) ?? null) !== null) throw new CsvValidationError(`row ${rowIndex + 1}: pre-v9 ${column} must parse as null`);
      }
    }
    return parsed;
  }
  const first = parsed.rows[0];
  if (first === undefined) throw new CsvValidationError('recording contains no samples');
  for (const column of V9_COLUMNS) {
    if (!first.has(column)) throw new CsvValidationError(`v9 recording lacks required column ${column}`);
  }
  for (const [rowIndex, row] of parsed.rows.entries()) {
    const line = rowIndex + 1;
    const gear = finiteRange(row.get('transmission_gear_inferred') ?? null, 0, 6, 'transmission gear', line);
    if (!Number.isInteger(gear)) throw new CsvValidationError(`row ${line}: transmission gear must be an integer`);
    finiteRange(row.get('engine_load_inferred') ?? null, 0, 1, 'engine load', line);
    if (row.get('transmission_gear_source') !== 'inferred' || row.get('engine_load_source') !== 'inferred') {
      throw new CsvValidationError(`row ${line}: derived gear/load values must be flagged inferred`);
    }
  }
  return parsed;
}

async function main(): Promise<void> {
  const input = process.argv[2];
  if (input === undefined) throw new CsvValidationError('usage: validate-recorder-csv.mts <recording.csv>');
  const file = resolve(input);
  const parsed = await validateRecorderCsv(file);
  const signalSummary = parsed.version >= 9 ? 'inferred gear/load valid' : 'v9 columns null';
  console.log(`valid recorder CSV: version=${parsed.version}, samples=${parsed.rows.length}, ${signalSummary}, collision_events=${parsed.collisionEvents}, file=${file}`);
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url) {
  main().catch((error: unknown) => { // no-excuse-ok: catch -- CLI boundary
    console.error(`invalid recorder CSV: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
