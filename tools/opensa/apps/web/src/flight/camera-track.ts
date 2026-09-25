/** Sample exterior camera motion on a fixed game-frame timeline, independent of browser refresh rate. */
import { ReplayCamera, horizontalFovToVertical, type CameraMode, type CameraStateOut } from './camera';
import { sampleTrack, type FlightTrack } from './csv';
import { gtaDirToEngine, rotateVec, type Vec3 } from './math';

export type ChaseMode = Extract<CameraMode, `chase-${string}`>;
export const isChaseMode = (mode: CameraMode): mode is ChaseMode => mode.startsWith('chase-');

const CAMERA_HZ = 100;
const mix = (a: number, b: number, fraction: number) => a + (b - a) * fraction;
const mixVec = (a: Vec3, b: Vec3, fraction: number): Vec3 => [
  mix(a[0], b[0], fraction), mix(a[1], b[1], fraction), mix(a[2], b[2], fraction),
];

export class ChaseCameraTimeline {
  private histories = new Map<ChaseMode, { camera: ReplayCamera; states: CameraStateOut[] }>();

  constructor(private track: FlightTrack, private modelLength: number, private modelTop: number) {}

  state(time: number, mode: ChaseMode, aspect: number): CameraStateOut {
    const at = Math.max(0, Math.min(this.track.duration, time));
    const scaled = at * CAMERA_HZ;
    const first = Math.floor(scaled);
    const second = Math.ceil(scaled);
    let history = this.histories.get(mode);
    if (!history) {
      const camera = new ReplayCamera();
      camera.mode = mode;
      history = { camera, states: [] };
      this.histories.set(mode, history);
    }
    while (history.states.length <= second) {
      const index = history.states.length;
      const sampleTime = Math.min(this.track.duration, index / CAMERA_HZ);
      const pose = sampleTrack(this.track, sampleTime);
      const position: Vec3 = [pose.pos[0], pose.pos[2], -pose.pos[1]];
      history.states.push(history.camera.state({
        aspect: 1, dt: 1 / CAMERA_HZ,
        forward: rotateVec(pose.orientation, [0, 1, 0]),
        up: rotateVec(pose.orientation, [0, 0, 1]),
        model: pose.row.model, modelLength: this.modelLength, modelTop: this.modelTop,
        position, snap: index === 0, velocity: gtaDirToEngine(pose.velocity),
      }));
    }
    const a = history.states[first];
    const b = history.states[second];
    const fraction = scaled - first;
    return { ...a, aspect, fovYRad: horizontalFovToVertical(70, aspect),
      eye: mixVec(a.eye, b.eye, fraction), target: mixVec(a.target, b.target, fraction) };
  }
}
