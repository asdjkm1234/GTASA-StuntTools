import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { buildAudioTimeline, parseAudioManifest } from './audio-engine';
import { cockpitInstrumentState } from './cockpit-instrument-data';
import { parseFlightCsv, sampleTrack } from './csv';

const original = new URL(
  '../../../../../../GTA San Andreas/flight_recordings/flight_20261003_023248_358_m520_015.csv',
  import.meta.url,
);
const manifest = new URL('../../../../map-pak/audio/manifest.json', import.meta.url);
const removed = new Set([
  'ax',
  'ay',
  'az',
  'center_gear_status',
  'engine_load_inferred',
  'engine_load_source',
  'misc_a_x',
  'misc_a_y',
  'misc_a_z',
  'misc_b_x',
  'misc_b_y',
  'misc_b_z',
  'nozzle_rotation_previous',
  'prop_node_status',
  'steer',
  'transmission_gear_source',
]);

describe('v13 recorder reduction', () => {
  it.skipIf(!existsSync(original) || !existsSync(manifest))(
    'preserves real v12 replay and both aircraft audio models when unused columns are removed',
    () => {
      const text = readFileSync(original, 'utf8');
      const lines = text.trim().split(/\r?\n/);
      const header = lines.find((line) => line.startsWith('local_timestamp,'))!.split(',');
      const indices = header.flatMap((name, index) => (removed.has(name) ? [] : [index]));
      expect(header).toHaveLength(117);
      expect(indices).toHaveLength(101);
      const reduced = lines
        .map((line) =>
          line.startsWith('#')
            ? line.replace('version=12,', 'version=13,')
            : indices.map((index) => line.split(',')[index]).join(','),
        )
        .join('\n');
      const bank = parseAudioManifest(readFileSync(manifest, 'utf8'));
      // Hydra is real input; the model-476 variant is a synthetic audio compatibility check.
      for (const model of [520, 476]) {
        const before = parseFlightCsv(text, 'same-recording.csv');
        const after = parseFlightCsv(reduced, 'same-recording.csv');
        before.model = after.model = model;
        for (const track of [before, after]) for (const row of track.rows) row.model = model;
        expect(after.events).toEqual(before.events);
        expect(after.duration).toBe(before.duration);
        const retained = (row: object): object =>
          Object.fromEntries(
            Object.entries(row).filter(
              ([key]) => !['engineLoadInferred', 'nozzleRotationPrevious', 'steer'].includes(key),
            ),
          );
        for (let i = 0; i < before.rows.length; i++) {
          expect(retained(after.rows[i])).toEqual(retained(before.rows[i]));
        }
        const oldAudio = buildAudioTimeline(before, bank);
        const newAudio = buildAudioTimeline(after, bank);
        expect(newAudio.engineAvailable).toBe(true);
        for (const s of [0, 0.02, before.duration / 2, before.duration - 0.02]) {
          expect(newAudio.frameAt(s)).toEqual(oldAudio.frameAt(s));
          expect(cockpitInstrumentState(after, sampleTrack(after, s), s)).toEqual(
            cockpitInstrumentState(before, sampleTrack(before, s), s),
          );
        }
      }
    },
  );
});
