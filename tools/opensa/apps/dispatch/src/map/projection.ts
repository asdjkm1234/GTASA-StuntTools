/**
 * World → screen, so the 2D symbology layer can draw callsigns, call chips and leader lines over the 3D map.
 *
 * This is the whole answer to "the engine has no text": the labels are not in the scene at all. They are drawn
 * on a plain 2D canvas stacked over the WebGPU one, positioned by projecting the world point with the SAME
 * view-projection the frame was rendered with. Nothing in the renderer has to know they exist.
 */
import type { CameraState, Mat4 } from '@opensa/engine';

import { mat4Identity, mat4LookAt, mat4Multiply, mat4OrthographicZO, mat4PerspectiveZO } from '@opensa/engine';

import type { EnginePoint } from './coords';

/** A projected point, in CSS pixels of the overlay canvas. */
export interface ScreenPoint {
  /** Distance ahead of the eye along the view axis. Used to fade and to sort labels front-to-back. */
  readonly depth: number;
  readonly x: number;
  readonly y: number;
}

export class ScreenProjector {
  private height = 1;
  private readonly proj: Mat4 = mat4Identity();
  private readonly view: Mat4 = mat4Identity();
  private readonly viewProj: Mat4 = mat4Identity();
  private width = 1;

  /**
   * Where a world point lands on screen, or null when it is behind the eye.
   *
   * "Behind" is read off the VIEW matrix, not off clip w. Under perspective the two are the same number
   * (`w = −z_view`), but an orthographic projection carries `w = 1` for every point in the world — including
   * the ones behind the operator — so a w test would put a unit's callsign on screen while the unit itself
   * is nowhere in the picture. Silent by construction: the label looks like any other label.
   */
  project(world: EnginePoint): null | ScreenPoint {
    const m = this.viewProj;
    const v = this.view;
    const [x, y, z] = world;
    const depth = -(v[2] * x + v[6] * y + v[10] * z + v[14]);
    if (depth <= 0.0001) {
      return null;
    }
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    const clipX = m[0] * x + m[4] * y + m[8] * z + m[12];
    const clipY = m[1] * x + m[5] * y + m[9] * z + m[13];

    return {
      depth,
      x: ((clipX / w) * 0.5 + 0.5) * this.width,
      y: (0.5 - (clipY / w) * 0.5) * this.height,
    };
  }

  /** Rebuild from the camera the frame is about to be drawn with, and the overlay's CSS size. */
  update(camera: CameraState, width: number, height: number): void {
    this.width = width;
    this.height = height;
    mat4LookAt(this.view, camera.eye, camera.target, camera.up);
    if (camera.orthoHalfHeight === undefined) {
      mat4PerspectiveZO(this.proj, camera.fovYRad, camera.aspect, camera.near, camera.far);
    } else {
      mat4OrthographicZO(this.proj, camera.orthoHalfHeight, camera.aspect, camera.near, camera.far);
    }
    mat4Multiply(this.viewProj, this.proj, this.view);
  }
}
