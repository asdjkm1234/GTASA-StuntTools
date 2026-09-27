/**
 * Canvas HUD mirror for the video-export path.
 *
 * The export writes raw frames the DOM HUD cannot live in, so the nine analysis gauges are rendered here to
 * a 2D canvas instead. This is an INFORMATION-EQUIVALENT mirror of the interactive DOM HUD in
 * `analysis-hud.ts`, not a pixel copy: it reads ONLY the headless values from `analysis-metrics.ts`
 * (`gaugeTexts(metrics)` formats exactly what `FlightMetrics` carries — the same rules `AnalysisHud.update`
 * applies), so the exported overlay is identical no matter which backend produced the frame.
 *
 * It needs no DOM: the default backing store is an `OffscreenCanvas`, and nothing here reads `document`,
 * CSS pixels or `window.devicePixelRatio`. `scripts/test-export-hud.mjs` asserts the contract below.
 *
 * Resolution/compositing contract (all asserted, not assumed):
 * - BACKING DIMENSIONS EQUAL THE ENCODED FRAME DIMENSIONS: `width`/`height` start at
 *   `EXPORT_HUD_FRAME_WIDTH`/`EXPORT_HUD_FRAME_HEIGHT` (1920x1080) and `setFrameSize` sets them explicitly.
 *   `window.devicePixelRatio` is never consulted, so a DPR-2 display cannot change the backing store or the
 *   layout (test: byte-identical pixels and identical bounds under a simulated DPR-2 run).
 * - FIXED FONT FAMILY/SIZE AND FIXED LAYOUT: the layout is authored in reference pixels at 1080p and scaled
 *   only by `frameHeight / 1080`; every glyph position is a constant plus the formatted value, never a DPR,
 *   CSS pixel or media-query input.
 * - sRGB: the 2D context is created with `colorSpace: 'srgb'` (and alpha on). Canvas 2D buffers are
 *   premultiplied by specification, and every draw here uses the default `source-over` (Porter-Duff over),
 *   so `composite()` blends the HUD over an existing frame with premultiplied-alpha compositing.
 * - DETERMINISTIC RASTER: the context also pins `willReadFrequently`; the HUD is read back for composition
 *   and evidence, and without it Chrome's first `getImageData` can move a GPU-backed canvas to CPU raster
 *   and shift antialiased edge bytes between renders of the same metrics (measured: 126 bytes).
 * - STALE-STATE GUARD: `setFrameSize()` re-sizes the backing store and immediately redraws the last render,
 *   so a frame can never be composited against a HUD of a different size.
 *
 * The interactive DOM HUD is untouched; both surfaces share `ANALYSIS_GAUGE_IDS`/`GAUGE_DEFINITIONS`.
 */
import type { AnalysisHudContext } from './analysis-hud';

import { type AnalysisGaugeId, GAUGE_DEFINITIONS } from './analysis-hud';
import { type FlightAnalysis, type FlightMetrics, sampleAnalysis } from './analysis-metrics';

/** Encoded frame dimensions the export contract fixes; the HUD backing store is exactly this. */
export const EXPORT_HUD_FRAME_WIDTH = 1920;
export const EXPORT_HUD_FRAME_HEIGHT = 1080;

/** The layout is authored at this frame height; every other height scales it uniformly. */
const REFERENCE_HEIGHT = EXPORT_HUD_FRAME_HEIGHT;

// Reference-pixel layout (scale = frame height / 1080; at the contract size scale is exactly 1).
const PANEL_WIDTH = 760;
const PANEL_PADDING = 12;
const PANEL_BOTTOM = 132;
const TITLE_HEIGHT = 24;
const GRID_GAP = 8;
const GRID_COLUMNS = 6;
const CELL_HEIGHT = 92;
const CELL_PADDING = 8;
const LABEL_BASELINE = 16;
const VALUE_BASELINE = 38;
const SUB_BASELINE = 54;
const FOOT_TOP = 60;
const FOOT_HEIGHT = 22;
const BAR_TOP = 66;
const BAR_HEIGHT = 4;
const TITLE_BASELINE = 15;
const TITLE_RESERVE = 66;
const CELL_WIDTH = (PANEL_WIDTH - PANEL_PADDING * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
const PANEL_HEIGHT = PANEL_PADDING * 2 + TITLE_HEIGHT + GRID_GAP * 2 + CELL_HEIGHT * 2;

const HEALTH_MAX = 1000;
const TITLE = '飞行分析';
const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

// Fixed family and reference sizes — never derived from devicePixelRatio or CSS pixels.
const FONT_STACK = '"Segoe UI", "Microsoft YaHei", system-ui, sans-serif';
const FONT_TITLE = 13;
const FONT_LABEL = 10;
const FONT_VALUE = 15;
const FONT_SUB = 10;

/** Missing value slot, matching the DOM HUD's initial `—` (the gauge never crashes on a dropped metric). */
const MISSING = '—';

const COLORS = {
  barFill: '#4fd1c5',
  barTrack: '#1d3044',
  cell: 'rgba(10, 23, 38, 0.78)',
  cellBorder: '#22364d',
  ground: '#7a5a34',
  horizon: '#ffffff',
  marker: '#ffd166',
  muted: '#9fb4cc',
  panel: 'rgba(10, 18, 30, 0.86)',
  panelBorder: '#22364d',
  sky: '#2a6db3',
  title: '#e8f2fb',
  value: '#f2f7fc',
} as const;

/** One gauge as the canvas mirror displays it; `barPercent` is null when the gauge has no bar. */
export interface CanvasHudGaugeText {
  readonly barPercent: null | number;
  readonly id: AnalysisGaugeId;
  readonly label: string;
  readonly sub: string;
  readonly value: string;
}

export interface HudBounds {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export type HudCanvas = HTMLCanvasElement | OffscreenCanvas;
export type HudContext2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** The declared panel rect the HUD may paint into at the contract frame size. */
export const EXPORT_HUD_BOUNDS: HudBounds = {
  height: PANEL_HEIGHT,
  width: PANEL_WIDTH,
  x: (EXPORT_HUD_FRAME_WIDTH - PANEL_WIDTH) / 2,
  y: EXPORT_HUD_FRAME_HEIGHT - PANEL_BOTTOM - PANEL_HEIGHT,
};

function cardinal(heading: number): string {
  const index = Math.round((((heading % 360) + 360) % 360) / 45) % 8;

  return CARDINALS[index];
}

function numberField(metrics: FlightMetrics | null, key: keyof FlightMetrics): number | undefined {
  const value: unknown = metrics?.[key];

  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

// Same display rules as `AnalysisHud.update` / its private helpers (`signed`, `cardinal`); the export test
// asserts every string here equals the DOM HUD's text for the same sampled metrics.
function signed(value: number): string {
  const rounded = Math.abs(value) < 0.05 ? 0 : value;

  return `${rounded >= 0 ? '+' : ''}${rounded.toFixed(1)}`;
}

const percent = (ratio: number): number => Math.max(0, Math.min(1, ratio)) * 100;

/** The nine gauges' display strings for one headless metrics sample; missing values render `—`. */
export function gaugeTexts(metrics: FlightMetrics | null): readonly CanvasHudGaugeText[] {
  const pitch = numberField(metrics, 'pitch');
  const roll = numberField(metrics, 'roll');
  const groundSpeed = numberField(metrics, 'groundSpeed');
  const altitude = numberField(metrics, 'altitude');
  const climbRate = numberField(metrics, 'climbRate');
  const heading = numberField(metrics, 'heading');
  const throttle = numberField(metrics, 'throttle');
  const health = numberField(metrics, 'health');
  const gForce = numberField(metrics, 'gForce');
  const angularRate = numberField(metrics, 'angularRate');
  const rollRate = numberField(metrics, 'rollRate');
  const pitchRate = numberField(metrics, 'pitchRate');
  const yawRate = numberField(metrics, 'yawRate');

  const fields: Record<AnalysisGaugeId, { barPercent: null | number; sub: string; value: string }> = {
    altitude:
      altitude !== undefined
        ? { barPercent: null, sub: '', value: `${altitude.toFixed(1)} m` }
        : { barPercent: null, sub: '', value: MISSING },
    angularRate:
      angularRate !== undefined
        ? {
            barPercent: null,
            sub:
              rollRate !== undefined && pitchRate !== undefined && yawRate !== undefined
                ? `R ${rollRate.toFixed(0)} · P ${pitchRate.toFixed(0)} · Y ${yawRate.toFixed(0)}`
                : '',
            value: `${angularRate.toFixed(1)} °/s`,
          }
        : { barPercent: null, sub: '', value: MISSING },
    attitude:
      pitch !== undefined && roll !== undefined
        ? { barPercent: null, sub: '俯仰 / 横滚', value: `${signed(pitch)}° / ${signed(roll)}°` }
        : { barPercent: null, sub: '', value: MISSING },
    climbRate:
      climbRate !== undefined
        ? { barPercent: null, sub: '', value: `${signed(climbRate)} m/s` }
        : { barPercent: null, sub: '', value: MISSING },
    gForce:
      gForce !== undefined
        ? { barPercent: null, sub: '', value: `${gForce.toFixed(2)} g` }
        : { barPercent: null, sub: '', value: MISSING },
    groundSpeed:
      groundSpeed !== undefined
        ? { barPercent: null, sub: `${(groundSpeed * 3.6).toFixed(0)} km/h`, value: `${groundSpeed.toFixed(1)} m/s` }
        : { barPercent: null, sub: '', value: MISSING },
    heading:
      heading !== undefined
        ? { barPercent: null, sub: cardinal(heading), value: `${heading.toFixed(0)}°` }
        : { barPercent: null, sub: '', value: MISSING },
    health:
      health !== undefined
        ? { barPercent: percent(health / HEALTH_MAX), sub: ` / ${HEALTH_MAX}`, value: `${health.toFixed(0)}` }
        : { barPercent: null, sub: '', value: MISSING },
    throttle:
      throttle !== undefined
        ? { barPercent: percent(throttle), sub: '', value: `${(throttle * 100).toFixed(0)}%` }
        : { barPercent: null, sub: '', value: MISSING },
  };

  return GAUGE_DEFINITIONS.map((definition) => ({
    id: definition.id,
    label: definition.label,
    ...fields[definition.id],
  }));
}

/**
 * The context attributes the contract fixes: alpha on, sRGB, and a deterministic rasterizer. The HUD is
 * read back (composited, byte-compared in tests, encoded into frames), and Chrome switches a GPU-backed 2D
 * canvas to CPU raster on the first `getImageData`, which shifts antialiased edge pixels; pinning
 * `willReadFrequently` keeps every render of the same metrics byte-identical.
 */
const HUD_CONTEXT_ATTRIBUTES: CanvasRenderingContext2DSettings = {
  alpha: true,
  colorSpace: 'srgb',
  willReadFrequently: true,
};

export interface AnalysisHudCanvasOptions {
  /** Backing canvas; defaults to a DOM-free `OffscreenCanvas`. */
  readonly canvas?: HudCanvas;
  readonly height?: number;
  readonly width?: number;
}

function font(size: number, bold: boolean, scale: number): string {
  return `${bold ? '700 ' : ''}${size * scale}px ${FONT_STACK}`;
}

/**
 * The export-only HUD. One instance draws one frame's overlay; call `render`/`renderAnalysis` per frame and
 * `composite` onto the frame's context. All state is the caller's last sample, so the mirror never invents
 * values the DOM HUD would not show.
 */
export class AnalysisHudCanvas {
  readonly canvas: HudCanvas;
  /** The panel rect (scaled to the current backing size) the HUD may paint into; pixels outside are untouched. */
  get bounds(): HudBounds {
    const scale = this.scale();

    return {
      height: PANEL_HEIGHT * scale,
      width: PANEL_WIDTH * scale,
      x: (this.canvas.width - PANEL_WIDTH * scale) / 2,
      y: this.canvas.height - (PANEL_BOTTOM + PANEL_HEIGHT) * scale,
    };
  }
  get height(): number {
    return this.canvas.height;
  }
  get width(): number {
    return this.canvas.width;
  }
  private readonly context: HudContext2D;

  private lastContext: AnalysisHudContext = {};

  private lastMetrics: FlightMetrics | null = null;

  private rendered = false;

  constructor(options: AnalysisHudCanvasOptions = {}) {
    const width = options.width ?? EXPORT_HUD_FRAME_WIDTH;
    const height = options.height ?? EXPORT_HUD_FRAME_HEIGHT;
    this.canvas = options.canvas ?? createCanvas(width, height);
    this.canvas.width = width;
    this.canvas.height = height;
    this.context = get2dContext(this.canvas);
  }

  /** Draw the HUD over an existing frame (default source-over, premultiplied); sizes must match. */
  composite(target: HudContext2D): void {
    target.drawImage(this.canvas, 0, 0);
  }

  /** Attributes the 2D context was created with — asserted to be sRGB with alpha. */
  contextAttributes(): CanvasRenderingContext2DSettings {
    return readContextAttributes(this.context);
  }

  /** The display strings of the last render — the parity surface this mirror shares with the DOM HUD. */
  readGaugeTexts(): readonly CanvasHudGaugeText[] {
    return gaugeTexts(this.lastMetrics);
  }

  render(metrics: FlightMetrics | null, context: AnalysisHudContext = {}): void {
    this.lastMetrics = metrics;
    this.lastContext = context;
    this.rendered = true;
    this.draw();
  }

  /** Sample the headless analysis at `s`, render it, and return the sampled values. */
  renderAnalysis(analysis: FlightAnalysis, s: number, context: AnalysisHudContext = {}): FlightMetrics | null {
    const metrics = sampleAnalysis(analysis, s);
    this.render(metrics, context);

    return metrics;
  }

  /**
   * Set the backing store to EXACTLY these encoded frame dimensions and redraw the last render, so a HUD
   * left over from a different frame size can never be composited (the stale-state guard from the contract).
   */
  setFrameSize(width: number, height: number): void {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new Error(`analysis HUD canvas: invalid frame size ${width}x${height}`);
    }
    if (this.canvas.width === width && this.canvas.height === height) {
      return;
    }
    this.canvas.width = width;
    this.canvas.height = height;
    if (this.rendered) {
      this.draw();
    }
  }

  private draw(): void {
    const ctx = this.context;
    const scale = this.scale();
    const texts = gaugeTexts(this.lastMetrics);
    const panelX = (this.canvas.width - PANEL_WIDTH * scale) / 2;
    const panelY = this.canvas.height - (PANEL_BOTTOM + PANEL_HEIGHT) * scale;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    // Clip to the panel rect: the reported bounds are a hard promise and the contract test asserts it.
    roundedRectPath(ctx, panelX, panelY, PANEL_WIDTH * scale, PANEL_HEIGHT * scale, 10 * scale);
    ctx.clip();

    ctx.fillStyle = COLORS.panel;
    ctx.fillRect(panelX, panelY, PANEL_WIDTH * scale, PANEL_HEIGHT * scale);
    ctx.strokeStyle = COLORS.panelBorder;
    ctx.lineWidth = Math.max(1, scale);
    roundedRectPath(ctx, panelX, panelY, PANEL_WIDTH * scale, PANEL_HEIGHT * scale, 10 * scale);
    ctx.stroke();

    ctx.fillStyle = COLORS.title;
    ctx.font = font(FONT_TITLE, true, scale);
    ctx.fillText(TITLE, panelX + PANEL_PADDING * scale, panelY + (PANEL_PADDING + TITLE_BASELINE) * scale);
    const status = this.statusText();
    if (status) {
      const statusX = panelX + (PANEL_PADDING + TITLE_RESERVE) * scale;
      const statusWidth = (PANEL_WIDTH - PANEL_PADDING * 2 - TITLE_RESERVE) * scale;
      ctx.save();
      ctx.beginPath();
      ctx.rect(statusX, panelY + PANEL_PADDING * scale, Math.max(0, statusWidth), TITLE_HEIGHT * scale);
      ctx.clip();
      ctx.fillStyle = COLORS.muted;
      ctx.font = font(FONT_SUB, false, scale);
      ctx.fillText(status, statusX, panelY + (PANEL_PADDING + TITLE_BASELINE) * scale);
      ctx.restore();
    }

    texts.forEach((text, index) => {
      const row = Math.floor(index / GRID_COLUMNS);
      const column = index % GRID_COLUMNS;
      const cellX = panelX + (PANEL_PADDING + column * (CELL_WIDTH + GRID_GAP)) * scale;
      const cellY = panelY + (PANEL_PADDING + TITLE_HEIGHT + GRID_GAP + row * (CELL_HEIGHT + GRID_GAP)) * scale;
      const cellW = CELL_WIDTH * scale;
      const cellH = CELL_HEIGHT * scale;

      ctx.save();
      roundedRectPath(ctx, cellX, cellY, cellW, cellH, 8 * scale);
      ctx.clip();
      ctx.fillStyle = COLORS.cell;
      ctx.fillRect(cellX, cellY, cellW, cellH);
      ctx.strokeStyle = COLORS.cellBorder;
      ctx.lineWidth = Math.max(1, scale);
      roundedRectPath(ctx, cellX, cellY, cellW, cellH, 8 * scale);
      ctx.stroke();

      ctx.fillStyle = COLORS.muted;
      ctx.font = font(FONT_LABEL, false, scale);
      ctx.fillText(text.label, cellX + CELL_PADDING * scale, cellY + LABEL_BASELINE * scale);
      ctx.fillStyle = COLORS.value;
      ctx.font = font(FONT_VALUE, false, scale);
      ctx.fillText(text.value, cellX + CELL_PADDING * scale, cellY + VALUE_BASELINE * scale);
      if (text.sub) {
        ctx.fillStyle = COLORS.muted;
        ctx.font = font(FONT_SUB, false, scale);
        ctx.fillText(text.sub, cellX + CELL_PADDING * scale, cellY + SUB_BASELINE * scale);
      }
      if (text.barPercent !== null) {
        const barX = cellX + CELL_PADDING * scale;
        const barW = cellW - CELL_PADDING * 2 * scale;
        ctx.fillStyle = COLORS.barTrack;
        ctx.fillRect(barX, cellY + BAR_TOP * scale, barW, BAR_HEIGHT * scale);
        ctx.fillStyle = COLORS.barFill;
        ctx.fillRect(barX, cellY + BAR_TOP * scale, barW * (text.barPercent / 100), BAR_HEIGHT * scale);
      }
      if (text.id === 'attitude') {
        this.drawAttitude(ctx, cellX, cellY, cellW, scale);
      }
      ctx.restore();
    });

    ctx.restore();
  }

  /** Miniature artificial horizon for the attitude gauge, driven only by the sampled pitch/roll. */
  private drawAttitude(ctx: HudContext2D, cellX: number, cellY: number, cellWidth: number, scale: number): void {
    const pitch = numberField(this.lastMetrics, 'pitch');
    const roll = numberField(this.lastMetrics, 'roll');
    const boxX = cellX + CELL_PADDING * scale;
    const boxY = cellY + FOOT_TOP * scale;
    const boxW = cellWidth - CELL_PADDING * 2 * scale;
    const boxH = FOOT_HEIGHT * scale;
    const centreX = boxX + boxW / 2;
    const centreY = boxY + boxH / 2;
    const horizonOffset = pitch === undefined ? 0 : Math.max(-90, Math.min(90, pitch)) * 0.06 * scale;
    const rotation = roll === undefined ? 0 : (-roll * Math.PI) / 180;

    ctx.save();
    ctx.beginPath();
    ctx.rect(boxX, boxY, boxW, boxH);
    ctx.clip();
    ctx.fillStyle = COLORS.sky;
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.translate(centreX, centreY);
    ctx.rotate(rotation);
    ctx.fillStyle = COLORS.sky;
    ctx.fillRect(-boxW, -boxH * 2 + horizonOffset, boxW * 2, boxH * 2);
    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(-boxW, horizonOffset, boxW * 2, boxH * 2);
    ctx.strokeStyle = COLORS.horizon;
    ctx.lineWidth = Math.max(1, scale);
    ctx.beginPath();
    ctx.moveTo(-boxW, horizonOffset);
    ctx.lineTo(boxW, horizonOffset);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = COLORS.marker;
    ctx.fillRect(centreX - 11 * scale, centreY, 22 * scale, Math.max(1, scale));
  }

  private scale(): number {
    return this.canvas.height / REFERENCE_HEIGHT;
  }

  private statusText(): string {
    const { free, model, playing, segment, trackName } = this.lastContext;
    if (trackName === undefined) {
      return '';
    }
    const modelText = model !== undefined ? ` · 模型 ${model}` : '';
    const segmentText = segment ? ` · ${segment}` : '';
    const mode = free ? ' · 自由视角' : playing ? ' · 播放中' : ' · 暂停';

    return `${trackName}${modelText}${segmentText}${mode}`;
  }
}

function createCanvas(width: number, height: number): HudCanvas {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('analysis HUD canvas: OffscreenCanvas is unavailable; pass an explicit canvas');
  }

  return new OffscreenCanvas(width, height);
}

function get2dContext(canvas: HudCanvas): HudContext2D {
  const context =
    typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas
      ? canvas.getContext('2d', HUD_CONTEXT_ATTRIBUTES)
      : canvas.getContext('2d', HUD_CONTEXT_ATTRIBUTES);
  if (!context) {
    throw new Error('analysis HUD canvas: could not create a 2D context');
  }

  return context;
}

/** `getContextAttributes` is on both contexts at runtime; the DOM lib only types it on `CanvasRenderingContext2D`. */
function readContextAttributes(context: HudContext2D): CanvasRenderingContext2DSettings {
  if ('getContextAttributes' in context) {
    return context.getContextAttributes();
  }

  return HUD_CONTEXT_ATTRIBUTES;
}

function roundedRectPath(ctx: HudContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}
