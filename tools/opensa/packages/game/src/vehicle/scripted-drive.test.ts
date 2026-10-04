import { describe, expect, it } from 'vitest';

import { type DriveKeyframe, ScriptedDriveSource } from './scripted-drive';

const DT = 1 / 60;

/** Run the clock forward `seconds`, one fixed step at a time (the way the host drives it). */
const run = (source: ScriptedDriveSource, seconds: number): void => {
  for (let step = 0; step < Math.round(seconds / DT); step += 1) {
    source.advance(DT);
  }
};

const TIMELINE: readonly DriveKeyframe[] = [
  { move: { x: 0, y: 1 }, t: 0 },
  { actions: ['jump'], move: { x: -1, y: 0 }, t: 2 },
  { move: { x: 0, y: 0 }, t: 4 },
];

describe('ScriptedDriveSource', () => {
  describe('negative cases', () => {
    it('contributes nothing at all with no timeline — an idle source must be invisible in CombinedInput', () => {
      const source = new ScriptedDriveSource();
      run(source, 5);

      expect(source.move()).toEqual({ x: 0, y: 0 });
      expect(source.isActive('jump')).toBe(false);
      expect(source.time).toBe(0); // an empty timeline has no clock to run
    });

    it('holds neutral before the first keyframe is due', () => {
      const source = new ScriptedDriveSource([{ move: { x: 1, y: 1 }, t: 3 }]);
      run(source, 1);

      expect(source.move()).toEqual({ x: 0, y: 0 });
    });

    it('reports no look or zoom — a scripted drive never moves the camera', () => {
      const source = new ScriptedDriveSource(TIMELINE);
      run(source, 1);

      expect(source.consumeLook()).toEqual({ x: 0, y: 0 });
      expect(source.consumeZoom()).toBe(0);
    });

    it('goes quiet on stop, mid-timeline', () => {
      const source = new ScriptedDriveSource(TIMELINE);
      run(source, 2.5);
      source.stop();

      expect(source.move()).toEqual({ x: 0, y: 0 });
      expect(source.isActive('jump')).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('holds each keyframe until the next one is due', () => {
      const source = new ScriptedDriveSource(TIMELINE);

      run(source, 1);
      expect(source.move()).toEqual({ x: 0, y: 1 });

      run(source, 2); // t = 3 s
      expect(source.move()).toEqual({ x: -1, y: 0 });

      run(source, 2); // t = 5 s
      expect(source.move()).toEqual({ x: 0, y: 0 });
    });

    it('holds the actions of the keyframe in force, and only those', () => {
      const source = new ScriptedDriveSource(TIMELINE);

      run(source, 1);
      expect(source.isActive('jump')).toBe(false);

      run(source, 2); // t = 3 s — the braking keyframe
      expect(source.isActive('jump')).toBe(true);
      expect(source.isActive('enterExit')).toBe(false);

      run(source, 2); // t = 5 s — released again
      expect(source.isActive('jump')).toBe(false);
    });

    it('replays identically after play() restarts the clock — the whole point of a scripted lap', () => {
      const source = new ScriptedDriveSource();
      const sampleAt = (seconds: number): { brake: boolean; steer: number } => {
        source.play(TIMELINE);
        run(source, seconds);

        return { brake: source.isActive('jump'), steer: source.move().x };
      };

      expect(sampleAt(3)).toEqual(sampleAt(3));
      expect(sampleAt(3)).toEqual({ brake: true, steer: -1 });
    });

    it('runs its clock off the step it is given, not wall time', () => {
      const source = new ScriptedDriveSource(TIMELINE);
      source.advance(1.5);
      source.advance(1.5);

      expect(source.time).toBeCloseTo(3, 12);
      expect(source.move()).toEqual({ x: -1, y: 0 });
    });
  });
});
