/**
 * OpenSA own-engine standalone boot (plan 074/10 phase 1) — `@opensa/engine` inside the WEB APP's build
 * without the game. Streams a converted district (`?src=pak-ls` full Los Santos by default; root
 * `public/pak-ls` symlinks the lab's pak) with a free-fly camera. It measured the flip criteria against
 * the three-WebGL host; that host is gone, and the file is KEPT (074/13 phase 8.4) as the minimal-repro
 * boot for engine bugs — no React, no gameplay, no streaming driver beyond the cells. Dev-served only:
 * it is not in `viewerInputs`, so it costs the production build nothing.
 *
 * Controls: WASD + QE (down/up), drag = look, Shift = ×4 speed. `?hour=N` sets the time of day.
 */
import { type CameraState, Engine, setupStreaming, type StreamStats } from '@opensa/engine';

const SPEED = 60; // units/second, ×4 with Shift

/** Minimal parametric day arc (the lab's timecyc driver arrives with the real integration). */
function applyHour(engine: Engine, hour: number): void {
  const elevation = Math.sin(((hour - 6) / 12) * Math.PI);
  const dn = 1 - Math.min(1, Math.max(0, (elevation + 0.15) / 0.3));
  const azScale = 1 - 0.75 * Math.max(0, Math.min(1, elevation));
  const azX = -Math.cos(((Math.max(6, Math.min(18, hour)) - 6) / 12) * Math.PI);
  const dayGate = Math.min(1, Math.max(0, elevation * 4));
  engine.environment.hour = hour;
  engine.environment.dn = dn;
  engine.environment.sunDir = [azX, Math.max(0.05, elevation), 0.25 * azScale];
  engine.environment.sunElevation = Math.max(0, Math.min(1, elevation));
  engine.environment.sunColor = [dayGate, 0.96 * dayGate, 0.88 * dayGate];
  engine.environment.sunDirect = Math.max(0, elevation) * 0.9;
  engine.environment.sunIndirect = 0.75 * (1 - dn) + 0.35 * dn;
}

async function main(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const hud = document.getElementById('hud') as HTMLPreElement;
  const dpr = window.devicePixelRatio;
  const resize = (): void => {
    canvas.width = Math.floor(canvas.clientWidth * dpr);
    canvas.height = Math.floor(canvas.clientHeight * dpr);
  };
  resize();
  window.addEventListener('resize', resize);

  const engine = new Engine();
  await engine.init(canvas);
  // Tier knob (074/09): `?scale=0.75` — live target scale.
  const scaleParam = Number(params.get('scale') ?? Number.NaN);
  if (Number.isFinite(scaleParam)) {
    engine.renderScale = scaleParam;
  }
  const setup = await setupStreaming(engine, `/${params.get('src') ?? 'pak-ls'}`);
  applyHour(engine, Number(params.get('hour') ?? 12) || 12);
  // `?aces=0` / `?bloom=0|N` — the 074/09 post A/Bs (the inline applyHour never touches them, so one
  // set persists; the standalone keeps the fixed day threshold — no night profile here).
  if (params.get('aces') === '0') {
    engine.environment.tonemap = 0;
  }
  const bloomParam = Number(params.get('bloom') ?? Number.NaN);
  if (Number.isFinite(bloomParam)) {
    engine.environment.bloomIntensity = Math.max(0, bloomParam);
  }

  // Free-fly camera state: start above the district centre looking north-ish.
  const eye: [number, number, number] = [setup.center[0], 120, setup.center[2] + 60];
  let yaw = Math.PI;
  let pitch = -0.35;
  const held = new Set<string>();
  window.addEventListener('keydown', (event) => held.add(event.code));
  window.addEventListener('keyup', (event) => held.delete(event.code));
  let dragging = false;
  canvas.addEventListener('pointerdown', () => (dragging = true));
  window.addEventListener('pointerup', () => (dragging = false));
  window.addEventListener('pointermove', (event) => {
    if (dragging) {
      yaw -= event.movementX * 0.0028;
      pitch = Math.min(1.4, Math.max(-1.4, pitch - event.movementY * 0.0028));
    }
  });

  let previous = performance.now();
  const frames: number[] = [];
  const loop = (): void => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - previous) / 1000);
    previous = now;
    frames.push(dt * 1000);
    if (frames.length > 120) {
      frames.shift();
    }

    const forward = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
    const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const speed = SPEED * (held.has('ShiftLeft') || held.has('ShiftRight') ? 4 : 1) * dt;
    const move = (direction: readonly number[], scale: number): void => {
      eye[0] += direction[0] * scale;
      eye[1] += direction[1] * scale;
      eye[2] += direction[2] * scale;
    };
    if (held.has('KeyW')) move(forward, speed);
    if (held.has('KeyS')) move(forward, -speed);
    if (held.has('KeyD')) move(right, speed);
    if (held.has('KeyA')) move(right, -speed);
    if (held.has('KeyE')) eye[1] += speed;
    if (held.has('KeyQ')) eye[1] -= speed;

    const camera: CameraState = {
      aspect: canvas.width / Math.max(1, canvas.height),
      eye: [...eye],
      far: 10000,
      fovYRad: Math.PI / 3,
      near: 0.5,
      target: [eye[0] + forward[0], eye[1] + forward[1], eye[2] + forward[2]],
      up: [0, 1, 0],
    };
    // Rings follow the eye here (fly camera IS the "player"), unlike the lab's orbit which follows target.
    const streamStats: StreamStats = setup.driver.update([eye[0], eye[1], eye[2]]);
    const stats = engine.frame(camera);

    const avgFrame = frames.reduce((sum, value) => sum + value, 0) / Math.max(1, frames.length);
    hud.textContent =
      `OpenSA engine in the WEB APP (074/10 phase 1)\n` +
      `frame     ${avgFrame.toFixed(2)} ms (${Math.round(1000 / Math.max(0.01, avgFrame))} fps)\n` +
      `submit    ${stats.submitMs.toFixed(2)} ms · GPU ${stats.gpuPassMs.toFixed(2)} ms\n` +
      `cells     ${stats.cellsVisible}/${stats.cellsTotal} visible · draws ${stats.drawsRecorded}\n` +
      `stream    ${streamStats.loadedCells} loaded / ${streamStats.pendingCells} pending · worst create ${streamStats.worstCreateMs.toFixed(1)} ms\n` +
      `residency ${(stats.residencyBytes / (1024 * 1024)).toFixed(0)} MB\n` +
      `pos       engine ${eye[0].toFixed(0)}, ${eye[1].toFixed(0)}, ${eye[2].toFixed(0)} · GTA ${eye[0].toFixed(0)}, ${(-eye[2]).toFixed(0)}, ${eye[1].toFixed(0)}\n` +
      `WASD+QE fly · drag look · Shift ×4`;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

void main();
