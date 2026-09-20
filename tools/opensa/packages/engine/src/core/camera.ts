/**
 * The projection a {@link CameraState} means — ONE owner (plan 201/1-05).
 *
 * The renderer and the streamer have to agree about what the camera sees: the streamer decides residency
 * from the frustum the renderer will cull with, one frame early. Two copies of "perspective unless
 * `orthoHalfHeight`, near/far swapped for reversed-Z" would typecheck, lint and pass every test while
 * disagreeing — and the symptom is a cell the frame draws and the streamer never asked for, which reads as
 * a hole in the world rather than as a convention drift.
 */
import type { CameraState } from '../engine';

import { type Mat4, mat4OrthographicZO, mat4PerspectiveZO } from './math';

/**
 * Write the camera's projection matrix. Near/far are passed SWAPPED — that is the reversed-Z projection the
 * renderer runs (near maps to depth 1, far to 0) — and `orthoHalfHeight` picks the plan view (201/7-01).
 */
export function cameraProjection(out: Mat4, camera: CameraState): Mat4 {
  return camera.orthoHalfHeight === undefined
    ? mat4PerspectiveZO(out, camera.fovYRad, camera.aspect, camera.far, camera.near)
    : mat4OrthographicZO(out, camera.orthoHalfHeight, camera.aspect, camera.far, camera.near);
}
