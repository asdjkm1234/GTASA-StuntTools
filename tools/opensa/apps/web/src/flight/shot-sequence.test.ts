import { describe, expect, it } from 'vitest';

import type { ShotView } from './shot-camera';
import type { ShotSequence } from './shot-sequence';

import { parseFlightCsv } from './csv';
import { buildDiagramSegments } from './shot-camera-diagram';
import { programShotAt, resizeShotSequence, validShotProgram, validShotSequence } from './shot-sequence';

const fixed: ShotView = { fovYDeg: 60, kind: 'fixed', pitch: 0, position: [100, 200, 300], yaw: 1 };
const follow: ShotView = { fovYDeg: 55, kind: 'follow', offset: [20, 30, 10] };
const edit = (): ShotSequence => ({
  clips: [
    { end: 4, start: 0, view: structuredClone(fixed) },
    { end: 10, start: 4, view: structuredClone(follow) },
  ],
  kind: 'sequence',
});

describe('mixed camera timeline', () => {
  it('cuts exactly at capture time and holds the last camera for the visual tail', () => {
    const sequence = edit();
    expect(programShotAt(sequence, -1).kind).toBe('fixed');
    expect(programShotAt(sequence, 3.999999).kind).toBe('fixed');
    expect(programShotAt(sequence, 4).kind).toBe('follow');
    expect(programShotAt(sequence, 14).kind).toBe('follow');
    expect(programShotAt(fixed, 4)).toBe(fixed);
  });
  it('rejects gaps, overlaps, nested programs, empty edits, and range mismatches', () => {
    expect(validShotSequence(edit(), 10, { end: 10, start: 0 })).toBe(true);
    for (const start of [3, 5, NaN]) {
      const sequence = edit();
      sequence.clips[1].start = start;
      expect(validShotSequence(sequence, 10)).toBe(false);
    }
    expect(validShotSequence(edit(), 9)).toBe(false);
    expect(validShotSequence(edit(), 10, { end: 10, start: 1 })).toBe(false);
    expect(validShotSequence({ clips: [], kind: 'sequence' }, 10)).toBe(false);
    const sequence = edit();
    sequence.clips[0].view = edit() as unknown as ShotView;
    expect(validShotProgram(sequence, 10)).toBe(false);
    expect(validShotProgram(null, 10)).toBe(false);
    expect(validShotProgram({ ...fixed, fovYDeg: NaN }, 10)).toBe(false);
  });
  it('preserves overlapping cameras on A/B changes and extends only edge clips', () => {
    const sequence = edit();
    const crop = resizeShotSequence(sequence, { end: 8, start: 2 });
    expect(crop.clips.map(({ end, start }) => [start, end])).toEqual([
      [2, 4],
      [4, 8],
    ]);
    expect(crop.clips[0].view).toEqual(fixed);
    expect(crop.clips[0].view).not.toBe(sequence.clips[0].view);
    expect(resizeShotSequence(crop, { end: 10, start: 0 })).toEqual(sequence);
    expect(resizeShotSequence(sequence, { end: 7, start: 5 }).clips).toEqual([{ end: 7, start: 5, view: follow }]);
    expect(resizeShotSequence(sequence, { end: 12, start: 11 }).clips).toEqual([{ end: 12, start: 11, view: follow }]);
  });
  it('creates numbered diagram positions at each mixed clip representative time', () => {
    const track = parseFlightCsv(
      'local_timestamp,model,health,x,y,z,capture_elapsed_s\n2026-10-04T00:00:00.000,520,1000,0,0,100,0\n2026-10-04T00:00:10.000,520,1000,500,0,100,10',
      'test.csv',
    );
    const segments = buildDiagramSegments(edit(), track);
    expect(segments.map(({ kind, seconds }) => [kind, seconds])).toEqual([
      ['fixed', 2],
      ['follow', 7],
    ]);
    expect(segments[0].state.eye).toEqual(fixed.position);
    expect(segments[1].path[0]).toEqual([200, 100, -0]);
  });
});
