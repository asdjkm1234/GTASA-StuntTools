/** Sample exterior camera motion on a fixed game-frame timeline, independent of browser refresh rate. */
import { ReplayCamera, saChaseFovY, type CameraMode, type CameraStateOut } from './camera';
import { sampleTrack, type FlightTrack } from './csv';
import { gtaDirToEngine, rotateVec, type Vec3 } from './math';

export type ChaseMode = Extract<CameraMode, `chase-${string}`>;
export const isChaseMode = (mode: CameraMode): mode is ChaseMode => mode.startsWith('chase-');

const CAMERA_HZ = 100;
const MAX_CACHED_STATES = CAMERA_HZ * 10;
const SEEK_WARMUP_STATES = CAMERA_HZ * 2;
const mix = (a: number, b: number, fraction: number) => a + (b - a) * fraction;
const mixVec = (a: Vec3, b: Vec3, fraction: number): Vec3 => [
  mix(a[0], b[0], fraction), mix(a[1], b[1], fraction), mix(a[2], b[2], fraction),
];

export class ChaseCameraTimeline {
  private histories = new Map<ChaseMode, { camera: ReplayCamera; states: CameraStateOut[]; startIndex: number }>();

  constructor(private track: FlightTrack, private modelLength: number, private modelTop: number) {}

  state(time: number, mode: ChaseMode, aspect: number, gameAspect = 16 / 9): CameraStateOut {
    const at = Math.max(0, Math.min(this.track.duration, time));
    const scaled = at * CAMERA_HZ;
    const first = Math.floor(scaled);
    const second = Math.ceil(scaled);
    let history = this.histories.get(mode);
    if (!history) {
      const camera = new ReplayCamera();
      camera.mode = mode;
      history = { camera, states: [], startIndex: 0 };
      this.histories.set(mode, history);
    }
    // Long seeks start with a short camera warmup. Sequential playback retains the exact camera
    // motion, while a distant seek never computes the entire recording on one UI frame.
    if (first < history.startIndex || second >= history.startIndex + history.states.length + MAX_CACHED_STATES) {
      history.camera.reset();
      history.states = [];
      history.startIndex = Math.max(0, first - SEEK_WARMUP_STATES);
    }
    while (history.startIndex + history.states.length <= second) {
      const index = history.startIndex + history.states.length;
      const sampleTime = Math.min(this.track.duration, index / CAMERA_HZ);
      const pose = sampleTrack(this.track, sampleTime);
      const position: Vec3 = [pose.pos[0], pose.pos[2], -pose.pos[1]];
      history.states.push(history.camera.state({
        aspect: 1, dt: 1 / CAMERA_HZ,
        forward: rotateVec(pose.orientation, [0, 1, 0]),
        up: rotateVec(pose.orientation, [0, 0, 1]),
        model: pose.row.model, modelLength: this.modelLength, modelTop: this.modelTop,
        position, snap: index === history.startIndex, velocity: gtaDirToEngine(pose.velocity),
      }));
    }
    const a = history.states[first - history.startIndex];
    const b = history.states[second - history.startIndex];
    if (history.states.length > MAX_CACHED_STATES + SEEK_WARMUP_STATES) {
      const remove = history.states.length - MAX_CACHED_STATES;
      history.states.splice(0, remove);
      history.startIndex += remove;
    }
    const fraction = scaled - first;
    return { ...a, aspect, fovYRad: saChaseFovY(aspect, gameAspect),
      eye: mixVec(a.eye, b.eye, fraction), target: mixVec(a.target, b.target, fraction) };
  }
}
