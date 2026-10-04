/**
 * Changing which surface draws the world, with everything above it intact (201/6-03).
 *
 * The console has three ways to draw the same world and the operator picks — *"not a quality ladder and not
 * a degradation path"*. What makes that possible is the shape the console already has: **the camera, the
 * board and the clock live OUTSIDE the mode.** A surface is only what is under them.
 *
 * So a switch is three moves in a fixed order, and the order is the whole of it:
 *
 * 1. **read the pose** off the surface that is leaving — before anything is torn down, because a disposed
 *    camera answers with nothing and the operator would land wherever the new mode opens;
 * 2. **dispose** it, and only then boot the next one. Two live surfaces would mean two WebGPU devices and two
 *    streaming workers on a phone with a 300–500 MB ceiling, for as long as the boot takes;
 * 3. **apply the pose** to what came up.
 *
 * The selection and the moment need no carrying at all, and that is the point rather than an omission: they
 * are `useOperations`' state, read through getters this file never sees. A switch has no channel through
 * which it could reset them — the only things it hands the boot are the mode and a pose.
 *
 * **The mode that comes up is not always the one asked for.** A device with no WebGPU cannot carry the live
 * render, and the honest answer is the one `plan-mode` already practises: come up in something that works and
 * SAY WHY. The boot function owns that decision (it is the one that knows how the failure looked); this file
 * reports whichever mode actually arrived, with its reason, so the chrome shows a banner rather than
 * pretending the operator got what they clicked.
 */
import type { MapPose } from '../map/map-camera';

/** What a boot hands back: the surface, the mode it really is, and why when those differ. */
export interface BootedMode {
  readonly mode: MapMode;
  readonly surface: ModeSurface;
  readonly why: string;
}

/** Which surface draws the world. The baked 3D city map (201/6-01) joins this when its build exists. */
export type MapMode = 'flat' | 'live';

/** What actually came up, and what it cost. */
export interface ModeReport {
  /** The mode now drawing — not necessarily the one asked for. */
  readonly mode: MapMode;
  /** Wall time from the request to a surface being ready, ms. */
  readonly ms: number;
  /** Whether the operator's request was granted. */
  readonly requested: MapMode;
  /** Why this is not what was asked for. Empty when it is. */
  readonly why: string;
}

/** What a booted surface must offer a switch. `DispatchHandle` satisfies it; a test does not need one. */
export interface ModeSurface {
  readonly camera: {
    applyPose(pose: MapPose): void;
    pose(): MapPose;
  };
  dispose(): void;
}

export class ModeSwitch {
  /** The surface drawing right now, or null before the first open. */
  get surface(): ModeSurface | null {
    return this.live?.surface ?? null;
  }
  private live: null | { mode: MapMode; surface: ModeSurface } = null;
  private pending = false;

  /**
   * @param boot start one mode. It receives the pose to open at (null on the first open) and owns the
   *   fallback decision — returning a DIFFERENT mode with a reason is a valid answer, not an error.
   * @param onChange called once per completed switch, with what came up and what it cost.
   */
  constructor(
    private readonly boot: (mode: MapMode, pose: MapPose | null) => Promise<BootedMode>,
    private readonly onChange: (report: ModeReport) => void,
  ) {}

  /** The mode drawing right now, or null before the first open. */
  current(): MapMode | null {
    return this.live?.mode ?? null;
  }

  /** Tear the surface down for good — the host unmounting, not a switch. */
  dispose(): void {
    this.live?.surface.dispose();
    this.live = null;
  }

  /**
   * Bring `mode` up, carrying the view across. A second request while one is in flight is IGNORED rather
   * than queued: the button is 44 px of touch target and a double tap must not boot two engines.
   */
  async to(mode: MapMode): Promise<ModeReport | null> {
    if (this.pending || this.live?.mode === mode) {
      return null;
    }
    this.pending = true;
    const started = performance.now();
    try {
      // Read, then destroy, then boot: a pose taken off a disposed camera is nothing, and two live surfaces
      // at once is two GPU devices on a device that was budgeted for one.
      const pose = this.live?.surface.camera.pose() ?? null;
      this.live?.surface.dispose();
      this.live = null;
      const booted = await this.boot(mode, pose);
      if (pose) {
        booted.surface.camera.applyPose(pose);
      }
      this.live = { mode: booted.mode, surface: booted.surface };
      const report = { mode: booted.mode, ms: performance.now() - started, requested: mode, why: booted.why };
      this.onChange(report);

      return report;
    } finally {
      this.pending = false;
    }
  }
}
