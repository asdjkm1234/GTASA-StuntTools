import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { FlightRow, FlightTrack, SessionEndReason } from './csv';
import type { Vec3 } from './math';

import { parseFlightCsv, SESSION_END_REASONS } from './csv';
import { buildTrackEndpoints, endReasonOf, hasFiniteCoordinate } from './track-endpoints';

/** The five reasons the recorder actually writes, named independently of the parser's export. */
const RECORDER_REASONS = [
  'game_closed',
  'player_left_vehicle_or_vehicle_destroyed',
  'non_target_vehicle',
  'vehicle_changed',
  'quickhome_teleport_detected',
] as const;

const HEADER = 'local_timestamp,model,health,x,y,z';
const RECORDER_META = '# gtasa_flight_recorder,version=8,sample_hz=25';
const TWO_ROWS = [
  '2026-01-01T00:00:00.000,520,100.0,1111.12345,-2222.54321,33.9375',
  '2026-01-01T00:00:00.040,520,100.0,1111.22345,-2222.44321,34.0625',
].join('\n');

function csvText(metaLines: readonly string[]): string {
  return `${metaLines.join('\n')}\n${HEADER}\n${TWO_ROWS}\n`;
}

function stubRow(s: number, pos: Vec3): FlightRow {
  return { health: 100, model: 520, pos, s } as unknown as FlightRow;
}

function stubTrack(name: string, rows: readonly FlightRow[], endReason: SessionEndReason = 'unknown'): FlightTrack {
  return {
    axesNote: '',
    duration: rows.length > 0 ? rows[rows.length - 1].s : 0,
    endReason,
    events: [],
    hasRealNodes: false,
    model: 520,
    name,
    rows: [...rows],
    version: 8,
  };
}

describe('parseFlightCsv session_end', () => {
  describe('negative cases', () => {
    it('yields unknown when the recording has no session_end line', () => {
      const track = parseFlightCsv(csvText([RECORDER_META]), 'no-end.csv');

      expect(track.endReason).toBe('unknown');
    });

    it('yields unknown for a truncated session_end line without throwing', () => {
      const track = parseFlightCsv(csvText([RECORDER_META, '# session_end']), 'truncated.csv');

      expect(track.endReason).toBe('unknown');
    });

    it('yields unknown for a blank reason', () => {
      const track = parseFlightCsv(csvText([RECORDER_META, '# session_end,']), 'blank.csv');

      expect(track.endReason).toBe('unknown');
    });

    it('yields unknown for an unrecognized reason (never guessed)', () => {
      const track = parseFlightCsv(
        csvText([RECORDER_META, '# session_end,landed_safely,2026-01-01T00:00:00.040']),
        'odd.csv',
      );

      expect(track.endReason).toBe('unknown');
    });

    it('does not cache: an earlier reason never leaks into a later parse', () => {
      const ended = parseFlightCsv(
        csvText([RECORDER_META, '# session_end,game_closed,2026-01-01T00:00:00.040']),
        'a.csv',
      );
      const open = parseFlightCsv(csvText([RECORDER_META]), 'b.csv');

      expect(ended.endReason).toBe('game_closed');
      expect(open.endReason).toBe('unknown');
    });
  });

  describe('positive cases', () => {
    it('parses each of the five recorder reasons', () => {
      for (const reason of RECORDER_REASONS) {
        const track = parseFlightCsv(
          csvText([RECORDER_META, `# session_end,${reason},2026-01-01T00:00:00.040`]),
          `${reason}.csv`,
        );

        expect(track.endReason).toBe(reason);
      }
    });

    it('exposes exactly the five recorder reasons', () => {
      expect([...SESSION_END_REASONS]).toEqual([...RECORDER_REASONS]);
    });
  });
});

describe('v4-v7 backward compatibility', () => {
  it.each([4, 5, 6, 7])('parses a v%i file and keeps absent columns null', (version) => {
    const track = parseFlightCsv(
      csvText([`# gtasa_flight_recorder,version=${version},sample_hz=25`]),
      `v${version}.csv`,
    );

    expect(track.version).toBe(version);
    expect(track.rows).toHaveLength(2);
    expect(track.endReason).toBe('unknown');
    expect(track.rows[0].gameHour).toBeNull();
    expect(track.rows[0].weatherNew).toBeNull();
    expect(track.rows[0].nozzleRotation).toBeNull();
    expect(track.rows[0].smokeActive).toBeNull();
    expect(track.rows[0].propNodes).toEqual([null, null, null, null]);
    expect(track.rows[0].nodes).toEqual([null, null, null, null, null, null, null, null, null]);
    expect(buildTrackEndpoints([track])).toHaveLength(1);
  });
});

describe('buildTrackEndpoints', () => {
  describe('negative cases', () => {
    it('returns [] for an empty track list', () => {
      expect(buildTrackEndpoints([])).toEqual([]);
    });

    it('excludes a track whose rows have no finite coordinate', () => {
      const track = stubTrack('void', [stubRow(1, [NaN, NaN, NaN]), stubRow(2, [Infinity, 0, 0])]);

      expect(hasFiniteCoordinate(track)).toBe(false);
      expect(buildTrackEndpoints([track])).toEqual([]);
    });

    it('does not drop the valid tracks around an invalid one', () => {
      const tracks = [
        stubTrack('first', [stubRow(1, [1, 2, 3])]),
        stubTrack('void', [stubRow(1, [NaN, NaN, NaN])]),
        stubTrack('third', [stubRow(1, [4, 5, 6])]),
      ];
      const endpoints = buildTrackEndpoints(tracks);

      expect(endpoints.map((endpoint) => endpoint.trackIndex)).toEqual([0, 2]);
      expect(endpoints.map((endpoint) => endpoint.name)).toEqual(['first', 'third']);
    });
  });

  describe('positive cases', () => {
    it('builds exactly one endpoint per valid imported track', () => {
      const tracks = [
        parseFlightCsv(csvText([RECORDER_META, '# session_end,game_closed,2026-01-01T00:00:00.040']), 'a.csv'),
        parseFlightCsv(csvText([RECORDER_META, '# session_end,non_target_vehicle,2026-01-01T00:00:00.040']), 'b.csv'),
        parseFlightCsv(
          csvText([RECORDER_META, '# session_end,quickhome_teleport_detected,2026-01-01T00:00:00.040']),
          'c.csv',
        ),
      ];
      const endpoints = buildTrackEndpoints(tracks);

      expect(endpoints).toHaveLength(tracks.filter(hasFiniteCoordinate).length);
      expect(endpoints).toHaveLength(3);
      endpoints.forEach((endpoint, index) => {
        expect(endpoint.trackIndex).toBe(index);
        expect(endpoint.track).toBe(tracks[index]);
        expect(endpoint.endReason).toBe(tracks[index].endReason);
      });
    });

    it('retains the exact GTA coordinates of the final valid sample', () => {
      const track = parseFlightCsv(csvText([RECORDER_META]), 'exact.csv');
      const last = track.rows[track.rows.length - 1];
      const [endpoint] = buildTrackEndpoints([track]);

      expect(endpoint.position).toEqual([1111.22345, -2222.44321, 34.0625]);
      expect(endpoint.position).toEqual([last.pos[0], last.pos[1], last.pos[2]]);
      expect(endpoint.time).toBe(last.s);
      expect(endpoint.model).toBe(520);
    });

    it('uses finalValidSample: a trailing non-finite row is skipped', () => {
      const track = stubTrack('tailing', [stubRow(1, [10, 20, 30]), stubRow(2, [NaN, NaN, NaN])], 'vehicle_changed');
      const [endpoint] = buildTrackEndpoints([track]);

      expect(endpoint.time).toBe(1);
      expect(endpoint.position).toEqual([10, 20, 30]);
      expect(endpoint.endReason).toBe('vehicle_changed');
    });

    it('answers unknown for a track object from an older parser', () => {
      const legacy = { ...stubTrack('legacy', [stubRow(1, [1, 2, 3])]) } as Partial<FlightTrack>;
      delete legacy.endReason;
      const [endpoint] = buildTrackEndpoints([legacy as FlightTrack]);

      expect(endReasonOf(legacy as FlightTrack)).toBe('unknown');
      expect(endpoint.endReason).toBe('unknown');
    });
  });
});

const FIXTURE_DIR = new URL('./fixtures/', import.meta.url);
const RECORDER_META_V9 = '# gtasa_flight_recorder,version=9,sample_hz=25';

function fixtureText(name: string): string {
  return readFileSync(new URL(name, FIXTURE_DIR), 'utf8');
}

describe('parseFlightCsv events', () => {
  describe('negative cases', () => {
    it('ignores a truncated collision line without throwing', () => {
      const track = parseFlightCsv(
        csvText([RECORDER_META_V9, '# event,0.040000,collision,inferred,42']),
        'truncated-collision.csv',
      );

      expect(track.events).toEqual([]);
    });

    it('rejects a collision whose surface token is a material name', () => {
      const track = parseFlightCsv(
        csvText([RECORDER_META_V9, '# event,0.040000,collision,concrete,42.000000,101.000000,201.000000,29.000000']),
        'material.csv',
      );

      expect(track.events).toEqual([]);
    });

    it('rejects a collision missing the impact and coordinates', () => {
      const track = parseFlightCsv(
        csvText([RECORDER_META_V9, '# event,0.040000,collision,inferred']),
        'short-collision.csv',
      );

      expect(track.events).toEqual([]);
    });

    it('rejects a collision with a non-finite impact', () => {
      const track = parseFlightCsv(
        csvText([RECORDER_META_V9, '# event,0.040000,collision,inferred,nan,101.000000,201.000000,29.000000']),
        'nan-impact.csv',
      );

      expect(track.events).toEqual([]);
    });

    it('ignores a stray collision line in a pre-v9 file (stale state)', () => {
      const track = parseFlightCsv(
        csvText([RECORDER_META, '# event,0.040000,collision,inferred,42.000000,101.000000,201.000000,29.000000']),
        'v8-collision.csv',
      );

      expect(track.version).toBe(8);
      expect(track.events).toEqual([]);
    });

    it('keeps an explosion while ignoring an invalid collision in the same file', () => {
      const track = parseFlightCsv(
        csvText([
          RECORDER_META_V9,
          '# event,0.020000,explosion,100.000000,200.000000,30.000000',
          '# event,0.040000,collision,concrete,42.000000,101.000000,201.000000,29.000000',
        ]),
        'mixed-invalid.csv',
      );

      expect(track.events.map((event) => event.kind)).toEqual(['explosion']);
    });
  });

  describe('positive cases', () => {
    it('parses an inferred collision fixture and exposes no surface material', () => {
      const track = parseFlightCsv(fixtureText('inferred-collision.csv'), 'inferred-collision.csv');
      const [event] = track.events;

      expect(track.events).toHaveLength(1);
      expect(event.kind).toBe('collision');
      expect(event.surface).toBe('inferred');
      expect(event.impact).toBe(42);
      expect(event.pos).toEqual([101, 201, 29]);
      expect('material' in event).toBe(false);
      expect(Object.keys(event)).not.toContain('material');
    });

    it('parses explosion and collision shapes together, sorted by time', () => {
      const track = parseFlightCsv(fixtureText('collision-events.csv'), 'collision-events.csv');

      expect(track.events.map((event) => event.kind)).toEqual(['explosion', 'collision']);
      expect(track.events[0].surface).toBeUndefined();
      expect(track.events[1].surface).toBe('inferred');
    });

    it('parses an inline v9 collision event', () => {
      const track = parseFlightCsv(
        csvText([RECORDER_META_V9, '# event,0.040000,collision,inferred,12.5,1.000000,2.000000,3.000000']),
        'inline-v9.csv',
      );

      expect(track.events).toEqual([{ impact: 12.5, kind: 'collision', pos: [1, 2, 3], s: 0.04, surface: 'inferred' }]);
    });
  });
});

const REAL_DIR = new URL('../../../../../../GTA San Andreas/flight_recordings/', import.meta.url);
const REAL_FILES = [
  { file: 'flight_20260918_002636_125_m520_001.csv', version: 5 },
  { file: 'flight_20260920_232028_918_m520_001.csv', version: 6 },
  { file: 'flight_20260926_153900_322_m520_001.csv', version: 8 },
] as const;
const ALL_REAL_FILES_EXIST = REAL_FILES.every((entry) => existsSync(new URL(entry.file, REAL_DIR)));

describe.skipIf(!ALL_REAL_FILES_EXIST)('real recordings', () => {
  it.each(REAL_FILES)('parses $file (v$version) and models its endpoint', ({ file, version }) => {
    const track = parseFlightCsv(readFileSync(new URL(file, REAL_DIR), 'utf8'), file);

    expect(track.version).toBe(version);
    expect(track.rows.length).toBeGreaterThan(1);
    expect(track.endReason).toBe('player_left_vehicle_or_vehicle_destroyed');

    const endpoints = buildTrackEndpoints([track]);
    expect(endpoints).toHaveLength(1);
    const last = track.rows[track.rows.length - 1];
    expect(endpoints[0].position).toEqual([last.pos[0], last.pos[1], last.pos[2]]);
    expect(endpoints[0].position.every(Number.isFinite)).toBe(true);
  });
});
