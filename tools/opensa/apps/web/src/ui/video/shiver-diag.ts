/**
 * The full-rate camera diagnostic behind `?video=1&diag=1` — what a "the camera shivers" field report needs
 * before anything is tuned.
 *
 * The scene report's series is 10 Hz, which judges a LINE; a shiver is a per-FRAME thing and is invisible at
 * that rate. This records one row per rendered frame and prints it as its own `[diag]` line, so the analysis
 * can ask the only question that separates the candidates: WHICH channel carries the high-frequency energy —
 * the car as it is drawn, the mount the shot hangs off, or the eye the director damped.
 *
 * It records both headings on purpose: `heading` is the fixed-step gameplay yaw the shot's mount is built on,
 * `renderYaw` the interpolated one the car is DRAWN with. If those two disagree by a sawtooth, the mount is
 * riding a staircase while its subject glides — and that difference is the measurement, not a theory.
 */

export interface ShiverDiag {
  /** One `[diag] {json}` line for the scene, or nothing when the flag is off or the scene drew no frames. */
  dump(scene: number): void;
  /** True when the flag is on — the caller skips building rows otherwise. */
  readonly enabled: boolean;
  record(row: ShiverRow): void;
}

/** One rendered frame, flat and short — a scene is thousands of these and they travel as one console line. */
interface ShiverRow {
  /** The car as it is DRAWN this frame (engine Y-up) — the subject every other channel is judged against. */
  car: readonly [number, number, number];
  /** This frame is a DECLARED discontinuity. The analysis SPLITS on it: a continuity measure taken across a
   *  cut is measuring the cut (`docs/restrictions/architecture.md`), and the same shot can play twice in one
   *  scene, so the shot NAME is not a segment boundary. */
  cut: boolean;
  eye: readonly [number, number, number];
  /** Fixed-step gameplay yaw (GTA rad) — what {@link shotEye} mounts the camera on. */
  heading: number;
  /** Interpolated yaw the car is DRAWN with (GTA rad). */
  renderYaw: number;
  screen: readonly [number, number];
  shot: string;
  /** ms since the scene's first recorded frame. */
  t: number;
  target: readonly [number, number, number];
}

/** Rows kept per scene — a 25 s fragment at 120 fps fits with room to spare, and the cap bounds the line. */
const MAX_ROWS = 4000;

export function createShiverDiag(enabled: boolean): ShiverDiag {
  const rows: ShiverRow[] = [];

  return {
    dump: (scene: number): void => {
      if (!enabled || rows.length === 0) {
        return;
      }
      const round = (value: number, places = 4): number => Number(value.toFixed(places));
      const capture = {
        columns: [
          't',
          'shot',
          'cut',
          'heading',
          'renderYaw',
          'carX',
          'carY',
          'carZ',
          'eyeX',
          'eyeY',
          'eyeZ',
          'tgtX',
          'tgtY',
          'tgtZ',
          'sx',
          'sy',
        ],
        rows: rows.map((row) => [
          round(row.t, 2),
          row.shot,
          row.cut ? 1 : 0,
          round(row.heading, 6),
          round(row.renderYaw, 6),
          round(row.car[0], 4),
          round(row.car[1], 4),
          round(row.car[2], 4),
          round(row.eye[0], 4),
          round(row.eye[1], 4),
          round(row.eye[2], 4),
          round(row.target[0], 4),
          round(row.target[1], 4),
          round(row.target[2], 4),
          round(row.screen[0], 5),
          round(row.screen[1], 5),
        ]),
        scene,
      };
      // eslint-disable-next-line no-console -- the diagnostic deliverable IS this line (the [video] twin)
      console.log('[diag]', JSON.stringify(capture));
      rows.length = 0;
    },
    enabled,
    record: (row: ShiverRow): void => {
      if (enabled && rows.length < MAX_ROWS) {
        rows.push(row);
      }
    },
  };
}

/** GTA yaw from a body quaternion: the model's +Y forward rotated, then the game's own heading convention. */
export function yawOfQuat(q: readonly [number, number, number, number]): number {
  const [x, y, z, w] = q;
  const forwardX = 2 * (x * y - w * z);
  const forwardY = 1 - 2 * (x * x + z * z);

  return Math.atan2(-forwardX, forwardY);
}
