import type { Engine } from '@opensa/engine';

import type { CockpitInstrumentState } from './cockpit-instrument-data';

import { ATLAS_SIZE, buildCockpitInstrumentMesh, INSTRUMENT_ATLAS } from './cockpit-instrument-mesh';
import { buildRustlerInstrumentMesh, RUSTLER_INSTRUMENT_ATLAS } from './rustler-instrument-mesh';

type Context = CanvasRenderingContext2D;
const ALTITUDE_MAX_M = 1000,
  SPEED_MAX_KMH = 300;
const amber = '#f0b74d',
  green = '#82e9a3',
  ink = '#e2e8d9',
  red = '#ff655b';
const rad = (degrees: number): number => (degrees * Math.PI) / 180;
const clamp = (value: number, max: number): number => Math.max(0, Math.min(max, value));

/** The same gauge faces are used by the 3D cockpit atlas and the third-person screen panel. */
export type CockpitInstrumentName = keyof typeof INSTRUMENT_ATLAS | keyof typeof RUSTLER_INSTRUMENT_ATLAS;

export interface CockpitInstruments {
  dispose(): void;
  setRoot(root: Float32Array): void;
  setVisible(visible: boolean): void;
  state: CockpitInstrumentState | null;
  update(state: CockpitInstrumentState, force?: boolean): void;
  uploads: number;
}
export function createCockpitInstruments(engine: Engine, model = 520): CockpitInstruments {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  const c = canvas.getContext('2d', { willReadFrequently: true });
  if (!c) throw new Error('Cockpit instruments require Canvas2D');
  const pixels = new Uint8Array(ATLAS_SIZE ** 2 * 4);
  const mesh = model === 476 ? buildRustlerInstrumentMesh(pixels) : buildCockpitInstrumentMesh(pixels);
  const modelId = engine.createVehicleModel(mesh);
  const instance = engine.createVehicle(modelId);
  let key = '';
  const handle: CockpitInstruments = {
    dispose(): void {
      engine.destroyVehicle(instance);
      engine.destroyVehicleModel(modelId);
    },
    setRoot(root): void {
      instance.entity.setRoot(root);
    },
    setVisible(visible): void {
      for (let i = 0; i < mesh.submeshes.length; i++) instance.setSubmeshVisible(i, visible);
    },
    state: null,
    update(state, force = false): void {
      handle.state = state;
      // At most 25 Hz while moving, no uploads while paused. Damage transitions invalidate immediately.
      const next = JSON.stringify([
        Math.floor(state.s * 25),
        state.damage,
        state.gear,
        state.throttle,
        state.throttleSource,
      ]);
      if (!force && next === key) return;
      key = next;
      c.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
      const atlas = model === 476 ? RUSTLER_INSTRUMENT_ATLAS : INSTRUMENT_ATLAS;
      const entries = Object.entries(atlas) as [CockpitInstrumentName, readonly [number, number, number, number]][];
      for (const [name, [x, y]] of entries) {
        c.save();
        c.translate(x, y);
        drawCockpitInstrument(c, name, state);
        c.restore();
      }
      c.fillStyle = '#fff';
      c.fillRect(1022, 1022, 2, 2);
      engine.updateVehicleTextureLayer(
        modelId,
        0,
        0,
        new Uint8Array(c.getImageData(0, 0, ATLAS_SIZE, ATLAS_SIZE).data.buffer),
      );
      handle.uploads++;
    },
    uploads: 0,
  };

  return handle;
}
export function damageLampColor(state: null | number): string {
  return state === null ? '#67716d' : state === 0 ? '#376c52' : state === 2 ? red : amber;
}
export function drawCockpitInstrument(c: Context, name: CockpitInstrumentName, state: CockpitInstrumentState): void {
  const drawings = { altitude, attitude, compass, gear, heading, health, nozzle, speed, status, throttle };
  c.save();
  drawings[name](c, state);
  c.restore();
}
/** Exactly two embedded status lamps. Unknown measured damage is never displayed as healthy. */
export function rustlerStatusLamps(state: Pick<CockpitInstrumentState, 'damage' | 'gear'>): {
  damage: 'damaged' | 'healthy' | 'unknown';
  gearDown: boolean;
} {
  return {
    damage: state.damage.some((d) => d !== null && d > 0)
      ? 'damaged'
      : Array.from({ length: 5 }, (_, i) => state.damage[i] ?? null).some((d) => d === null)
        ? 'unknown'
        : 'healthy',
    gearDown: state.gear === 'DOWN',
  };
}
function altitude(c: Context, state: CockpitInstrumentState): void {
  gauge(c);
  arcTicks(
    c,
    20,
    (i) => -135 + i * 13.5,
    (i) => (i % 4 === 0 ? String(i * 50) : null),
    17,
    108,
  );
  // Stock SA's normal aircraft ceiling starts at Z=800; it is not a hard height clamp.
  const ceiling = rad(-135 + (800 / ALTITUDE_MAX_M) * 270);
  line(
    c,
    150 + Math.sin(ceiling) * 141,
    150 - Math.cos(ceiling) * 141,
    150 + Math.sin(ceiling) * 113,
    150 - Math.cos(ceiling) * 113,
    amber,
    4,
  );
  text(c, 'ALTITUDE', 150, 108, 18);
  text(c, 'WORLD m', 150, 178, 16, '#9dafab');
  c.fillStyle = '#000806';
  c.fillRect(95, 203, 110, 35);
  const rounded = Math.round(state.altitude);
  const outside = state.altitude < 0 || state.altitude > ALTITUDE_MAX_M;
  text(
    c,
    rounded < 0 ? '-' + String(Math.abs(rounded)).padStart(4, '0') : String(rounded).padStart(5, '0'),
    150,
    221,
    27,
    outside ? amber : green,
  );
  if (outside) text(c, state.altitude < 0 ? 'LOW' : 'OVR', 150, 260, 17, amber);
  needle(c, -135 + (clamp(state.altitude, ALTITUDE_MAX_M) / ALTITUDE_MAX_M) * 270, 110);
}
function arcTicks(
  c: Context,
  count: number,
  angle: (i: number) => number,
  label: (i: number) => null | string,
  labelSize = 20,
  labelRadius = 99,
): void {
  for (let i = 0; i <= count; i++) {
    const a = rad(angle(i)),
      major = label(i);
    const point = (r: number): [number, number] => [150 + Math.sin(a) * r, 150 - Math.cos(a) * r];
    line(c, ...point(133), ...point(major ? 115 : 124), ink, major ? 3 : 1.5);
    if (major) text(c, major, ...point(labelRadius), labelSize);
  }
}
function attitude(c: Context, state: CockpitInstrumentState): void {
  c.save();
  c.beginPath();
  c.arc(150, 150, 145, 0, Math.PI * 2);
  c.clip();
  c.fillStyle = '#182423';
  c.fillRect(0, 0, 300, 300);
  c.save();
  c.translate(150, 150);
  c.rotate(rad(-state.roll));
  c.translate(0, state.pitch * 2.6);
  c.fillStyle = '#356b83';
  c.fillRect(-600, -800, 1200, 800);
  c.fillStyle = '#6b5134';
  c.fillRect(-600, 0, 1200, 800);
  line(c, -600, 0, 600, 0, '#e5edd8', 3);
  for (let p = -80; p <= 80; p += 10) {
    if (!p) continue;
    const width = p % 20 ? 23 : 43,
      y = -p * 2.6;
    line(c, -width, y, width, y, '#dfebd9', 2);
    if (p % 20 === 0) {
      text(c, String(Math.abs(p)), -width - 18, y, 13);
      text(c, String(Math.abs(p)), width + 18, y, 13);
    }
  }
  c.restore();
  for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const angle = rad(a);
    line(
      c,
      150 + Math.sin(angle) * 128,
      150 - Math.cos(angle) * 128,
      150 + Math.sin(angle) * 141,
      150 - Math.cos(angle) * 141,
      ink,
      2,
    );
  }
  c.save();
  c.translate(150, 150);
  c.rotate(rad(-state.roll));
  c.fillStyle = ink;
  c.beginPath();
  c.moveTo(0, -125);
  c.lineTo(-6, -115);
  c.lineTo(6, -115);
  c.fill();
  c.restore();
  line(c, 83, 150, 128, 150, '#f8d26b', 5);
  line(c, 172, 150, 217, 150, '#f8d26b', 5);
  line(c, 128, 150, 139, 163, '#f8d26b', 4);
  line(c, 139, 163, 150, 150, '#f8d26b', 4);
  line(c, 150, 150, 161, 163, '#f8d26b', 4);
  line(c, 161, 163, 172, 150, '#f8d26b', 4);
  c.fillStyle = '#09110dd9';
  c.fillRect(92, 243, 116, 23);
  text(c, 'ATTITUDE', 150, 255, 15);
  c.restore();
}
function cell(c: Context, label: string): void {
  c.fillStyle = '#0b1413';
  c.fillRect(0, 0, 300, 170);
  c.strokeStyle = '#3d5249';
  c.lineWidth = 3;
  c.strokeRect(2, 2, 296, 166);
  text(c, label, 150, 28, 22);
}
/** Fixed green aircraft/index; the compass card rotates opposite to recorded nose heading. */
function compass(c: Context, state: CockpitInstrumentState): void {
  gauge(c);
  c.save();
  c.translate(150, 150);
  c.rotate(rad(-state.heading));
  for (let i = 0; i < 72; i++) {
    c.save();
    c.rotate(rad(i * 5));
    const major = i % 6 === 0;
    line(c, 0, -136, 0, major ? -111 : i % 2 === 0 ? -119 : -125, ink, major ? 3 : 2);
    if (major) {
      const label = i % 18 === 0 ? ['N', 'E', 'S', 'W'][i / 18] : String(i / 2);
      text(c, label, 0, -96, i % 18 === 0 ? 27 : 22);
    }
    c.restore();
  }
  for (let a = 0; a < 360; a += 45) {
    c.save();
    c.rotate(rad(a));
    line(c, 0, -139, 0, -125, green, 4);
    c.restore();
  }
  c.restore();
  c.save();
  c.translate(150, 150);
  c.strokeStyle = green;
  c.lineWidth = 2.5;
  c.lineJoin = 'round';
  c.beginPath();
  const plane = [
    [0, -92],
    [5, -78],
    [9, -31],
    [69, 10],
    [70, 35],
    [10, 13],
    [9, 60],
    [28, 79],
    [28, 92],
    [0, 78],
    [-28, 92],
    [-28, 79],
    [-9, 60],
    [-10, 13],
    [-70, 35],
    [-69, 10],
    [-9, -31],
    [-5, -78],
  ];
  plane.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.closePath();
  c.stroke();
  c.fillStyle = green;
  c.beginPath();
  c.moveTo(0, -130);
  c.lineTo(-6, -143);
  c.lineTo(6, -143);
  c.closePath();
  c.fill();
  c.restore();
}
function gauge(c: Context): void {
  const gradient = c.createRadialGradient(150, 135, 20, 150, 150, 160);
  gradient.addColorStop(0, '#202927');
  gradient.addColorStop(1, '#080e12');
  c.fillStyle = gradient;
  c.fillRect(0, 0, 300, 300);
  c.strokeStyle = '#546361';
  c.lineWidth = 2;
  c.beginPath();
  c.arc(150, 150, 145, 0, Math.PI * 2);
  c.stroke();
}
function gear(c: Context, state: CockpitInstrumentState): void {
  cell(c, 'LANDING GEAR');
  text(c, state.gear === 'MOVING' ? 'TRANSIT' : state.gear, 150, 83, 30, state.gear === 'MOVING' ? amber : green);
  for (const [label, x, active, color] of [
    ['DN', 60, 'DOWN', green],
    ['TR', 150, 'MOVING', amber],
    ['UP', 240, 'UP', '#9dd5ec'],
  ] as const) {
    lamp(c, x, 122, 8, state.gear === active ? color : '#24352e');
    text(c, label, x, 149, 17, '#9dafab');
  }
}

function heading(c: Context, state: CockpitInstrumentState): void {
  // Transparent marks on the original sight glass: a rolling card and a fixed centre index.
  c.shadowColor = '#001608';
  c.shadowBlur = 8;
  c.shadowOffsetY = 2;
  text(c, String(Math.round(state.heading) % 360).padStart(3, '0') + '°', 256, 64, 75, green);
  line(c, 256, 130, 256, 155, green, 5);
  const start = Math.floor(state.heading / 10) * 10;
  for (let i = -3; i <= 3; i++) {
    const deg = start + i * 10,
      x = 256 + (deg - state.heading) * 7.5;
    if (x < 20 || x > 492) continue;
    line(c, x, 160, x, 175, green, 3);
    const norm = ((deg % 360) + 360) % 360;
    text(
      c,
      ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' } as Record<number, string>)[norm] ?? String(norm / 10).padStart(2, '0'),
      x,
      204,
      30,
      green,
    );
  }
}

function health(c: Context, state: CockpitInstrumentState): void {
  c.fillStyle = '#0b1413';
  c.fillRect(0, 0, 960, 128);
  text(c, 'HULL', 57, 32, 23);
  text(c, `${Math.round(state.healthDisplay * 100)}%`, 57, 89, 23, state.health < 0.3 ? red : green);
  c.fillStyle = '#23332d';
  c.fillRect(110, 49, 180, 30);
  c.fillStyle = state.health < 0.3 ? red : green;
  c.fillRect(110, 49, 180 * state.healthDisplay, 30);
  const damaged = state.damage.some((d) => d !== null && d > 0);
  const master = damaged ? amber : state.damage.some((d) => d === null) ? '#67716d' : '#376c52';
  text(c, 'CTRL', 369, 29, 21);
  lamp(c, 369, 80, 17, damaged && Math.floor(state.s * 2) % 2 ? '#654521' : master);
  ['RUD', 'EL-L', 'EL-R', 'AIL-L', 'AIL-R'].forEach((label, i) => {
    const x = 465 + i * 106;
    text(c, label, x, 29, 18);
    lamp(c, x, 82, 17, damageLampColor(state.damage[i] ?? null));
  });
}

function lamp(c: Context, x: number, y: number, radius: number, color: string): void {
  c.fillStyle = '#080e0d';
  c.beginPath();
  c.arc(x, y, radius + 3, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = color;
  c.beginPath();
  c.arc(x, y, radius, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#ffffff44';
  c.beginPath();
  c.arc(x - radius * 0.25, y - radius * 0.3, radius * 0.25, 0, Math.PI * 2);
  c.fill();
}

function line(c: Context, x: number, y: number, xx: number, yy: number, color = ink, width = 2): void {
  c.strokeStyle = color;
  c.lineWidth = width;
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(xx, yy);
  c.stroke();
}
function needle(c: Context, degrees: number, length = 108, color = ink, width = 4): void {
  c.save();
  c.translate(150, 150);
  c.rotate(rad(degrees));
  line(c, 0, 17, 0, -length, color, width);
  c.fillStyle = color;
  c.beginPath();
  c.arc(0, 0, 8, 0, Math.PI * 2);
  c.fill();
  c.restore();
}
function nozzle(c: Context, state: CockpitInstrumentState): void {
  cell(c, 'NOZZLE');
  text(c, state.nozzle === null ? '--' : `${Math.round(state.nozzle * 100)}%`, 196, 90, 38, green);
  c.save();
  c.translate(67, 83);
  c.rotate(rad((state.nozzle ?? 0) * 90));
  line(c, -21, 0, 28, 0, ink, 7);
  line(c, 28, 0, 15, -12, ink, 5);
  line(c, 28, 0, 15, 12, ink, 5);
  c.restore();
  text(c, 'FWD    /    VTOL', 150, 143, 17, '#9dafab');
}
function speed(c: Context, state: CockpitInstrumentState): void {
  gauge(c);
  const sweep = (clamp(state.speedKmh, SPEED_MAX_KMH) / SPEED_MAX_KMH) * 270;
  const outside = state.speedKmh > SPEED_MAX_KMH;
  // A broad filled scale makes speed readable in peripheral vision. Draw ticks on top.
  c.save();
  c.lineWidth = 18;
  c.lineCap = 'butt';
  c.strokeStyle = '#213730';
  c.beginPath();
  c.arc(150, 150, 125, rad(-225), rad(45));
  c.stroke();
  if (sweep > 0) {
    c.strokeStyle = outside ? amber : '#4be9b7';
    c.beginPath();
    c.arc(150, 150, 125, rad(-225), rad(-225 + sweep));
    c.stroke();
  }
  c.restore();
  arcTicks(
    c,
    30,
    (i) => -135 + i * 9,
    (i) => (i % 5 === 0 ? String(i * 10) : null),
  );
  text(c, 'AIR SPEED', 150, 105, 17);
  text(c, 'GAME km/h', 150, 179, 16, '#9dafab');
  c.fillStyle = '#000806';
  c.fillRect(95, 202, 110, 35);
  text(c, String(Math.round(state.speedKmh)).padStart(3, '0'), 150, 220, 28, outside ? amber : green);
  if (outside) text(c, 'OVR', 150, 260, 17, amber);
  needle(c, -135 + sweep);
}
function status(c: Context, state: CockpitInstrumentState): void {
  gauge(c);
  arcTicks(
    c,
    20,
    (i) => -135 + i * 13.5,
    (i) => (i % 4 === 0 ? String(i * 5) : null),
    18,
    110,
  );
  text(c, 'HULL %', 150, 89, 20, '#9dafab');
  const color = state.health < 0.3 ? red : green;
  c.save();
  c.translate(0, -15);
  needle(c, -135 + clamp(state.healthDisplay, 1) * 270, 100, color, 3);
  c.restore();
  c.fillStyle = '#08110d';
  c.fillRect(103, 151, 94, 31);
  text(c, `${Math.round(state.healthDisplay * 100)}%`, 150, 167, 28, color);
  const input = state.throttleDisplay === null ? '--' : `${Math.round(state.throttleDisplay * 100)}%`;
  const label = state.throttleSource === 'keys' ? 'W/S*' : state.throttleInferred ? 'CTRL*' : 'THR';
  text(c, `${label} ${input}`, 150, 206, 19, state.throttleDisplay === null ? '#a0aaa4' : ink);
  const lights = rustlerStatusLamps(state);
  lamp(c, 106, 243, 11, lights.gearDown ? green : '#18231d');
  lamp(c, 194, 243, 11, lights.damage === 'damaged' ? amber : lights.damage === 'unknown' ? '#67716d' : '#18231d');
  text(c, 'GEAR', 106, 270, 16, '#9dafab');
  text(c, 'DMG' + (lights.damage === 'unknown' ? '?' : ''), 194, 270, 16, '#9dafab');
}

function text(c: Context, value: string, x: number, y: number, size = 18, color = ink): void {
  c.fillStyle = color;
  c.font = `600 ${size}px "Consolas", monospace`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(value, x, y);
}

function throttle(c: Context, state: CockpitInstrumentState): void {
  cell(c, state.throttleInferred ? 'THROTTLE *' : 'THROTTLE');
  text(c, state.throttleDisplay === null ? '--' : `${Math.round(state.throttleDisplay * 100)}%`, 150, 85, 44, green);
  c.fillStyle = '#273c32';
  c.fillRect(32, 131, 236, 15);
  c.fillStyle = green;
  c.fillRect(32, 131, 236 * (state.throttleDisplay ?? 0), 15);
}
