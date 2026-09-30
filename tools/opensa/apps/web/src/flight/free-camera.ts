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
/** Default length of a fly-to, in milliseconds. */
const DEFAULT_FLY_DURATION_MS = 650;
/** A fly-to is always bounded: a caller asking for longer gets this, so no flight outlives a few frames. */
const MAX_FLY_DURATION_MS = 5000;
/** Below this a pose difference cannot move a pixel — the flight completes in one step, without dividing. */
const FLY_EPSILON = 1e-9;

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

/** Ease-in-out on [0, 1]: monotonic, so flight progress only ever moves forward. */
const smoothstep = (t: number): number => t * t * (3 - 2 * t);

export interface FreeCameraFlyToOptions extends FreeCameraFocusOptions {
  /** Upper bound of the flight, in milliseconds. Defaults to 650; always clamped to 5000. */
  durationMs?: number;
}

export interface FreeCameraFocusOptions {
  distance?: number;
  /** When false, the camera only turns to face the target and does not move. Defaults to true. */
  move?: boolean;
  pitch?: number;
  yaw?: number;
}

export interface FreeCameraInputOptions {
  boost?: number;
  dollyStep?: number;
  invertY?: boolean;
  moveSpeed?: number;
  rotateSpeed?: number;
}

export interface FreeCameraOptions {
  far?: number;
  focusDistance?: number;
  fovYDeg?: number;
  near?: number;
  pitch?: number;
  position?: Vec3;
  yaw?: number;
}

export interface FreeCameraPose {
  far: number;
  fovYDeg: number;
  near: number;
  pitch: number;
  position: Vec3;
  yaw: number;
}

/** The pose a focus aims at — the destination of an instant `focus()` and of a `flyTo()` flight. */
interface CameraAim {
  focusDistance: number;
  pitch: number;
  position: Vec3;
  yaw: number;
}

interface CameraFlight {
  durationMs: number;
  elapsedMs: number;
  from: CameraAim;
  to: CameraAim;
  /** Shortest-arc yaw turn, so interpolation ignores full turns between the two headings. */
  yawDelta: number;
}

export class FreeCamera {
  far: number;
  focusDistance: number;
  fovYDeg: number;
  near: number;
  pitch: number;
  position: Vec3;
  yaw: number;
  get pose(): FreeCameraPose {
    return {
      far: this.far,
      fovYDeg: this.fovYDeg,
      near: this.near,
      pitch: this.pitch,
      position: [...this.position],
      yaw: this.yaw,
    };
  }

  private flight: CameraFlight | null = null;

  constructor(options: FreeCameraOptions = {}) {
    this.position = options.position ? [...options.position] : [0, 50, 0];
    this.yaw = options.yaw ?? 0;
    this.pitch = clamp(options.pitch ?? -0.35, -PITCH_LIMIT, PITCH_LIMIT);
    this.fovYDeg = options.fovYDeg ?? 60;
    this.near = options.near ?? 0.03;
    this.far = options.far ?? 12000;
    this.focusDistance = options.focusDistance ?? DEFAULT_FOCUS_DISTANCE;
  }

  /** Advance an active fly-to by `dt` seconds (the caller's frame delta). No-op without a flight. */
  advance(dt: number): void {
    const flight = this.flight;
    if (!flight) {
      return;
    }
    const stepMs = Number.isFinite(dt) ? Math.max(0, dt) * 1000 : 0;
    flight.elapsedMs = Math.min(flight.durationMs, flight.elapsedMs + stepMs);
    const progress = flight.elapsedMs / flight.durationMs;
    if (progress >= 1) {
      this.flight = null;
      this.applyAim(flight.to);

      return;
    }
    const eased = smoothstep(progress);
    this.position = [
      flight.from.position[0] + (flight.to.position[0] - flight.from.position[0]) * eased,
      flight.from.position[1] + (flight.to.position[1] - flight.from.position[1]) * eased,
      flight.from.position[2] + (flight.to.position[2] - flight.from.position[2]) * eased,
    ];
    this.yaw = flight.from.yaw + flight.yawDelta * eased;
    this.pitch = flight.from.pitch + (flight.to.pitch - flight.from.pitch) * eased;
    this.focusDistance = flight.from.focusDistance + (flight.to.focusDistance - flight.from.focusDistance) * eased;
  }

  /** Drop an active flight, leaving the camera where it currently is. */
  cancelFlyTo(): void {
    this.flight = null;
  }

  /** Whether a fly-to is in progress. */
  flying(): boolean {
    return this.flight !== null;
  }

  /** Raw (un-eased) flight progress in [0, 1]; 1 when no flight is active. */
  flyProgress(): number {
    const flight = this.flight;

    return flight ? Math.min(1, Math.max(0, flight.elapsedMs / flight.durationMs)) : 1;
  }

  /**
   * Ease to the pose an instant `focus(target, options)` would take, over `durationMs`.
   *
   * Position and direction are interpolated together (yaw along the shortest arc) and the flight always ends
   * on the exact destination pose. Any direct mutation — `focus`, `lookAt`, `setPose`, a move/rotate, the
   * interactive input — cancels it, so the operator always wins. Calling it again mid-flight re-targets
   * cleanly from the pose the camera has reached. Zero-distance and non-positive durations complete
   * immediately.
   */
  flyTo(target: Vec3, options: FreeCameraFlyToOptions = {}): void {
    const to = this.focusPose(target, options);
    const requested = options.durationMs ?? DEFAULT_FLY_DURATION_MS;
    // A non-finite request falls back to the default rather than producing a NaN-duration flight.
    const durationMs = Number.isFinite(requested)
      ? Math.min(MAX_FLY_DURATION_MS, Math.max(0, requested))
      : DEFAULT_FLY_DURATION_MS;
    const from: CameraAim = {
      focusDistance: this.focusDistance,
      pitch: this.pitch,
      position: [...this.position],
      yaw: this.yaw,
    };
    const yawDelta = shortestAngle(from.yaw, to.yaw);
    const distance = Math.hypot(
      to.position[0] - from.position[0],
      to.position[1] - from.position[1],
      to.position[2] - from.position[2],
    );
    if (
      durationMs <= 0 ||
      (distance < FLY_EPSILON && Math.abs(yawDelta) < FLY_EPSILON && Math.abs(to.pitch - from.pitch) < FLY_EPSILON)
    ) {
      this.flight = null;
      this.applyAim(to);

      return;
    }
    this.flight = { durationMs, elapsedMs: 0, from, to, yawDelta };
  }

  /** Turn to (and by default reposition around) a world point — the instant endpoint-focus entry point. */
  focus(target: Vec3, options: FreeCameraFocusOptions = {}): void {
    this.cancelFlyTo();
    this.applyAim(this.focusPose(target, options));
  }

  forward(): Vec3 {
    const cosPitch = Math.cos(this.pitch);

    return [Math.sin(this.yaw) * cosPitch, Math.sin(this.pitch), -Math.cos(this.yaw) * cosPitch];
  }

  /** Aim at a world point without moving. Leaves the focus distance untouched. Instant, like every non-flight move. */
  lookAt(target: Vec3): void {
    this.cancelFlyTo();
    const aim = this.lookAtAngles(target);
    this.yaw = aim.yaw;
    this.pitch = aim.pitch;
  }

  /** Move along world axes. */
  moveBy(offset: Vec3): void {
    this.cancelFlyTo();
    this.position = [this.position[0] + offset[0], this.position[1] + offset[1], this.position[2] + offset[2]];
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

  /** Move relative to yaw on a level plane, with vertical movement on the world up axis. */
  moveLevel(forwardOffset: number, rightOffset: number, upOffset: number): void {
    const right = this.right();
    this.moveBy([
      Math.sin(this.yaw) * forwardOffset + right[0] * rightOffset,
      upOffset,
      -Math.cos(this.yaw) * forwardOffset + right[2] * rightOffset,
    ]);
  }

  reset(options: FreeCameraOptions = {}): void {
    this.cancelFlyTo();
    this.position = options.position ? [...options.position] : [0, 50, 0];
    this.yaw = options.yaw ?? 0;
    this.pitch = clamp(options.pitch ?? -0.35, -PITCH_LIMIT, PITCH_LIMIT);
    this.fovYDeg = options.fovYDeg ?? 60;
    this.near = options.near ?? 0.03;
    this.far = options.far ?? 12000;
    this.focusDistance = options.focusDistance ?? DEFAULT_FOCUS_DISTANCE;
  }

  right(): Vec3 {
    return [Math.cos(this.yaw), 0, Math.sin(this.yaw)];
  }

  rotateBy(yawDelta: number, pitchDelta: number): void {
    this.cancelFlyTo();
    this.yaw += yawDelta;
    this.pitch = clamp(this.pitch + pitchDelta, -PITCH_LIMIT, PITCH_LIMIT);
  }

  setPose(pose: Partial<FreeCameraPose>): void {
    this.cancelFlyTo();
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

  /** The point the camera is looking at, at the current focus distance. */
  target(): Vec3 {
    const forward = this.forward();

    return [
      this.position[0] + forward[0] * this.focusDistance,
      this.position[1] + forward[1] * this.focusDistance,
      this.position[2] + forward[2] * this.focusDistance,
    ];
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

  private applyAim(aim: CameraAim): void {
    this.position = [...aim.position];
    this.yaw = aim.yaw;
    this.pitch = aim.pitch;
    this.focusDistance = aim.focusDistance;
  }

  /** The pose a `focus()` / `flyTo()` aims at, without applying it. */
  private focusPose(target: Vec3, options: FreeCameraFocusOptions): CameraAim {
    const move = options.move ?? true;
    const focusDistance = options.distance !== undefined ? Math.max(1, options.distance) : this.focusDistance;
    if (!move) {
      const aim = this.lookAtAngles(target);

      return { focusDistance, pitch: aim.pitch, position: [...this.position], yaw: aim.yaw };
    }
    const yaw = options.yaw ?? this.yaw;
    const pitch = options.pitch !== undefined ? clamp(options.pitch, -PITCH_LIMIT, PITCH_LIMIT) : this.pitch;
    const cosPitch = Math.cos(pitch);
    const forward: Vec3 = [Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch];

    return {
      focusDistance,
      pitch,
      position: [
        target[0] - forward[0] * focusDistance,
        target[1] - forward[1] * focusDistance,
        target[2] - forward[2] * focusDistance,
      ],
      yaw,
    };
  }

  /** Angles for aiming at `target`, or the current angles when the target is the eye itself. */
  private lookAtAngles(target: Vec3): { pitch: number; yaw: number } {
    const dx = target[0] - this.position[0];
    const dy = target[1] - this.position[1];
    const dz = target[2] - this.position[2];
    const horizontal = Math.hypot(dx, dz);
    if (horizontal < 1e-6 && Math.abs(dy) < 1e-6) {
      return { pitch: this.pitch, yaw: this.yaw };
    }

    return { pitch: clamp(Math.atan2(dy, horizontal), -PITCH_LIMIT, PITCH_LIMIT), yaw: Math.atan2(dx, -dz) };
  }
}

function normalize(value: Vec3): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2]);

  return length > 1e-6 ? [value[0] / length, value[1] / length, value[2] / length] : [0, 0, 0];
}

/** Shortest signed yaw turn from `from` to `to`, in (−π, π] — a flight across the ±π seam never spins the long way. */
function shortestAngle(from: number, to: number): number {
  const turn = (to - from) % (Math.PI * 2);
  if (turn > Math.PI) {
    return turn - Math.PI * 2;
  }
  if (turn < -Math.PI) {
    return turn + Math.PI * 2;
  }

  return turn;
}

const CONTROL_KEYS = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ControlLeft',
  'ControlRight',
  'KeyA',
  'KeyD',
  'KeyS',
  'KeyW',
  'ShiftLeft',
  'ShiftRight',
  'Space',
]);
const SPEED_LABELS = ['极慢', '慢速', '中速', '快速'] as const;

/** Opt-in pointer + keyboard controller. Attach it only while the free camera is the active view. */
export class FreeCameraInput {
  get attached(): boolean {
    return this.element !== null;
  }
  get enabled(): boolean {
    return this.active;
  }
  get speedLabel(): string {
    return SPEED_LABELS[this.speedTier];
  }
  private active = true;
  private readonly boost: number;
  private readonly dollyStep: number;
  private dragging = false;
  private element: HTMLElement | null = null;
  private readonly invertY: boolean;
  private readonly keys = new Set<string>();
  private lastX = 0;
  private lastY = 0;

  private readonly moveSpeed: number;

  private readonly rotateSpeed: number;
  private speedTier = 2;

  constructor(
    private readonly camera: FreeCamera,
    options: FreeCameraInputOptions = {},
  ) {
    this.rotateSpeed = options.rotateSpeed ?? 0.004;
    this.moveSpeed = options.moveSpeed ?? 90;
    this.boost = options.boost ?? 4;
    this.dollyStep = options.dollyStep ?? 8;
    this.invertY = options.invertY ?? false;
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
    window.addEventListener('blur', this.onBlur);
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
    window.removeEventListener('blur', this.onBlur);
    this.element = null;
    this.dragging = false;
    this.keys.clear();
  }

  dispose(): void {
    this.detach();
  }

  setEnabled(value: boolean): void {
    this.active = value;
    if (!value) {
      this.keys.clear();
    }
  }

  /** Move by the currently held keys; call once per rendered frame with the real frame delta. */
  update(dt: number): void {
    if (!this.active || !this.element) {
      return;
    }
    const step = Math.min(0.1, Math.max(0, dt)) * this.moveSpeed * this.speedMultiplier();
    let forward = 0;
    let right = 0;
    let up = 0;
    if (this.isDown('KeyW', 'ArrowUp')) forward += step;
    if (this.isDown('KeyS', 'ArrowDown')) forward -= step;
    if (this.isDown('KeyD', 'ArrowRight')) right += step;
    if (this.isDown('KeyA', 'ArrowLeft')) right -= step;
    if (this.isDown('Space')) up += step;
    if (this.isDown('ShiftLeft', 'ShiftRight')) up -= step;
    if (forward || right || up) {
      this.camera.moveLevel(forward, right, up);
    }
  }

  private isDown(...codes: string[]): boolean {
    return codes.some((code) => this.keys.has(code));
  }

  private speedMultiplier(): number {
    switch (this.speedTier) {
      case 0: return 0.005;
      case 1: return 0.25;
      case 2: return 1;
      default: return this.boost;
    }
  }

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
      if ((event.code === 'ControlLeft' || event.code === 'ControlRight') && !event.repeat && !this.keys.has(event.code)) {
        this.speedTier = (this.speedTier + 1) % SPEED_LABELS.length;
      }
      this.keys.add(event.code);
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
  };

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
    const distance = -notches * this.dollyStep * Math.min(1, this.speedMultiplier());
    this.camera.moveBy([
      this.camera.forward()[0] * distance,
      this.camera.forward()[1] * distance,
      this.camera.forward()[2] * distance,
    ]);
  };
}

function isTextEntry(target: EventTarget | null): boolean {
  const tag = target instanceof HTMLElement ? target.tagName : '';

  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
