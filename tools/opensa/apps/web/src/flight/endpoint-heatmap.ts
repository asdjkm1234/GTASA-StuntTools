/**
 * Top-down density heatmap of every loaded track's final valid sample.
 *
 * Each track contributes exactly one endpoint (its last usable sample). Endpoints are projected onto the
 * GTA ground plane (x east, y north) with north up, a translucent density grid shows where endpoints
 * cluster, and every endpoint is drawn as a small red dot plus an HTML legend row that names the track —
 * so the label is readable even when dots overlap.
 */
import type { FlightTrack } from './csv';
import type { Vec3 } from './math';

import { finalValidSample } from './analysis-metrics';

const DEFAULT_PADDING = 16;
const DEFAULT_DOT_RADIUS = 4;
const DEFAULT_CELL_SIZE = 20;
const MIN_SPAN = 250;
const HEAT_STOPS: readonly [number, number, number][] = [
  [26, 110, 255],
  [46, 204, 113],
  [241, 196, 15],
  [231, 76, 60],
];

export interface TrackEndpoint {
  index: number;
  track: FlightTrack;
  time: number;
  position: Vec3;
  model: number;
  label: string;
}

export interface EndpointHeatmapOptions {
  cellSize?: number;
  dotRadius?: number;
  padding?: number;
  onSelect?: (endpoint: TrackEndpoint) => void;
  onHover?: (endpoint: TrackEndpoint | null) => void;
}

interface Projected {
  x: number;
  y: number;
}

export class EndpointHeatmap {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private legend: HTMLOListElement | null = null;
  private container: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;
  private endpoints: TrackEndpoint[] = [];
  private projected: Projected[] = [];
  private activeIndex = 0;
  private hoverIndex = -1;
  private selectedIndex = -1;
  private width = 320;
  private height = 220;
  private readonly listeners = new Set<(endpoint: TrackEndpoint) => void>();
  private readonly cellSize: number;
  private readonly dotRadius: number;
  private readonly padding: number;

  constructor(private readonly options: EndpointHeatmapOptions = {}) {
    this.cellSize = options.cellSize ?? DEFAULT_CELL_SIZE;
    this.dotRadius = options.dotRadius ?? DEFAULT_DOT_RADIUS;
    this.padding = options.padding ?? DEFAULT_PADDING;
  }

  /** Build the canvas + legend inside `container` (which gets the `analysis-heatmap` class). */
  mount(container: HTMLElement): HTMLElement {
    if (this.container === container && this.canvas) {
      return container;
    }
    this.destroy();
    this.container = container;
    container.classList.add('analysis-heatmap');
    container.dataset.capture = 'include';

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'analysis-heatmap__canvas';
    this.canvas.setAttribute('aria-label', '航迹端点密度图');
    this.ctx = this.canvas.getContext('2d');

    this.legend = document.createElement('ol');
    this.legend.className = 'analysis-heatmap__legend';

    container.append(this.canvas, this.legend);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('click', this.onClick);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => {
        this.resize();
        this.render();
      });
      this.observer.observe(container);
    }
    this.resize();
    this.render();

    return container;
  }

  setTracks(tracks: readonly FlightTrack[], activeIndex = 0): void {
    const endpoints: TrackEndpoint[] = [];
    tracks.forEach((track, index) => {
      const row = finalValidSample(track);
      if (!row) {
        return;
      }
      endpoints.push({
        index,
        track,
        time: row.s,
        position: [...row.pos],
        model: track.model,
        label: track.name,
      });
    });
    this.endpoints = endpoints;
    this.activeIndex = this.endpointIndexForTrack(activeIndex);
    this.renderLegend();
    this.resize();
    this.render();
  }

  /** Mark the endpoint belonging to `trackIndex` as active (the highlight ring + legend row). */
  setActive(trackIndex: number): void {
    this.activeIndex = this.endpointIndexForTrack(trackIndex);
    this.renderLegend();
    this.render();
  }

  getEndpoints(): readonly TrackEndpoint[] {
    return this.endpoints;
  }

  endpointAt(index: number): TrackEndpoint | null {
    return this.endpoints[index] ?? null;
  }

  /** Select an endpoint programmatically (also fires the `onSelect` listeners). */
  select(index: number): void {
    const endpoint = this.endpoints[index];
    if (!endpoint) {
      return;
    }
    this.selectedIndex = index;
    this.render();
    this.renderLegend();
    this.options.onSelect?.(endpoint);
    for (const listener of this.listeners) {
      listener(endpoint);
    }
    this.canvas?.scrollIntoView({ block: 'nearest' });
  }

  /** Subscribe to endpoint selections. Returns an unsubscribe function. */
  onSelect(callback: (endpoint: TrackEndpoint) => void): () => void {
    this.listeners.add(callback);

    return () => {
      this.listeners.delete(callback);
    };
  }

  setVisible(visible: boolean): void {
    if (this.container) {
      this.container.hidden = !visible;
    }
  }

  isVisible(): boolean {
    return this.container ? !this.container.hidden : false;
  }

  resize(): void {
    if (!this.canvas || !this.ctx) {
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const cssWidth = Math.max(1, Math.round(rect.width || this.canvas.clientWidth || this.width));
    const cssHeight = Math.max(1, Math.round(rect.height || this.canvas.clientHeight || this.height));
    const dpr = window.devicePixelRatio || 1;
    this.width = cssWidth;
    this.height = cssHeight;
    this.canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.legend) {
      this.legend.style.maxHeight = `${Math.max(48, Math.round(cssHeight * 0.55))}px`;
    }
  }

  render(): void {
    const ctx = this.ctx;
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = '#07101b';
    ctx.fillRect(0, 0, this.width, this.height);

    if (this.endpoints.length === 0) {
      ctx.fillStyle = '#91a4ba';
      ctx.font = '12px "Microsoft YaHei", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('还没有航迹端点', this.width / 2, this.height / 2);
      ctx.textAlign = 'left';

      return;
    }

    this.project();
    this.renderDensity(ctx);
    this.renderDots(ctx);
  }

  destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.canvas) {
      this.canvas.removeEventListener('pointermove', this.onPointerMove);
      this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
      this.canvas.removeEventListener('click', this.onClick);
    }
    if (this.container) {
      this.container.replaceChildren();
    }
    this.canvas = null;
    this.ctx = null;
    this.legend = null;
    this.container = null;
    this.projected = [];
    this.hoverIndex = -1;
    this.selectedIndex = -1;
  }

  /** Map a track index to its endpoint slot. Tracks with no usable endpoint are absent, so indices differ. */
  private endpointIndexForTrack(trackIndex: number): number {
    const found = this.endpoints.findIndex((endpoint) => endpoint.index === trackIndex);
    if (found >= 0) {
      return found;
    }

    return Math.max(0, Math.min(this.endpoints.length - 1, trackIndex));
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    const hit = this.hitTest(event);
    if (hit === this.hoverIndex) {
      return;
    }
    this.hoverIndex = hit;
    if (this.canvas) {
      this.canvas.style.cursor = hit >= 0 ? 'pointer' : 'default';
    }
    this.options.onHover?.(hit >= 0 ? this.endpoints[hit] : null);
    this.render();
  };

  private readonly onPointerLeave = (): void => {
    if (this.hoverIndex === -1) {
      return;
    }
    this.hoverIndex = -1;
    this.options.onHover?.(null);
    this.render();
  };

  private readonly onClick = (event: MouseEvent): void => {
    const hit = this.hitTest(event);
    if (hit >= 0) {
      this.select(hit);
    }
  };

  private hitTest(event: MouseEvent): number {
    const rect = this.canvas?.getBoundingClientRect();
    if (!rect) {
      return -1;
    }
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const radius = this.dotRadius + 6;
    let best = -1;
    let bestDistance = radius * radius;
    this.projected.forEach((point, index) => {
      const dx = point.x - x;
      const dy = point.y - y;
      const distance = dx * dx + dy * dy;
      if (distance <= bestDistance) {
        best = index;
        bestDistance = distance;
      }
    });

    return best;
  }

  private project(): void {
    const minX = Math.min(...this.endpoints.map((endpoint) => endpoint.position[0]));
    const maxX = Math.max(...this.endpoints.map((endpoint) => endpoint.position[0]));
    const minY = Math.min(...this.endpoints.map((endpoint) => endpoint.position[1]));
    const maxY = Math.max(...this.endpoints.map((endpoint) => endpoint.position[1]));
    let spanX = maxX - minX;
    let spanY = maxY - minY;
    if (spanX < MIN_SPAN) {
      spanX = MIN_SPAN;
    }
    if (spanY < MIN_SPAN) {
      spanY = MIN_SPAN;
    }
    const usableWidth = Math.max(1, this.width - this.padding * 2);
    const usableHeight = Math.max(1, this.height - this.padding * 2);
    const scale = Math.min(usableWidth / spanX, usableHeight / spanY);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    this.projected = this.endpoints.map((endpoint) => ({
      x: (endpoint.position[0] - centerX) * scale + this.width / 2,
      y: -(endpoint.position[1] - centerY) * scale + this.height / 2,
    }));
  }

  private renderDensity(ctx: CanvasRenderingContext2D): void {
    const cell = Math.max(8, this.cellSize);
    const cols = Math.max(1, Math.ceil(this.width / cell));
    const rows = Math.max(1, Math.ceil(this.height / cell));
    const counts = new Uint32Array(cols * rows);
    let maxCount = 0;
    for (const point of this.projected) {
      const col = Math.min(cols - 1, Math.max(0, Math.floor(point.x / cell)));
      const row = Math.min(rows - 1, Math.max(0, Math.floor(point.y / cell)));
      const at = row * cols + col;
      counts[at] += 1;
      maxCount = Math.max(maxCount, counts[at]);
    }
    if (maxCount === 0) {
      return;
    }
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const count = counts[row * cols + col];
        if (count === 0) {
          continue;
        }
        const t = maxCount <= 1 ? 0.35 : count / maxCount;
        const [r, g, b] = heatColor(t);
        ctx.fillStyle = `rgba(${r},${g},${b},${(0.22 + 0.34 * t).toFixed(3)})`;
        ctx.fillRect(col * cell, row * cell, cell - 1, cell - 1);
      }
    }
  }

  private renderDots(ctx: CanvasRenderingContext2D): void {
    ctx.font = '11px "Microsoft YaHei", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    this.projected.forEach((point, index) => {
      const active = index === this.activeIndex;
      const hovered = index === this.hoverIndex || index === this.selectedIndex;
      const radius = this.dotRadius + (active ? 1.5 : 0) + (hovered ? 1 : 0);

      if (active) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius + 3, 0, Math.PI * 2);
        ctx.strokeStyle = '#4fd1c5';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#ff2d2d';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      const label = hovered || this.projected.length <= 12 ? `#${index + 1} ${shortName(this.endpoints[index].label)}` : `#${index + 1}`;
      const textX = point.x + radius + 4;
      const textY = point.y;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(7,16,27,0.9)';
      ctx.strokeText(label, textX, textY);
      ctx.fillStyle = active ? '#4fd1c5' : '#ffffff';
      ctx.fillText(label, textX, textY);
    });
  }

  private renderLegend(): void {
    if (!this.legend) {
      return;
    }
    this.legend.replaceChildren();
    this.endpoints.forEach((endpoint, index) => {
      const item = document.createElement('li');
      item.className = 'analysis-heatmap__item';
      if (index === this.activeIndex) {
        item.classList.add('is-active');
      }
      if (index === this.selectedIndex) {
        item.classList.add('is-selected');
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'analysis-heatmap__row';
      button.textContent = `#${index + 1} ${shortName(endpoint.label, 26)} · ${endpoint.model} · ${endpoint.time.toFixed(1)}s · (${endpoint.position[0].toFixed(0)}, ${endpoint.position[1].toFixed(0)}, ${endpoint.position[2].toFixed(0)})`;
      button.title = endpoint.label;
      button.addEventListener('click', () => this.select(index));
      item.append(button);
      this.legend?.append(item);
    });
  }
}

function heatColor(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (HEAT_STOPS.length - 1);
  const low = Math.min(HEAT_STOPS.length - 2, Math.floor(scaled));
  const fraction = scaled - low;
  const a = HEAT_STOPS[low];
  const b = HEAT_STOPS[low + 1];

  return [
    Math.round(a[0] + (b[0] - a[0]) * fraction),
    Math.round(a[1] + (b[1] - a[1]) * fraction),
    Math.round(a[2] + (b[2] - a[2]) * fraction),
  ];
}

function shortName(name: string, max = 14): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}
