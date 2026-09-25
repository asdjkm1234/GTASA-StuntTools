/**
 * Responsive analysis HUD for the flight replay.
 *
 * The HUD is a self-contained DOM subtree whose root carries the distinct `analysis-hud` class (plus a
 * `data-capture="include"` marker). An MP4/PNG export can therefore frame `.analysis-hud` and ignore the old
 * controls, which are marked `data-capture="exclude"` in `flight-replay.html`.
 *
 * Every gauge can be hidden on its own; a hidden gauge collapses into a restore chip so it can be brought
 * back without reloading. The whole panel can also be folded to its title bar (`setCollapsed`) or hidden
 * outright (`setVisible`), so the parent can bind a key/button or an export pass to either. The HUD holds no
 * state of its own beyond visibility, so the parent may call `update` as often (or as rarely) as it likes.
 */
import type { FlightMetrics } from './analysis-metrics';

export const ANALYSIS_GAUGE_IDS = ['attitude', 'groundSpeed', 'altitude', 'climbRate', 'heading', 'throttle', 'health', 'gForce', 'angularRate'] as const;

export type AnalysisGaugeId = typeof ANALYSIS_GAUGE_IDS[number];

interface GaugeDefinition {
  id: AnalysisGaugeId;
  label: string;
}

const GAUGE_DEFINITIONS: readonly GaugeDefinition[] = [
  { id: 'attitude', label: '姿态' },
  { id: 'groundSpeed', label: '地速' },
  { id: 'altitude', label: '高度' },
  { id: 'climbRate', label: '升降率' },
  { id: 'heading', label: '航向' },
  { id: 'throttle', label: '油门' },
  { id: 'health', label: '机体' },
  { id: 'gForce', label: '过载' },
  { id: 'angularRate', label: '角速度' },
];

const HEALTH_MAX = 1000;
const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

export interface AnalysisHudContext {
  trackName?: string;
  model?: number;
  segment?: string;
  playing?: boolean;
  free?: boolean;
}

export interface AnalysisHudOptions {
  root?: HTMLElement;
  className?: string;
}

interface GaugeRefs {
  root: HTMLElement;
  value: HTMLElement;
  sub: HTMLElement;
  bar: HTMLElement | null;
  attitudeDisc: HTMLElement | null;
  chip: HTMLButtonElement;
}

function create<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }

  return node;
}

function signed(value: number): string {
  const rounded = Math.abs(value) < 0.05 ? 0 : value;

  return `${rounded >= 0 ? '+' : ''}${rounded.toFixed(1)}`;
}

function cardinal(heading: number): string {
  const index = Math.round((((heading % 360) + 360) % 360) / 45) % 8;

  return CARDINALS[index];
}

export class AnalysisHud {
  readonly element: HTMLElement;
  private readonly gauges = new Map<AnalysisGaugeId, GaugeRefs>();
  private readonly hiddenBar: HTMLElement;
  private readonly status: HTMLElement;
  private readonly collapseButton: HTMLButtonElement;
  private last: FlightMetrics | null = null;
  private collapsed = false;

  constructor(options: AnalysisHudOptions = {}) {
    this.element = options.root ?? create('div');
    this.element.classList.add('analysis-hud');
    if (options.className) {
      this.element.classList.add(options.className);
    }
    this.element.dataset.capture = 'include';
    this.element.setAttribute('role', 'group');
    this.element.setAttribute('aria-label', '飞行分析');

    const bar = create('div', 'analysis-hud__bar');
    const title = create('span', 'analysis-hud__title', '飞行分析');
    this.status = create('span', 'analysis-hud__status', '');
    const reset = create('button', 'analysis-hud__reset', '全部显示');
    reset.type = 'button';
    reset.addEventListener('click', () => this.resetGauges());
    this.collapseButton = create('button', 'analysis-hud__collapse', '收起');
    this.collapseButton.type = 'button';
    this.collapseButton.title = '收起或展开分析面板';
    this.collapseButton.setAttribute('aria-expanded', 'true');
    this.collapseButton.addEventListener('click', () => this.setCollapsed(!this.collapsed));
    bar.append(title, this.status, reset, this.collapseButton);

    const grid = create('div', 'analysis-hud__grid');
    this.hiddenBar = create('div', 'analysis-hud__hidden');
    this.hiddenBar.hidden = true;

    for (const definition of GAUGE_DEFINITIONS) {
      const refs = this.buildGauge(definition);
      this.gauges.set(definition.id, refs);
      grid.append(refs.root);
      this.hiddenBar.append(refs.chip);
    }

    this.element.append(bar, grid, this.hiddenBar);
  }

  /** Append the HUD to a parent (`document.body` by default). Safe to call more than once. */
  mount(parent: HTMLElement = document.body): HTMLElement {
    if (this.element.parentElement !== parent) {
      parent.append(this.element);
    }

    return this.element;
  }

  update(metrics: FlightMetrics, context: AnalysisHudContext = {}): void {
    this.last = metrics;
    if (context.trackName !== undefined) {
      const model = context.model !== undefined ? ` · 模型 ${context.model}` : '';
      const segment = context.segment ? ` · ${context.segment}` : '';
      const mode = context.free ? ' · 自由视角' : context.playing ? ' · 播放中' : ' · 暂停';
      this.status.textContent = `${context.trackName}${model}${segment}${mode}`;
    }
    this.setGaugeValue('attitude', `${signed(metrics.pitch)}° / ${signed(metrics.roll)}°`, '俯仰 / 横滚');
    this.setGaugeValue('groundSpeed', `${metrics.groundSpeed.toFixed(1)} m/s`, `${(metrics.groundSpeed * 3.6).toFixed(0)} km/h`);
    this.setGaugeValue('altitude', `${metrics.altitude.toFixed(1)} m`, '');
    this.setGaugeValue('climbRate', `${signed(metrics.climbRate)} m/s`, '');
    this.setGaugeValue('heading', `${metrics.heading.toFixed(0)}°`, cardinal(metrics.heading));
    this.setGaugeValue('throttle', `${(metrics.throttle * 100).toFixed(0)}%`, '', Math.max(0, Math.min(1, metrics.throttle)) * 100);
    this.setGaugeValue('health', `${metrics.health.toFixed(0)}`, ` / ${HEALTH_MAX}`, Math.max(0, Math.min(1, metrics.health / HEALTH_MAX)) * 100);
    this.setGaugeValue('gForce', `${metrics.gForce.toFixed(2)} g`, '');
    this.setGaugeValue('angularRate', `${metrics.angularRate.toFixed(1)} °/s`,
      `R ${metrics.rollRate.toFixed(0)} · P ${metrics.pitchRate.toFixed(0)} · Y ${metrics.yawRate.toFixed(0)}`);
    const attitude = this.gauges.get('attitude');
    if (attitude?.attitudeDisc) {
      attitude.attitudeDisc.style.setProperty('--analysis-roll', `${metrics.roll.toFixed(2)}deg`);
      attitude.attitudeDisc.style.setProperty('--analysis-pitch', `${Math.max(-90, Math.min(90, metrics.pitch)).toFixed(2)}px`);
    }
  }

  getMetrics(): FlightMetrics | null {
    return this.last;
  }

  setGaugeVisible(id: AnalysisGaugeId, visible: boolean): void {
    const refs = this.gauges.get(id);
    if (!refs) {
      return;
    }
    refs.root.classList.toggle('analysis-gauge--hidden', !visible);
    refs.chip.hidden = visible;
    this.refreshHiddenBar();
  }

  isGaugeVisible(id: AnalysisGaugeId): boolean {
    const refs = this.gauges.get(id);

    return refs ? !refs.root.classList.contains('analysis-gauge--hidden') : false;
  }

  toggleGauge(id: AnalysisGaugeId): void {
    this.setGaugeVisible(id, !this.isGaugeVisible(id));
  }

  setGauges(visibility: Partial<Record<AnalysisGaugeId, boolean>>): void {
    for (const id of ANALYSIS_GAUGE_IDS) {
      const value = visibility[id];
      if (value !== undefined) {
        this.setGaugeVisible(id, value);
      }
    }
  }

  resetGauges(): void {
    for (const id of ANALYSIS_GAUGE_IDS) {
      this.setGaugeVisible(id, true);
    }
  }

  setVisible(visible: boolean): void {
    this.element.hidden = !visible;
  }

  isVisible(): boolean {
    return !this.element.hidden;
  }

  /** Show/hide the whole HUD (the optional all-or-nothing switch the host can bind to a key or button). */
  toggleVisible(): void {
    this.setVisible(!this.isVisible());
  }

  /** Collapse the HUD to its title bar without unmounting it (gauges and hidden chips folded away). */
  setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.element.classList.toggle('analysis-hud--collapsed', collapsed);
    this.collapseButton.textContent = collapsed ? '展开' : '收起';
    this.collapseButton.setAttribute('aria-expanded', String(!collapsed));
  }

  isCollapsed(): boolean {
    return this.collapsed;
  }

  toggleCollapsed(): void {
    this.setCollapsed(!this.collapsed);
  }

  destroy(): void {
    this.element.remove();
    this.gauges.clear();
  }

  private buildGauge(definition: GaugeDefinition): GaugeRefs {
    const root = create('section', 'analysis-gauge');
    root.dataset.gauge = definition.id;

    const head = create('header', 'analysis-gauge__head');
    const label = create('span', 'analysis-gauge__label', definition.label);
    const hide = create('button', 'analysis-gauge__hide', '×');
    hide.type = 'button';
    hide.title = `隐藏${definition.label}`;
    hide.setAttribute('aria-label', `隐藏${definition.label}`);
    hide.addEventListener('click', () => this.setGaugeVisible(definition.id, false));
    head.append(label, hide);

    const body = create('div', 'analysis-gauge__body');
    const value = create('span', 'analysis-gauge__value', '—');
    const sub = create('span', 'analysis-gauge__sub', '');
    body.append(value, sub);

    let bar: HTMLElement | null = null;
    if (definition.id === 'throttle' || definition.id === 'health') {
      const barTrack = create('div', 'analysis-bar');
      bar = create('div', 'analysis-bar__fill');
      barTrack.append(bar);
      body.append(barTrack);
    }

    let attitudeDisc: HTMLElement | null = null;
    if (definition.id === 'attitude') {
      const attitude = create('div', 'analysis-attitude');
      attitudeDisc = create('div', 'analysis-attitude__disc');
      const sky = create('div', 'analysis-attitude__sky');
      const ground = create('div', 'analysis-attitude__ground');
      const horizon = create('div', 'analysis-attitude__horizon');
      attitudeDisc.append(sky, ground, horizon);
      const marker = create('div', 'analysis-attitude__marker');
      attitude.append(attitudeDisc, marker);
      body.append(attitude);
    }

    root.append(head, body);

    const chip = create('button', 'analysis-chip', definition.label);
    chip.type = 'button';
    chip.dataset.gauge = definition.id;
    chip.hidden = true;
    chip.addEventListener('click', () => this.setGaugeVisible(definition.id, true));

    return { root, value, sub, bar, attitudeDisc, chip };
  }

  private setGaugeValue(id: AnalysisGaugeId, value: string, sub: string, barPercent?: number): void {
    const refs = this.gauges.get(id);
    if (!refs) {
      return;
    }
    refs.value.textContent = value;
    refs.sub.textContent = sub;
    if (refs.bar && barPercent !== undefined) {
      refs.bar.style.width = `${Math.max(0, Math.min(100, barPercent)).toFixed(1)}%`;
    }
  }

  private refreshHiddenBar(): void {
    let anyHidden = false;
    for (const id of ANALYSIS_GAUGE_IDS) {
      if (!this.isGaugeVisible(id)) {
        anyHidden = true;
        break;
      }
    }
    this.hiddenBar.hidden = !anyHidden;
  }
}
