/**
 * Replay-time-independent free camera for the flight analysis surface.
 *
 * The camera owns its own pose (position + yaw/pitch + focus distance) and never reads the replay clock, so
 * it keeps working while playback is paused, scrubbed or running. It returns the engine's `CameraStateOut`
 * unchanged, which is all `engine.frame()` needs.
 *
 * `FreeCameraInput` is an optional, opt-in pointer/keyboard controller: the parent attaches it to a DOM
 * element only when the free camera is active, so normal replay input stays untouched.
 */
import type { CameraStateOut } from './camera';
import type { Vec3 } from './math';

const WORLD_UP: Vec3 = [0, 1, 0];
const PITCH_LIMIT = 1.5533431;
const DEFAULT_FOCUS_DISTANCE = 60;

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

function normalize(value: Vec3): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2]);

  return length > 1e-6 ? [value[0] / length, value[1] / length, value[2] / length] : [0, 0, 0];
}

export interface FreeCameraPose {
  position: Vec3;
  yaw: number;
  pitch: number;
  fovYDeg: number;
  near: number;
  far: number;
}

export interface FreeCameraOptions {
  position?: Vec3;
  yaw?: number;
  pitch?: number;
  fovYDeg?: number;
  near?: number;
  far?: number;
  focusDistance?: number;
}

export interface FreeCameraFocusOptions {
  distance?: number;
  yaw?: number;
  pitch?: number;
  /** When false, the camera only turns to face the target and does not move. Defaults to true. */
  move?: boolean;
}

export class FreeCamera {
  position: Vec3;
  yaw: number;
  pitch: number;
  fovYDeg: number;
  near: number;
  far: number;
  focusDistance: number;

  constructor(options: FreeCameraOptions = {}) {
    this.position = options.position ? [...options.position] : [0, 50, 0];
    this.yaw = options.yaw ?? 0;
    this.pitch = clamp(options.pitch ?? -0.35, -PITCH_LIMIT, PITCH_LIMIT);
    this.fovYDeg = options.fovYDeg ?? 60;
    this.near = options.near ?? 0.5;
    this.far = options.far ?? 12000;
    this.focusDistance = options.focusDistance ?? DEFAULT_FOCUS_DISTANCE;
  }

  get pose(): FreeCameraPose {
    return {
      position: [...this.position],
      yaw: this.yaw,
      pitch: this.pitch,
      fovYDeg: this.fovYDeg,
      near: this.near,
      far: this.far,
    };
  }

  setPose(pose: Partial<FreeCameraPose>): void {
    if (pose.position) {
      this.position = [...pose.position];
    }
    if (pose.yaw !== undefined) {
      this.yaw = pose.yaw;
    }
    if (pose.pitch !== undefined) {
      this.pitch = clamp(pose.pitch, -PITCH_LIMIT, PITCH_LIMIT);
    }
    if (pose.fovYDeg !== undefined) {
      this.fovYDeg = pose.fovYDeg;
    }
    if (pose.near !== undefined) {
      this.near = pose.near;
    }
    if (pose.far !== undefined) {
      this.far = pose.far;
    }
  }

  forward(): Vec3 {
    const cosPitch = Math.cos(this.pitch);

    return [Math.sin(this.yaw) * cosPitch, Math.sin(this.pitch), -Math.cos(this.yaw) * cosPitch];
  }

  right(): Vec3 {
    return [Math.cos(this.yaw), 0, Math.sin(this.yaw)];
  }

  up(): Vec3 {
    const right = this.right();
    const forward = this.forward();

    return normalize([
      right[1] * forward[2] - right[2] * forward[1],
      right[2] * forward[0] - right[0] * forward[2],
      right[0] * forward[1] - right[1] * forward[0],
    ]);
  }

  /** The point the camera is looking at, at the current focus distance. */
  target(): Vec3 {
    const forward = this.forward();

    return [
      this.position[0] + forward[0] * this.focusDistance,
      this.position[1] + forward[1] * this.focusDistance,
      this.position[2] + forward[2] * this.focusDistance,
    ];
  }

  /** Move along world axes. */
  moveBy(offset: Vec3): void {
    this.position = [
      this.position[0] + offset[0],
      this.position[1] + offset[1],
      this.position[2] + offset[2],
    ];
  }

  /** Move along the camera's own forward/right/up axes. */
  moveLocal(forwardOffset: number, rightOffset: number, upOffset: number): void {
    const forward = this.forward();
    const right = this.right();
    const up = this.up();
    this.moveBy([
      forward[0] * forwardOffset + right[0] * rightOffset + up[0] * upOffset,
      forward[1] * forwardOffset + right[1] * rightOffset + up[1] * upOffset,
      forward[2] * forwardOffset + right[2] * rightOffset + up[2] * upOffset,
    ]);
  }

  rotateBy(yawDelta: number, pitchDelta: number): void {
    this.yaw += yawDelta;
    this.pitch = clamp(this.pitch + pitchDelta, -PITCH_LIMIT, PITCH_LIMIT);
  }

  /** Aim at a world point without moving. Leaves the focus distance untouched. */
  lookAt(target: Vec3): void {
    const dx = target[0] - this.position[0];
    const dy = target[1] - this.position[1];
    const dz = target[2] - this.position[2];
    const horizontal = Math.hypot(dx, dz);
    if (horizontal < 1e-6 && Math.abs(dy) < 1e-6) {
      return;
    }
    this.yaw = Math.atan2(dx, -dz);
    this.pitch = clamp(Math.atan2(dy, horizontal), -PITCH_LIMIT, PITCH_LIMIT);
  }

  /** Turn to (and by default reposition around) a world point — the endpoint-focus entry point. */
  focus(target: Vec3, options: FreeCameraFocusOptions = {}): void {
    const move = options.move ?? true;
    if (move) {
      if (options.yaw !== undefined) {
        this.yaw = options.yaw;
      }
      if (options.pitch !== undefined) {
        this.pitch = clamp(options.pitch, -PITCH_LIMIT, PITCH_LIMIT);
      }
      if (options.distance !== undefined) {
        this.focusDistance = Math.max(1, options.distance);
      }
      const forward = this.forward();
      this.position = [
        target[0] - forward[0] * this.focusDistance,
        target[1] - forward[1] * this.focusDistance,
        target[2] - forward[2] * this.focusDistance,
      ];
    } else {
      this.lookAt(target);
      if (options.distance !== undefined) {
        this.focusDistance = Math.max(1, options.distance);
      }
    }
  }

  /** Camera state for `engine.frame()`; `aspect` is the canvas width/height. */
  state(aspect: number): CameraStateOut {
    return {
      aspect,
      eye: [...this.position],
      far: this.far,
      fovYRad: (this.fovYDeg * Math.PI) / 180,
      near: this.near,
      target: this.target(),
      up: this.up(),
    };
  }

  reset(options: FreeCameraOptions = {}): void {
    this.position = options.position ? [...options.position] : [0, 50, 0];
    this.yaw = options.yaw ?? 0;
    this.pitch = clamp(options.pitch ?? -0.35, -PITCH_LIMIT, PITCH_LIMIT);
    this.fovYDeg = options.fovYDeg ?? 60;
    this.near = options.near ?? 0.5;
    this.far = options.far ?? 12000;
    this.focusDistance = options.focusDistance ?? DEFAULT_FOCUS_DISTANCE;
  }
}

export interface FreeCameraInputOptions {
  rotateSpeed?: number;
  moveSpeed?: number;
  boost?: number;
  dollyStep?: number;
  invertY?: boolean;
}

const CONTROL_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space',
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** Opt-in pointer + keyboard controller. Attach it only while the free camera is the active view. */
export class FreeCameraInput {
  private readonly keys = new Set<string>();
  private element: HTMLElement | null = null;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private active = true;
  private readonly rotateSpeed: number;
  private readonly moveSpeed: number;
  private readonly boost: number;
  private readonly dollyStep: number;
  private readonly invertY: boolean;

  constructor(private readonly camera: FreeCamera, options: FreeCameraInputOptions = {}) {
    this.rotateSpeed = options.rotateSpeed ?? 0.004;
    this.moveSpeed = options.moveSpeed ?? 90;
    this.boost = options.boost ?? 4;
    this.dollyStep = options.dollyStep ?? 8;
    this.invertY = options.invertY ?? false;
  }

  get attached(): boolean {
    return this.element !== null;
  }

  get enabled(): boolean {
    return this.active;
  }

  setEnabled(value: boolean): void {
    this.active = value;
    if (!value) {
      this.keys.clear();
    }
  }

  attach(element: HTMLElement): void {
    if (this.element === element) {
      return;
    }
    this.detach();
    this.element = element;
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('wheel', this.onWheel, { passive: false });
    element.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  detach(): void {
    const element = this.element;
    if (!element) {
      return;
    }
    element.removeEventListener('pointerdown', this.onPointerDown);
    element.removeEventListener('wheel', this.onWheel);
    element.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.element = null;
    this.dragging = false;
    this.keys.clear();
  }

  /** Move by the currently held keys; call once per rendered frame with the real frame delta. */
  update(dt: number): void {
    if (!this.active || !this.element) {
      return;
    }
    const step = Math.min(0.1, Math.max(0, dt)) * this.moveSpeed * (this.isDown('ShiftLeft', 'ShiftRight') ? this.boost : 1);
    let forward = 0;
    let right = 0;
    let up = 0;
    if (this.isDown('KeyW', 'ArrowUp')) forward += step;
    if (this.isDown('KeyS', 'ArrowDown')) forward -= step;
    if (this.isDown('KeyD', 'ArrowRight')) right += step;
    if (this.isDown('KeyA', 'ArrowLeft')) right -= step;
    if (this.isDown('KeyE', 'Space')) up += step;
    if (this.isDown('KeyQ', 'ControlLeft')) up -= step;
    if (forward || right || up) {
      this.camera.moveLocal(forward, right, up);
    }
  }

  dispose(): void {
    this.detach();
  }

  private isDown(...codes: string[]): boolean {
    return codes.some((code) => this.keys.has(code));
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.active || event.button !== 0) {
      return;
    }
    this.dragging = true;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.element?.setPointerCapture?.(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.active || !this.dragging) {
      return;
    }
    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    const sign = this.invertY ? 1 : -1;
    this.camera.rotateBy(dx * this.rotateSpeed, sign * dy * this.rotateSpeed);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    this.dragging = false;
    if (this.element?.hasPointerCapture?.(event.pointerId)) {
      this.element.releasePointerCapture(event.pointerId);
    }
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.active) {
      return;
    }
    event.preventDefault();
    const notches = event.deltaY / (Math.abs(event.deltaY) > 50 ? 100 : 1);
    this.camera.moveBy([
      this.camera.forward()[0] * -notches * this.dollyStep,
      this.camera.forward()[1] * -notches * this.dollyStep,
      this.camera.forward()[2] * -notches * this.dollyStep,
    ]);
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    if (this.active) {
      event.preventDefault();
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.active || isTextEntry(event.target)) {
      return;
    }
    if (CONTROL_KEYS.has(event.code)) {
      event.preventDefault();
      this.keys.add(event.code);
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };
}

function isTextEntry(target: EventTarget | null): boolean {
  const tag = target instanceof HTMLElement ? target.tagName : '';

  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target instanceof HTMLElement && target.isContentEditable);
}
