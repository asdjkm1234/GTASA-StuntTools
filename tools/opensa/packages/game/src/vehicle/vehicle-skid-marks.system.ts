/**
 * Skid marks (plan 089/03): WHERE the driven car's tyres slide, turned into decal-ribbon SEGMENTS for the
 * engine's skid lane. The signal is the SAME equivalent slide speed the tyre smoke reads
 * ({@link equivalentSlideSpeed}) — the two effects may never disagree about whether a tyre slides.
 *
 * A ribbon grows point-to-point along a wheel's contact path: a segment is laid when the wheel has moved
 * far enough since the last one, its edges REUSE the previous segment's far edges (a curve stays seamless),
 * and the brief's look rules are applied here — the FIRST edge of a ribbon is fully transparent, the alpha
 * ramps in over the first few segments (a mark grows in instead of appearing as a stripe), and the laid
 * alpha follows the slide's severity (darker the harder). The 5-real-second fade is the ENGINE's job — the
 * shader runs it on the wall clock; this system never revisits a laid segment.
 *
 * The alpha/width numbers are an EYE-FIT like the smoke's (SA's mark parameters live in the same
 * unrecoverable CFx bodies) — recorded in `docs/hacks/skid-mark-look-fit.md`.
 */
import type { System } from '../core/system';
import type { TyreSmokeCar, TyreSmokePhysics } from './vehicle-tyre-smoke.system';

import { planarMotion } from './vehicle-telemetry';
import { equivalentSlideSpeed, TYRE_SMOKE_DEFAULTS } from './vehicle-tyre-smoke.system';

/** One laid quad, native GTA space (Z up), corners pre-lifted off the road. */
export interface SkidSegmentSample {
  /** Alpha at the older / newer edge — 0 on a ribbon's very first edge (the brief's transparent start). */
  alpha0: number;
  alpha1: number;
  left0: [number, number, number];
  left1: [number, number, number];
  right0: [number, number, number];
  right1: [number, number, number];
  /** Along-ribbon texture coordinate at each edge (metres over {@link TEX_METRES}). */
  v0: number;
  v1: number;
}

/** Mark darkness at the slide threshold → at a full slide (the darker-the-harder ramp's ends). */
const ALPHA_MIN = 0.25;
const ALPHA_SPAN = 0.6;

/** Half the mark's width (m) — a tyre's contact patch is ~0.24 m across on SA's cars. */
const HALF_WIDTH = 0.12;

/** Lay a segment only after the wheel moved this far (m) — shorter would spend the ring on micro-quads. */
const MIN_SEGMENT = 0.3;

/** A jump longer than this between contacts is a teleport or a flight, not a path — the ribbon restarts. */
const MAX_SEGMENT = 3;

/** Segments over which a fresh ribbon's alpha ramps from the transparent start to full. */
const RAMP_SEGMENTS = 3;

/** Metres of path per repeat of the particleskid texture. */
const TEX_METRES = 1;

/** Corners are lifted this far off the road (native Z) so the decal never z-fights the surface it lies on. */
const LIFT = 0.02;

/** More wheels than any SA vehicle carries. */
const MAX_WHEELS = 8;

/** One wheel's ribbon-in-progress. */
interface WheelRibbon {
  active: boolean;
  /** The last contact point a segment ended at (or the ribbon's start while no edges exist yet). */
  anchor: [number, number, number];
  hasEdges: boolean;
  lastAlpha: number;
  lastLeft: [number, number, number];
  lastRight: [number, number, number];
  lastV: number;
  segments: number;
}

const freshRibbon = (): WheelRibbon => ({
  active: false,
  anchor: [0, 0, 0],
  hasEdges: false,
  lastAlpha: 0,
  lastLeft: [0, 0, 0],
  lastRight: [0, 0, 0],
  lastV: 0,
  segments: 0,
});

export class VehicleSkidMarkSystem implements System {
  readonly name = 'vehicle-skid-marks';

  /** The car whose ribbons below are valid — a car change resets them. */
  private car: null | TyreSmokeCar = null;
  private readonly ribbons: WheelRibbon[] = Array.from({ length: MAX_WHEELS }, freshRibbon);

  constructor(
    private readonly driven: () => null | TyreSmokeCar,
    private readonly physics: TyreSmokePhysics,
    private readonly sink: (segment: SkidSegmentSample) => void,
    private readonly enabled: () => boolean,
  ) {}

  fixedUpdate(): void {
    const car = this.enabled() ? this.driven() : null;
    if (car !== this.car) {
      for (const ribbon of this.ribbons) {
        ribbon.active = false;
      }
      this.car = car;
    }
    if (car === null) {
      return;
    }
    const slips = this.physics.readVehicleWheelSlip(car.controller);
    if (slips === null) {
      return;
    }
    const wheels = this.physics.readVehicleWheels(car.controller);
    const motion = planarMotion(car.orientation, this.physics.getLinvel(car.body));
    const span = Math.max(0.001, TYRE_SMOKE_DEFAULTS.slideFull - TYRE_SMOKE_DEFAULTS.slideStart);
    for (let index = 0; index < Math.min(wheels.length, MAX_WHEELS); index += 1) {
      const ribbon = this.ribbons[index];
      const slide = wheels[index].contact ? equivalentSlideSpeed(slips[index], motion) : 0;
      const intensity = Math.min(1, Math.max(0, (slide - TYRE_SMOKE_DEFAULTS.slideStart) / span));
      const point = intensity > 0 ? this.physics.wheelContactPoint(car.controller, index) : null;
      if (point === null) {
        ribbon.active = false; // the slide ended (or the wheel left the ground) — the next mark grows anew
        continue;
      }
      this.extend(ribbon, point, intensity);
    }
  }

  /** Grow one wheel's ribbon toward a new contact point, laying a segment once it is far enough. */
  private extend(ribbon: WheelRibbon, point: [number, number, number], intensity: number): void {
    if (!ribbon.active) {
      ribbon.active = true;
      ribbon.anchor = point;
      ribbon.hasEdges = false;
      ribbon.segments = 0;

      return;
    }
    const dx = point[0] - ribbon.anchor[0];
    const dy = point[1] - ribbon.anchor[1];
    const distance = Math.hypot(dx, dy, point[2] - ribbon.anchor[2]);
    if (distance < MIN_SEGMENT) {
      return;
    }
    if (distance > MAX_SEGMENT) {
      ribbon.anchor = point; // a jump, not a path — restart in place
      ribbon.hasEdges = false;
      ribbon.segments = 0;

      return;
    }
    // The mark lies in the ground plane: the width axis is the planar perpendicular of the movement.
    const planar = Math.hypot(dx, dy) || 1;
    const px = (-dy / planar) * HALF_WIDTH;
    const py = (dx / planar) * HALF_WIDTH;
    if (!ribbon.hasEdges) {
      // The ribbon's very first edge pair sits at the anchor, fully TRANSPARENT — the brief's growing start.
      ribbon.lastLeft = [ribbon.anchor[0] - px, ribbon.anchor[1] - py, ribbon.anchor[2] + LIFT];
      ribbon.lastRight = [ribbon.anchor[0] + px, ribbon.anchor[1] + py, ribbon.anchor[2] + LIFT];
      ribbon.lastAlpha = 0;
      ribbon.lastV = 0;
      ribbon.hasEdges = true;
    }
    const ramp = Math.min(1, (ribbon.segments + 1) / RAMP_SEGMENTS);
    const alpha = (ALPHA_MIN + ALPHA_SPAN * intensity) * ramp;
    const left1: [number, number, number] = [point[0] - px, point[1] - py, point[2] + LIFT];
    const right1: [number, number, number] = [point[0] + px, point[1] + py, point[2] + LIFT];
    const v1 = ribbon.lastV + distance / TEX_METRES;
    this.sink({
      alpha0: ribbon.lastAlpha,
      alpha1: alpha,
      left0: ribbon.lastLeft,
      left1,
      right0: ribbon.lastRight,
      right1,
      v0: ribbon.lastV,
      v1,
    });
    ribbon.anchor = point;
    ribbon.lastAlpha = alpha;
    ribbon.lastLeft = left1;
    ribbon.lastRight = right1;
    ribbon.lastV = v1;
    ribbon.segments += 1;
  }
}
