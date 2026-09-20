import type { CameraState } from '@opensa/engine';

/**
 * The viewer orbit rig — drag to look, wheel to zoom, always aimed at one focus point.
 *
 * Lifted from the engine-lab's inline camera (`apps/engine-lab/src/main.ts`), which was a set of local
 * `let`s inside `main()` and could not be reused. This is the same math with a reusable shape; the lab
 * can adopt it later.
 */

export interface OrbitRig {
  /** Re-aim and re-fit after the loaded model changed. */
  frame(focus: readonly [number, number, number], radius: number): void;
  state(aspect: number): CameraState;
}

const MIN_ZOOM = 0.08;
const MAX_ZOOM = 20;

export function createOrbitRig(canvas: HTMLCanvasElement): OrbitRig {
  let focus: [number, number, number] = [0, 0, 0];
  let baseRadius = 10;
  let azimuth = Math.PI / 4;
  // Slightly above the horizon: a dead-on side view hides whether a model has a roof.
  let elevation = 0.9;
  let zoom = 1;
  let dragging = false;

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * (event.deltaY > 0 ? 1.1 : 1 / 1.1)));
  });
  canvas.addEventListener('pointerdown', (event) => {
    dragging = true;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointerup', (event) => {
    dragging = false;
    canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) {
      return;
    }
    azimuth -= event.movementX * 0.006;
    elevation = Math.min(4, Math.max(0.05, elevation + event.movementY * 0.006));
  });

  return {
    frame(nextFocus, radius): void {
      focus = [nextFocus[0], nextFocus[1], nextFocus[2]];
      baseRadius = Math.max(0.5, radius);
      zoom = 1;
    },
    state(aspect): CameraState {
      const radius = baseRadius * zoom;

      return {
        aspect,
        eye: [
          focus[0] + Math.cos(azimuth) * radius,
          focus[1] + radius * elevation * 0.45,
          focus[2] + Math.sin(azimuth) * radius,
        ],
        far: 100_000,
        fovYRad: Math.PI / 3,
        // Asset viewing goes right up to the surface; the game's 0.5 near plane clips into big models.
        near: 0.05,
        target: focus,
        up: [0, 1, 0],
      };
    },
  };
}
