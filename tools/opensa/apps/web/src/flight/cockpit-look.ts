/** A pilot-head camera driven by the existing mouse/keyboard free-camera input. */
import type { CameraStateOut } from './camera';
import type { FreeCamera } from './free-camera';
import type { Vec3 } from './math';

import { type CanopyPlane, constrainCanopyEye } from './aircraft-canopy';

export interface CockpitLookFrame {
  aspect: number;
  /** Base eye and closed canopy planes, both in aircraft-local coordinates. */
  canopy?: { anchor: Vec3; planes: readonly CanopyPlane[] };
  eye: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

export interface CockpitLookPose {
  height: number;
  lateral: number;
  longitudinal: number;
  pitch: number;
  yaw: number;
}

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
const POSITION_NUDGE_SCALE = 0.005;
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (value: Vec3): Vec3 => {
  const length = Math.hypot(...value) || 1;

  return [value[0] / length, value[1] / length, value[2] / length];
};
const angleStep = (before: number, after: number): number =>
  Math.atan2(Math.sin(after - before), Math.cos(after - before));

export class CockpitLookCamera {
  get pose(): CockpitLookPose {
    return { ...this.local };
  }

  private lastEye: null | Vec3 = null;
  private lastInputPitch: number;
  private lastInputYaw: number;
  private local: CockpitLookPose;

  constructor(
    private readonly inputCamera: FreeCamera,
    initial: Partial<CockpitLookPose> = {},
  ) {
    this.local = {
      height: initial.height ?? 0,
      lateral: initial.lateral ?? 0,
      longitudinal: initial.longitudinal ?? 0,
      pitch: initial.pitch ?? 0,
      yaw: initial.yaw ?? 0,
    };
    this.lastInputYaw = inputCamera.yaw;
    this.lastInputPitch = inputCamera.pitch;
  }

  state(frame: CockpitLookFrame): CameraStateOut {
    const { inputCamera } = this;
    this.local.yaw += angleStep(this.lastInputYaw, inputCamera.yaw);
    this.local.pitch = clamp(this.local.pitch + inputCamera.pitch - this.lastInputPitch, -1.45, 1.45);
    this.lastInputYaw = inputCamera.yaw;
    this.lastInputPitch = inputCamera.pitch;
    const lastEye = this.lastEye;
    if (lastEye) {
      const moved: Vec3 = inputCamera.position.map(
        (value, axis) => (value - lastEye[axis]) * POSITION_NUDGE_SCALE,
      ) as Vec3;
      // FreeCameraInput moves in world X/Z using its own yaw. Recover that input first: projecting
      // the world displacement onto aircraft axes made W move backward for some plane headings.
      const inputYaw = inputCamera.yaw;
      const inputForward = moved[0] * Math.sin(inputYaw) - moved[2] * Math.cos(inputYaw);
      const inputRight = moved[0] * Math.cos(inputYaw) + moved[2] * Math.sin(inputYaw);
      this.local.lateral = clamp(
        this.local.lateral + inputForward * Math.sin(this.local.yaw) + inputRight * Math.cos(this.local.yaw),
        -0.1,
        0.1,
      );
      this.local.longitudinal = clamp(
        this.local.longitudinal + inputForward * Math.cos(this.local.yaw) - inputRight * Math.sin(this.local.yaw),
        -0.08,
        0.12,
      );
      this.local.height = clamp(this.local.height + moved[1], -0.08, 0.08);
    }

    const yaw = this.local.yaw;
    const pitch = this.local.pitch;
    const rear = clamp((-Math.cos(yaw) - 0.1) / 0.8, 0, 1);
    let lean = 0.55 * rear * rear * (3 - 2 * rear);
    // A world/free camera's 0.5 m clip plane slices this canopy only ~0.2 m above the pilot.
    const near = 0.03;
    const fovYRad = (inputCamera.fovYDeg * Math.PI) / 180;
    const clearance = near * Math.sqrt(1 + Math.tan(fovYRad / 2) ** 2 * (1 + frame.aspect ** 2)) + 0.01;
    if (frame.canopy) {
      const { anchor, planes } = frame.canopy;
      // Clamp the automatic lean before adding the user's movement, so W can immediately move back
      // from the roof instead of first consuming an invisible, already-clipped part of the lean.
      lean = constrainCanopyEye(planes, anchor, [anchor[0], anchor[1] + lean, anchor[2]], clearance)[1] - anchor[1];
    }
    let offset: Vec3 = [this.local.lateral, this.local.longitudinal + lean, this.local.height];
    if (frame.canopy) {
      const { anchor, planes } = frame.canopy;
      const bounded = constrainCanopyEye(
        planes,
        anchor,
        anchor.map((value, axis) => value + offset[axis]) as Vec3,
        clearance,
      );
      offset = bounded.map((value, axis) => value - anchor[axis]) as Vec3;
    }
    const eye: Vec3 = [0, 1, 2].map(
      (axis) =>
        frame.eye[axis] + frame.right[axis] * offset[0] + frame.forward[axis] * offset[1] + frame.up[axis] * offset[2],
    ) as Vec3;
    const direction: Vec3 = normalize(
      [0, 1, 2].map(
        (axis) =>
          Math.cos(pitch) * (frame.forward[axis] * Math.cos(yaw) + frame.right[axis] * Math.sin(yaw)) +
          frame.up[axis] * Math.sin(pitch),
      ) as Vec3,
    );
    const viewRight: Vec3 = normalize(
      [0, 1, 2].map((axis) => frame.right[axis] * Math.cos(yaw) - frame.forward[axis] * Math.sin(yaw)) as Vec3,
    );
    this.lastEye = eye;
    inputCamera.position = [...eye];

    return {
      aspect: frame.aspect,
      eye,
      far: inputCamera.far,
      fovYRad,
      near,
      target: eye.map((value, axis) => value + direction[axis] * 85) as Vec3,
      up: normalize(cross(viewRight, direction)),
    };
  }
}
