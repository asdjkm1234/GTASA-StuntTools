import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Offline oracle for the recorder's INFERRED collision detection.  It replays one recording's own `health`
// and `vx/vy/vz` columns through the SAME thresholds the recorder uses (no flight needed) and asserts that
// at least one `# event,<seconds>,collision,inferred,<impact>,<x>,<y>,<z>` line would be emitted.
//
// Keep these in lockstep with recorder/src/FlightRecorderASI.cpp:
//   kCollisionHealthDrop      (line 47)  20.0 health points
//   kCollisionAccelSpike      (line 48)  30.0 m/s^2
//   kCollisionEnvelopeDecay   (line 49)  60.0 / second
//   kCollisionCooldownSeconds (line 50)  1.0 second
const COLLISION_HEALTH_DROP = 20.0;
const COLLISION_ACCEL_SPIKE = 30.0;
const COLLISION_ENVELOPE_DECAY = 60.0;
const COLLISION_COOLDOWN_SECONDS = 1.0;
const FALLBACK_SAMPLE_SECONDS = 1 / 25;

class CollisionCheckError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'CollisionCheckError';
  }
}

interface DetectionHit {
  readonly sampleIndex: number;
  readonly seconds: number;
  readonly healthDrop: number;
  readonly impact: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface ReplayResult {
  readonly hits: readonly DetectionHit[];
  readonly samples: number;
  readonly skipped: number;
  readonly maxAccel: number;
  readonly maxHealthDrop: number;
}

function findHeader(lines: readonly string[]): { readonly header: readonly string[]; readonly headerIndex: number } {
  const headerIndex = lines.findIndex((line) => !line.startsWith('#'));
  if (headerIndex < 0) throw new CollisionCheckError('recording has no CSV header');
  const header = lines[headerIndex]?.split(',') ?? [];
  if (header.length === 0) throw new CollisionCheckError('recording has an empty CSV header');
  return { header, headerIndex };
}

function cell(values: readonly string[], index: ReadonlyMap<string, number>, name: string): number | null {
  const at = index.get(name);
  if (at === undefined) return null;
  const raw = values[at];
  if (raw === undefined || raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Replay `health` + `vx/vy/vz` through the recorder's collision logic.  A truncated/short/non-finite row is
 * skipped and counted, never thrown on, so malformed input degrades to a skip instead of a crash.
 */
function replayRecording(text: string): ReplayResult {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const { header, headerIndex } = findHeader(lines);
  const index = new Map(header.map((name, at) => [name, at] as const));
  for (const required of ['health', 'vx', 'vy', 'vz']) {
    if (!index.has(required)) throw new CollisionCheckError(`recording lacks required column ${required}`);
  }

  const hits: DetectionHit[] = [];
  let samples = 0;
  let skipped = 0;
  let maxAccel = 0;
  let maxHealthDrop = 0;
  let envelope = 0;
  let lastCollisionSeconds = -1.0e9;
  let previousHealth: number | null = null;
  let previousVx = 0;
  let previousVy = 0;
  let previousVz = 0;
  let previousElapsed: number | null = null;
  let rowIndex = -1;

  for (let at = headerIndex + 1; at < lines.length; at++) {
    const line = lines[at];
    if (line === undefined || line.startsWith('#')) continue;
    rowIndex += 1;
    const values = line.split(',');
    if (values.length !== header.length) {
      skipped += 1;
      continue;
    }
    const health = cell(values, index, 'health');
    const vx = cell(values, index, 'vx');
    const vy = cell(values, index, 'vy');
    const vz = cell(values, index, 'vz');
    const x = cell(values, index, 'x');
    const y = cell(values, index, 'y');
    const z = cell(values, index, 'z');
    const elapsed = cell(values, index, 'capture_elapsed_s');
    if (health === null || vx === null || vy === null || vz === null || x === null || y === null || z === null) {
      skipped += 1;
      continue;
    }
    samples += 1;

    const seconds = elapsed ?? (previousElapsed ?? 0) + FALLBACK_SAMPLE_SECONDS;
    const deltaSeconds = elapsed !== null && previousElapsed !== null && elapsed > previousElapsed
      ? elapsed - previousElapsed
      : FALLBACK_SAMPLE_SECONDS;

    if (previousHealth !== null) {
      const accel = deltaSeconds > 0.0001
        ? Math.sqrt((vx - previousVx) ** 2 + (vy - previousVy) ** 2 + (vz - previousVz) ** 2) / deltaSeconds
        : 0;
      envelope = Math.max(accel, envelope - COLLISION_ENVELOPE_DECAY * Math.max(deltaSeconds, 0));
      const healthDrop = previousHealth - health;
      maxAccel = Math.max(maxAccel, accel);
      maxHealthDrop = Math.max(maxHealthDrop, healthDrop);
      // OR semantics, matching the recorder: EITHER signal fires; cooldown collapses the damage tail to one line.
      const signal = healthDrop >= COLLISION_HEALTH_DROP || envelope >= COLLISION_ACCEL_SPIKE;
      if (signal && seconds - lastCollisionSeconds >= COLLISION_COOLDOWN_SECONDS) {
        hits.push({ sampleIndex: rowIndex, seconds, healthDrop, impact: envelope, x, y, z });
        lastCollisionSeconds = seconds;
        envelope = 0;
      }
    }

    previousHealth = health;
    previousVx = vx;
    previousVy = vy;
    previousVz = vz;
    previousElapsed = elapsed;
  }

  if (samples === 0) throw new CollisionCheckError('recording contains no usable samples');
  return { hits, samples, skipped, maxAccel, maxHealthDrop };
}

async function main(): Promise<void> {
  const input = process.argv[2];
  if (input === undefined) throw new CollisionCheckError('usage: check-collision-detection.mts <recording.csv>');
  const file = resolve(input);
  // Read fresh from disk on every invocation: no cached state, no fixture, no fabricated event.
  const result = replayRecording(await readFile(file, 'utf8'));
  console.log(`collision detection oracle: file=${file}`);
  console.log(`  thresholds: health_drop>=${COLLISION_HEALTH_DROP} OR envelope>=${COLLISION_ACCEL_SPIKE} m/s^2; decay=${COLLISION_ENVELOPE_DECAY}/s; cooldown=${COLLISION_COOLDOWN_SECONDS}s`);
  console.log(`  samples=${result.samples} skipped=${result.skipped} max_health_drop=${result.maxHealthDrop.toFixed(2)} max_accel=${result.maxAccel.toFixed(2)} m/s^2`);
  for (const hit of result.hits) {
    console.log(`  hit sample=${hit.sampleIndex} t=${hit.seconds.toFixed(3)}s health_delta=${hit.healthDrop.toFixed(2)} impact=${hit.impact.toFixed(2)} m/s^2 pos=(${hit.x.toFixed(3)},${hit.y.toFixed(3)},${hit.z.toFixed(3)})`);
  }
  if (result.hits.length === 0) {
    console.error(`FAIL: no collision event would be emitted for ${file}`);
    process.exitCode = 1;
    return;
  }
  console.log(`OK: ${result.hits.length} inferred collision event(s) would be emitted`);
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url) {
  main().catch((error: unknown) => { // no-excuse-ok: catch -- CLI boundary
    console.error(`collision detection oracle failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
