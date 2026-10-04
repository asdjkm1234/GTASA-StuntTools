import { describe, expect, it, vi } from 'vitest';

import type { MapPose } from '../map/map-camera';
import type { BootedMode, MapMode, ModeReport, ModeSurface } from './mode-switch';

import { MAP_YAW } from '../map/map-camera';
import { ModeSwitch } from './mode-switch';

/** Nothing to do with a report in a test that is not asserting on one. */
const noop = (): void => undefined;

const POSE = (height: number): MapPose => ({
  at: [1481, -1770],
  height,
  pitch: -1.2,
  projection: 'perspective',
  yaw: MAP_YAW,
});

/** A surface that records what was done to it, in order. */
function surface(pose = POSE(900)): { applied: MapPose[]; log: string[]; surface: ModeSurface } {
  const applied: MapPose[] = [];
  const log: string[] = [];

  return {
    applied,
    log,
    surface: {
      camera: {
        applyPose: (next): void => {
          applied.push(next);
          log.push('applyPose');
        },
        pose: (): MapPose => {
          log.push('pose');

          return pose;
        },
      },
      dispose: (): void => void log.push('dispose'),
    },
  };
}

describe('ModeSwitch', () => {
  describe('negative cases', () => {
    it('does nothing when the mode asked for is already the one drawing', async () => {
      const boot = vi.fn(
        (mode: MapMode): Promise<BootedMode> => Promise.resolve({ mode, surface: surface().surface, why: '' }),
      );
      const live = new ModeSwitch(boot, noop);
      await live.to('live');

      expect(await live.to('live')).toBeNull();
      expect(boot).toHaveBeenCalledTimes(1);
    });

    it('ignores a second request while one is in flight — a double tap must not boot two engines', async () => {
      let release: () => void = noop;
      const boot = vi.fn(async (mode: MapMode): Promise<BootedMode> => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });

        return { mode, surface: surface().surface, why: '' };
      });
      const live = new ModeSwitch(boot, noop);
      const first = live.to('flat');
      const second = live.to('live');
      release();
      await first;

      expect(await second).toBeNull();
      expect(boot).toHaveBeenCalledTimes(1);
    });

    it('carries no pose into the FIRST open — there is no view to keep yet', async () => {
      const opened = surface();
      const boot = vi.fn(
        (mode: MapMode): Promise<BootedMode> => Promise.resolve({ mode, surface: opened.surface, why: '' }),
      );
      const live = new ModeSwitch(boot, noop);
      await live.to('live');

      expect(boot).toHaveBeenCalledWith('live', null);
      expect(opened.applied).toEqual([]);
    });

    it('never reads a pose off a surface it has already disposed', async () => {
      const first = surface();
      const second = surface();
      const boot = vi.fn(
        (mode: MapMode): Promise<BootedMode> =>
          Promise.resolve({ mode, surface: mode === 'live' ? first.surface : second.surface, why: '' }),
      );
      const live = new ModeSwitch(boot, noop);
      await live.to('live');
      await live.to('flat');

      // The order IS the rule: a pose read after dispose is nothing, and the operator lands wherever the
      // next mode happens to open.
      expect(first.log).toEqual(['pose', 'dispose']);
    });
  });

  describe('positive cases', () => {
    it('carries the camera pose from the surface leaving to the one arriving', async () => {
      const first = surface(POSE(1234));
      const second = surface();
      const boot = (mode: MapMode): Promise<BootedMode> =>
        Promise.resolve({ mode, surface: mode === 'live' ? first.surface : second.surface, why: '' });
      const live = new ModeSwitch(boot, noop);
      await live.to('live');
      await live.to('flat');

      expect(second.applied).toEqual([POSE(1234)]);
    });

    it('disposes the outgoing surface exactly once, before the next one is booted', async () => {
      const first = surface();
      const order: string[] = [];
      const boot = (mode: MapMode): Promise<BootedMode> => {
        order.push(`boot:${mode}`);

        return Promise.resolve({ mode, surface: mode === 'live' ? first.surface : surface().surface, why: '' });
      };
      const live = new ModeSwitch((mode, pose) => {
        order.push(pose ? 'with-pose' : 'no-pose');

        return boot(mode);
      }, noop);
      await live.to('live');
      first.log.push('|');
      await live.to('flat');

      expect(first.log.filter((entry) => entry === 'dispose')).toHaveLength(1);
      expect(order).toEqual(['no-pose', 'boot:live', 'with-pose', 'boot:flat']);
    });

    it('reports the mode that actually came up, and why it is not the one asked for', async () => {
      const reports: ModeReport[] = [];
      const live = new ModeSwitch(
        () => Promise.resolve({ mode: 'flat' as const, surface: surface().surface, why: 'this browser has no WebGPU' }),
        (report) => void reports.push(report),
      );
      await live.to('live');

      expect(reports[0]).toMatchObject({ mode: 'flat', requested: 'live', why: 'this browser has no WebGPU' });
      expect(live.current()).toBe('flat');
    });

    it('measures what the switch cost, so a field run can report it', async () => {
      const reports: ModeReport[] = [];
      const live = new ModeSwitch(
        (mode) => Promise.resolve({ mode, surface: surface().surface, why: '' }),
        (report) => void reports.push(report),
      );
      await live.to('live');
      await live.to('flat');

      expect(reports).toHaveLength(2);
      expect(reports[1].ms).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(reports[1].ms)).toBe(true);
    });

    it('hands the boot nothing but a mode and a pose — a switch cannot reach the board or the clock', async () => {
      // The structural half of "everything survives": the selection and the moment are `useOperations`'
      // state, read through getters this module never sees, so there is no channel through which a mode
      // change could reset them. A future argument added here is the regression this pins.
      const seen: unknown[][] = [];
      const live = new ModeSwitch((...args) => {
        seen.push(args);

        return Promise.resolve({ mode: args[0], surface: surface().surface, why: '' });
      }, noop);
      await live.to('live');
      await live.to('flat');

      expect(seen.every((args) => args.length === 2)).toBe(true);
    });

    it('lets go of the surface on dispose, so an unmount leaves nothing running', async () => {
      const only = surface();
      const live = new ModeSwitch((mode) => Promise.resolve({ mode, surface: only.surface, why: '' }), noop);
      await live.to('live');
      live.dispose();

      expect(only.log).toContain('dispose');
      expect(live.current()).toBeNull();
      expect(live.surface).toBeNull();
    });
  });
});
