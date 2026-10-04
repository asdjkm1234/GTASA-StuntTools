import type { CockpitInstrumentState } from './cockpit-instrument-data';
import type { INSTRUMENT_ATLAS } from './cockpit-instrument-mesh';

import { drawCockpitInstrument } from './cockpit-instruments';
import { FEEDBACK_HEIGHT, FEEDBACK_WIDTH } from './surface-feedback-hud';

export const FLIGHT_INSTRUMENT_WIDTH = 900;
export const FLIGHT_INSTRUMENT_HEIGHT = 282;
const GAP = 16,
  MARGIN = 16;

export interface FlightHudLayout {
  controls: HudRect;
  height: number;
  instruments: HudRect;
  left: number;
  top: number;
  width: number;
}
export interface HudRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

/** Small composited HUD rectangle, after scene readback and RGBA conversion. */
export function blendFlightHud(
  pixels: Uint8Array,
  width: number,
  height: number,
  overlay: ImageData,
  left: number,
  top: number,
): void {
  left = Math.round(left);
  top = Math.round(top);
  for (let y = 0; y < overlay.height; y++) {
    if (top + y < 0 || top + y >= height) continue;
    for (let x = 0; x < overlay.width; x++) {
      if (left + x < 0 || left + x >= width) continue;
      const src = (y * overlay.width + x) * 4;
      const alpha = overlay.data[src + 3] / 255;
      if (alpha === 0) continue;
      const dst = ((top + y) * width + left + x) * 4;
      for (let channel = 0; channel < 3; channel++)
        pixels[dst + channel] = Math.round(overlay.data[src + channel] * alpha + pixels[dst + channel] * (1 - alpha));
    }
  }
}

export function drawFlightInstrumentHud(c: CanvasRenderingContext2D, state: CockpitInstrumentState): void {
  c.clearRect(0, 0, FLIGHT_INSTRUMENT_WIDTH, FLIGHT_INSTRUMENT_HEIGHT);
  c.fillStyle = '#0d1928df';
  c.beginPath();
  c.roundRect(0, 0, FLIGHT_INSTRUMENT_WIDTH, FLIGHT_INSTRUMENT_HEIGHT, 14);
  c.fill();
  const draw = (name: keyof typeof INSTRUMENT_ATLAS, x: number, y: number, width: number): void => {
    // All existing gauge coordinates are kept, including the green scale arc and warning lights.
    const originalWidth = name === 'health' ? 960 : name === 'heading' ? 512 : 300;
    c.save();
    c.translate(x, y);
    c.scale(width / originalWidth, width / originalWidth);
    drawCockpitInstrument(c, name, state);
    c.restore();
  };
  draw('speed', 16, 30, 168);
  draw('attitude', 196, 30, 168);
  draw('altitude', 376, 30, 168);
  draw('health', 16, 204, 528);
  draw('heading', 576, 30, 300);
  draw('throttle', 576, 214, 100);
  draw('nozzle', 680, 214, 100);
  draw('gear', 784, 214, 100);
  c.font = '13px "Microsoft YaHei", sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = '#bfd1e4';
  for (const [label, x, y] of [
    ['速度', 100, 17],
    ['姿态', 280, 17],
    ['海拔', 460, 17],
    ['航向', 726, 17],
    [state.throttleInferred ? '油门 *' : '油门', 626, 204],
    ['喷口', 730, 204],
    ['起落架', 834, 204],
  ] as const)
    c.fillText(label, x, y);
}

/** CSS pixels for live UI; output pixels for MP4. A hidden transport contributes no reserved space. */
export function flightHudLayout(width: number, height: number, transportTop?: number): FlightHudLayout {
  const boundary = transportTop === undefined ? height - MARGIN : Math.min(height - MARGIN, transportTop - 12);
  const controlsWidth = (FEEDBACK_WIDTH * FLIGHT_INSTRUMENT_HEIGHT) / FEEDBACK_HEIGHT;
  const baseWidth = FLIGHT_INSTRUMENT_WIDTH + GAP + controlsWidth;
  const scale = Math.max(
    0,
    Math.min(
      1,
      (width - MARGIN * 2) / baseWidth,
      Math.min(240, height * 0.26, boundary - MARGIN) / FLIGHT_INSTRUMENT_HEIGHT,
    ),
  );
  const h = FLIGHT_INSTRUMENT_HEIGHT * scale;
  const w = baseWidth * scale;
  const left = (width - w) / 2;
  const top = boundary - h;

  return {
    controls: { height: h, left: left + (FLIGHT_INSTRUMENT_WIDTH + GAP) * scale, top, width: controlsWidth * scale },
    height: h,
    instruments: { height: h, left, top, width: FLIGHT_INSTRUMENT_WIDTH * scale },
    left,
    top,
    width: w,
  };
}
