import type { CameraStateOut } from './camera';
import type { FlightTrack } from './csv';
import type { ExteriorShotView, ShotKind, ShotRange, ShotView } from './shot-camera';

import { sampleTrack } from './csv';
import { viewProjection } from './endpoint-picking';
import { gtaToEngine } from './math';
import { clipSegment } from './route-picking';
import {
  recommendShots,
  SHOT_KINDS,
  SHOT_LABELS,
  shotRecordingId,
  shotSegmentIndex,
  validShotForTrack,
  validShotRange,
  validShotView,
} from './shot-camera';
import { SEGMENT_COLORS } from './shot-camera-diagram';
import { saveShotSegment, shotSegmentEditor } from './shot-segment-editor';
import {
  resizeShotSequence,
  sequenceIndex,
  type ShotProgram,
  type ShotSequence,
  validShotProgram,
  validShotSequence,
} from './shot-sequence';
import { ShotSequenceEditor } from './shot-sequence-editor';

export interface ShotPanelPorts {
  capture(kind: ShotKind): ShotView;
  export(
    views: ShotProgram[],
    range: ShotRange,
    note: HTMLElement,
    results: HTMLElement,
    cancel: HTMLButtonElement,
  ): Promise<void>;
  inspect(view: ShotProgram): void;
  place(view: ShotView): void;
  prepare(): void;
  preview(view: ShotProgram, seconds: number, end?: number): void;
  seconds(): number;
  seek(seconds: number): void;
  stopPreview(): void;
}
interface ShotPlan {
  mode?: 'batch' | 'sequence';
  range: ShotRange;
  selected: Set<ShotKind>;
  sequence?: ShotSequence;
  views: Partial<Record<ShotKind, ShotView>>;
}
const guidance: Record<ShotKind, string> = {
  cockpit: '拖动调整舱内观察方向；WASD / 空格 / Shift 微调眼位。保存后随飞机姿态运动。',
  fixed: '放在航迹侧面，调整朝向让动作经过画面。固定镜头保持位置和朝向；用起、中、末检查构图。',
  follow: '先移到飞机侧面、前方或后方，再保存。位置随航向移动，地平线保持稳定；翻滚仍清晰可见。',
  tracking: '选一个地面或空中观察点，相机会自动看向飞机。检查飞机最近经过时是否太大或被遮挡。',
};

/** A per-recording shot plan. Changing recordings never reuses another recording's time range. */
export class ShotPanel {
  readonly element: HTMLElement;
  get diagramView(): null | ShotProgram {
    if (
      this.element.hidden ||
      this.busy ||
      !this.node<HTMLInputElement>('shotDiagramToggle').checked ||
      (!this.diagramKind && this.plan?.mode !== 'sequence')
    )
      return null;
    const view =
      this.plan?.mode === 'sequence' ? this.plan.sequence : (this.plan?.views[this.diagramKind!] ?? this.placedView);

    return view && this.track && validShotProgram(view, this.track.duration) ? view : null;
  }
  get picking(): boolean {
    return !!this.armed && !this.element.hidden && !this.busy;
  }
  private armed: 'end' | 'start' | null = null;
  private busy = false;
  private readonly cards = new Map<ShotKind, HTMLElement>();
  private diagramKind: null | ShotKind = null;
  private readonly overlay: HTMLCanvasElement;
  private overlayKey = '';
  private overlayTrack: FlightTrack | null = null;
  private placedView: null | ShotView = null;
  private plan: null | ShotPlan = null;
  private readonly plans = new WeakMap<FlightTrack, ShotPlan>();
  private readonly previewToolbar: HTMLElement;

  private readonly sequenceEditor: ShotSequenceEditor;
  private track: FlightTrack | null = null;

  private get exteriorDiagramView(): ExteriorShotView | null {
    const view = this.diagramKind ? this.plan?.views[this.diagramKind] : undefined;

    return view && view.kind !== 'cockpit' ? view : null;
  }

  constructor(private readonly ports: ShotPanelPorts) {
    this.element = document.createElement('aside');
    this.element.id = 'shotPanel';
    this.element.className = 'panel';
    this.element.hidden = true;
    this.element.dataset.capture = 'exclude';
    this.element.setAttribute('aria-label', '多机位片段导出');
    this.element.innerHTML = `
      <div class="shot-head"><h1>多机位片段导出</h1><button id="shotClose" type="button" aria-label="关闭多机位面板">×</button></div>
      <p class="small">选择录像范围，可导出多个独立机位，也可按时间编排成一个视频。</p>
      <fieldset id="shotEditor"><legend>1 · 选择录像时间范围</legend>
      <div class="shot-times"><div>起点 A<output id="shotStart"></output></div>
      <div>终点 B<output id="shotEnd"></output></div></div>
      <div id="shotRangeBar"><span></span></div>
      <div class="shot-actions"><button id="shotStartNow" type="button">当前时间为起点</button><button id="shotEndNow" type="button">当前时间为终点</button></div>
      <div class="shot-actions"><button id="shotPickStart" type="button">在迹线上选起点</button><button id="shotPickEnd" type="button">在迹线上选终点</button><button id="shotWhole" type="button">整段</button></div>
      <p id="shotRangeNote" class="small" role="status"></p>
      <h2>2 · 选择并布置镜头</h2>
      <div class="shot-actions"><button id="shotModeBatch" type="button">独立机位</button><button id="shotModeSequence" type="button">镜头编排 · 一个视频</button></div>
      <div id="shotBatchActions" class="shot-actions"><button id="shotAll" type="button">全选四类</button><button id="shotNone" type="button">清空勾选</button><button id="shotGenerate" type="button">为勾选镜头推荐机位</button></div>
      <p id="shotPlacementGuide" class="small"></p>
      <label class="track-filter"><input id="shotDiagramToggle" type="checkbox" checked /> 显示摄像头 / 视野 3D 图示</label>
      <p class="small">橙色为当前段摄像头，蓝色为其他段，视锥按 16:9 导出比例显示。分段路线、边界时间与机位编号对应；伴飞的其他点位显示各段代表时刻。摄像头尺寸和视锥长度为示意；点“查看 3D 图示”总览各段。</p>
      <div id="shotCards"></div><div id="shotSequenceEditor" hidden></div>
      <div class="shot-actions"><button id="shotStop" type="button">结束预览 / 返回布置</button></div>
      <div class="shot-actions"><button id="shotPlanSave" type="button">保存方案 JSON</button><button id="shotPlanLoad" type="button">载入方案</button><input id="shotPlanFile" type="file" accept=".json,application/json" hidden /></div>
      </fieldset>
      <div class="shot-actions"><button id="shotExport" type="button">批量导出独立 MP4</button><button id="shotCancel" type="button" hidden>取消剩余导出</button></div>
      <p id="shotExportNote" class="small" role="status" aria-live="polite"></p><div id="shotResults"></div>`;
    document.body.append(this.element);
    this.sequenceEditor = new ShotSequenceEditor(this.node('shotSequenceEditor'), {
      capture: (kind) => this.ports.capture(kind),
      changed: () => {
        this.ports.stopPreview();
        this.overlayKey = '';
      },
      inspect: () => {
        this.node<HTMLInputElement>('shotDiagramToggle').checked = true;
        if (this.plan?.sequence) this.ports.inspect(this.plan.sequence);
      },
      message: (value) => this.message(value),
      place: (view) => this.ports.place(view),
      preview: (sequence, seconds, end) => this.ports.preview(sequence, seconds, end),
      seconds: () => this.ports.seconds(),
      select: (seconds) => {
        this.ports.stopPreview();
        this.node<HTMLInputElement>('shotDiagramToggle').checked = true;
        this.ports.seek(seconds);
      },
      stop: () => this.ports.stopPreview(),
    });
    for (const mode of ['batch', 'sequence'] as const)
      this.button(mode === 'batch' ? 'shotModeBatch' : 'shotModeSequence', () => {
        if (!this.plan || !this.track || !validShotRange(this.plan.range, this.track.duration)) return;
        this.ports.stopPreview();
        this.plan.mode = mode;
        if (mode === 'sequence' && !this.plan.sequence)
          this.plan.sequence = {
            clips: [{ ...this.plan.range, view: recommendShots(this.track, this.plan.range).fixed }],
            kind: 'sequence',
          };
        this.refreshMode();
      });
    this.previewToolbar = document.createElement('div');
    this.previewToolbar.id = 'shotPreviewToolbar';
    this.previewToolbar.className = 'panel';
    this.previewToolbar.dataset.capture = 'exclude';
    this.previewToolbar.hidden = true;
    this.previewToolbar.innerHTML =
      '<span></span><button id="shotPreviewExit" type="button" title="结束预览并返回布置（Esc）">结束预览 / 返回布置</button>';
    this.previewToolbar.querySelector<HTMLButtonElement>('button')!.onclick = () => this.ports.stopPreview();
    document.body.append(this.previewToolbar);
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Escape' && !this.previewToolbar.hidden && !event.defaultPrevented && !event.isComposing) {
        event.preventDefault();
        this.ports.stopPreview();
      }
    });
    this.overlay = document.createElement('canvas');
    this.overlay.id = 'shotRangeOverlay';
    this.overlay.dataset.capture = 'exclude';
    this.overlay.hidden = true;
    document.body.append(this.overlay);
    this.button('shotClose', () => {
      this.element.hidden = true;
      this.armed = null;
      this.ports.stopPreview();
    });
    this.button('shotStop', () => this.ports.stopPreview());
    this.button('shotStartNow', () => this.setBound('start', this.ports.seconds()));
    this.button('shotEndNow', () => this.setBound('end', this.ports.seconds()));
    for (const bound of ['start', 'end'] as const) {
      this.button(bound === 'start' ? 'shotPickStart' : 'shotPickEnd', () => {
        this.ports.stopPreview();
        this.ports.prepare();
        this.armed = bound;
        this.refreshRange();
      });
    }
    this.button('shotWhole', () => {
      if (!this.plan || !this.track) return;
      this.ports.stopPreview();
      this.plan.range = { end: this.track.duration, start: 0 };
      this.armed = null;
      this.refreshRange();
    });
    this.button('shotAll', () => {
      if (this.plan) {
        this.plan.selected = new Set(SHOT_KINDS);
        this.refreshCards();
      }
    });
    this.button('shotNone', () => {
      this.plan?.selected.clear();
      this.refreshCards();
    });
    this.button('shotGenerate', () => {
      if (!this.plan || !this.track || !validShotRange(this.plan.range, this.track.duration)) {
        this.message('请先设置有效的起止时间。');

        return;
      }
      const recommended = recommendShots(this.track, this.plan.range);
      for (const kind of this.plan.selected) this.plan.views[kind] = recommended[kind];
      this.diagramKind = [...this.plan.selected][0] ?? null;
      this.placedView = null;
      this.refreshCards();
      this.message('已生成勾选镜头的推荐机位。请预览起、中、末，再按需调整。');
    });
    this.button('shotExport', () => {
      void this.export();
    });
    this.button('shotPlanSave', () => {
      if (!this.track || !this.plan || !validShotRange(this.plan.range, this.track.duration)) {
        this.message('请先设置有效时间范围。');

        return;
      }
      const text = JSON.stringify(
        {
          mode: this.plan.mode ?? 'batch',
          range: this.plan.range,
          recording: shotRecordingId(this.track),
          selected: SHOT_KINDS.filter((kind) => this.plan!.selected.has(kind)),
          sequence: this.plan.sequence,
          version: 1,
          views: this.plan.views,
        },
        null,
        2,
      );
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'flight-shot-plan.json';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.message('方案已保存。下次载入同一录像后，可用“载入方案”恢复时间范围和机位。');
    });
    this.button('shotPlanLoad', () => this.node<HTMLInputElement>('shotPlanFile').click());
    this.node<HTMLInputElement>('shotPlanFile').onchange = (): void => {
      void this.loadPlan();
    };
    for (const kind of SHOT_KINDS) this.makeCard(kind);
  }
  drawRange(camera: CameraStateOut, visible: boolean, width: number, height: number): void {
    if (!this.element.hidden) {
      const transportTop = document.getElementById('transport')!.getBoundingClientRect().top;
      const hudTop = document.body.classList.contains('flight-hud-visible')
        ? parseFloat(document.body.style.getPropertyValue('--flight-hud-top'))
        : transportTop;
      this.element.style.maxHeight = `${Math.max(100, Math.min(transportTop, Number.isFinite(hudTop) ? hudTop : transportTop) - 28)}px`;
    }
    const show = visible && !this.element.hidden && !!this.track && !!this.plan;
    this.overlay.hidden = !show;
    if (!show || !this.track || !this.plan) return;
    const view = this.exteriorDiagramView;
    const sequence = this.plan.mode === 'sequence' ? this.plan.sequence : undefined;
    const parts = sequence?.clips ?? view?.segments;
    const activeIndex = this.diagramIndex(sequence, view);
    const key = JSON.stringify([camera, this.plan.range, parts, activeIndex, width, height]);
    if (this.overlayTrack === this.track && key === this.overlayKey) return;
    this.overlayTrack = this.track;
    this.overlayKey = key;
    this.overlay.width = width;
    this.overlay.height = height;
    const context = this.overlay.getContext('2d')!;
    const matrix = viewProjection(camera),
      range = this.plan.range;
    if (!validShotRange(range, this.track.duration)) return;
    const rows = [
      { pos: sampleTrack(this.track, range.start).pos, s: range.start },
      ...this.track.rows.filter((row) => row.s > range.start && row.s < range.end),
      ...(parts ?? [])
        .flatMap((part) => [part.start, part.end])
        .filter((s) => s > range.start && s < range.end)
        .map((s) => ({ pos: sampleTrack(this.track!, s).pos, s })),
      { pos: sampleTrack(this.track, range.end).pos, s: range.end },
    ].sort((a, b) => a.s - b.s);
    const points = rows.map((row) => row.pos);
    const clip = (pos: number[]): [number, number, number, number] => {
      const p = gtaToEngine(pos[0], pos[1], pos[2]);

      return [0, 1, 2, 3].map(
        (axis) => matrix[axis] * p[0] + matrix[axis + 4] * p[1] + matrix[axis + 8] * p[2] + matrix[axis + 12],
      ) as [number, number, number, number];
    };
    const screen = (p: number[]): number[] => [((p[0] / p[3] + 1) * width) / 2, ((1 - p[1] / p[3]) * height) / 2];
    context.beginPath();
    for (let i = 1; i < points.length; i++) {
      const a = clip(points[i - 1]),
        b = clip(points[i]),
        bounds = clipSegment(a, b);
      if (!bounds) continue;
      const at = (t: number): number[] => screen(a.map((v, axis) => v + (b[axis] - v) * t));
      const end = at(bounds[1]),
        start = at(bounds[0]);
      context.moveTo(start[0], start[1]);
      context.lineTo(end[0], end[1]);
    }
    context.strokeStyle = '#91f1e8';
    context.globalAlpha = 0.2;
    context.lineWidth = 8;
    context.stroke();
    context.globalAlpha = 1;
    if (parts?.length) this.drawSegments(context, rows, activeIndex, parts, clip, screen);
    for (const [index, label] of [
      [0, 'A'],
      [points.length - 1, 'B'],
    ] as const) {
      const p = clip(points[index]);
      if (p[3] <= 0 || p[2] < 0 || p[2] > p[3]) continue;
      const [x, y] = screen(p);
      context.beginPath();
      context.arc(x, y, 10, 0, Math.PI * 2);
      context.fillStyle = '#143942';
      context.fill();
      context.strokeStyle = '#91f1e8';
      context.lineWidth = 2;
      context.stroke();
      context.fillStyle = '#fff';
      context.font = 'bold 12px sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(label, x, y);
    }
  }
  pick(seconds: number): boolean {
    if (!this.armed || this.element.hidden || this.busy) return false;
    const bound = this.armed;
    this.armed = null;
    this.setBound(bound, seconds);

    return true;
  }
  setPreview(kind: 'sequence' | null | ShotKind): void {
    this.previewToolbar.hidden = kind === null;
    this.sequenceEditor.setPreview(kind === 'sequence');
    this.previewToolbar.querySelector('span')!.textContent = kind
      ? `${kind === 'sequence' ? '镜头编排' : SHOT_LABELS[kind]}预览 · Esc 可退出`
      : '';
    for (const [cardKind, card] of this.cards)
      card.querySelector<HTMLButtonElement>('[data-action="stop"]')!.hidden = kind !== cardKind;
  }
  sync(track: FlightTrack | null): void {
    if (track === this.track) return;
    this.diagramKind = null;
    this.placedView = null;
    this.track = track;
    this.armed = null;
    if (track) {
      let plan = this.plans.get(track);
      if (!plan) {
        plan = { range: { end: track.duration, start: 0 }, selected: new Set(SHOT_KINDS), views: {} };
        this.plans.set(track, plan);
      }
      this.plan = plan;
    } else this.plan = null;
    this.node<HTMLFieldSetElement>('shotEditor').disabled = !track || this.busy;
    this.node<HTMLButtonElement>('shotExport').disabled = !track || this.busy;
    this.refreshRange();
    this.refreshCards();
  }

  toggle(): void {
    this.element.hidden = !this.element.hidden;
    if (!this.element.hidden) {
      this.ports.stopPreview();
      this.ports.prepare();
    } else {
      this.armed = null;
      this.ports.stopPreview();
    }
  }

  private button(id: string, action: () => void): void {
    this.node<HTMLButtonElement>(id).onclick = (): void => {
      try {
        action();
      } catch (error) {
        this.message(String(error));
      }
    };
  }

  private diagramIndex(sequence: ShotSequence | undefined, view: ExteriorShotView | null): number {
    if (sequence) return sequenceIndex(sequence, this.ports.seconds());

    return view ? shotSegmentIndex(view, this.ports.seconds()) : 0;
  }

  private drawSegments(
    context: CanvasRenderingContext2D,
    rows: { pos: number[]; s: number }[],
    activeIndex: number,
    parts: ShotRange[],
    clip: (pos: number[]) => [number, number, number, number],
    screen: (p: number[]) => number[],
  ): void {
    let color = '',
      index = 0;
    context.lineWidth = 3;
    context.beginPath();
    for (let i = 1; i < rows.length; i++) {
      const seconds = (rows[i - 1].s + rows[i].s) / 2;
      while (index + 1 < parts.length && seconds >= parts[index + 1].start) index++;
      const rgb = SEGMENT_COLORS[index % SEGMENT_COLORS.length];
      const next =
        index === activeIndex
          ? '#ffd359'
          : `rgb(${rgb
              .slice(0, 3)
              .map((n) => Math.round(n * 255))
              .join(' ')})`;
      if (next !== color) {
        context.stroke();
        context.beginPath();
        context.strokeStyle = next;
        color = next;
      }
      const a = clip(rows[i - 1].pos),
        b = clip(rows[i].pos),
        bounds = clipSegment(a, b);
      if (!bounds) continue;
      const at = (t: number): number[] => screen(a.map((n, axis) => n + (b[axis] - n) * t));
      const end = at(bounds[1]),
        start = at(bounds[0]);
      context.moveTo(start[0], start[1]);
      context.lineTo(end[0], end[1]);
    }
    context.stroke();
  }
  private async export(): Promise<void> {
    if (this.busy || !this.plan || !this.track) return;
    const note = this.node('shotExportNote');
    const views =
      this.plan.mode === 'sequence'
        ? [this.plan.sequence]
        : SHOT_KINDS.filter((kind) => this.plan!.selected.has(kind)).map((kind) => this.plan!.views[kind]);
    if (
      !validShotRange(this.plan.range, this.track.duration) ||
      !views.length ||
      views.some((view) => !view || !validShotProgram(view, this.track!.duration, this.plan!.range))
    ) {
      note.textContent = '请设置有效起止时间，勾选镜头，并为每个勾选镜头保存或推荐机位。';

      return;
    }
    this.ports.stopPreview();
    this.armed = null;
    this.busy = true;
    this.node<HTMLFieldSetElement>('shotEditor').disabled = true;
    this.node<HTMLButtonElement>('shotExport').disabled = true;
    try {
      await this.ports.export(
        structuredClone(views as ShotProgram[]),
        { ...this.plan.range },
        note,
        this.node('shotResults'),
        this.node<HTMLButtonElement>('shotCancel'),
      );
    } catch (error) {
      note.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      this.node<HTMLFieldSetElement>('shotEditor').disabled = !this.track;
      this.node<HTMLButtonElement>('shotExport').disabled = !this.track;
      this.node<HTMLButtonElement>('shotCancel').hidden = true;
    }
  }

  private async loadPlan(): Promise<void> {
    const input = this.node<HTMLInputElement>('shotPlanFile'),
      file = input.files?.[0],
      track = this.track;
    input.value = '';
    if (!file || !track || this.busy) return;
    try {
      if (file.size > 128 * 1024) throw new Error('方案文件过大。');
      const parsed: unknown = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== 'object') throw new Error('方案文件格式无效。');
      const value = parsed as Record<string, unknown>;
      const range = value.range as ShotRange | undefined;
      const views = value.views as Record<string, unknown> | undefined;
      const selected = value.selected;
      if (this.track !== track || this.busy) throw new Error('录像已切换，请重新载入方案。');
      if (value.version !== 1 || value.recording !== shotRecordingId(track))
        throw new Error('方案与当前录像不匹配，请先载入对应录像。');
      if (
        (value.mode !== undefined && value.mode !== 'batch' && value.mode !== 'sequence') ||
        (value.sequence !== undefined && !validShotSequence(value.sequence, track.duration, range)) ||
        (value.mode === 'sequence' && !value.sequence) ||
        !range ||
        !validShotRange(range, track.duration) ||
        !Array.isArray(selected) ||
        !selected.every((kind: unknown) => typeof kind === 'string' && SHOT_KINDS.includes(kind as ShotKind)) ||
        !views ||
        typeof views !== 'object' ||
        Array.isArray(views) ||
        Object.entries(views).some(
          ([kind, view]) =>
            !SHOT_KINDS.includes(kind as ShotKind) ||
            !validShotView(view) ||
            !validShotForTrack(view, track.duration) ||
            view.kind !== kind,
        )
      )
        throw new Error('方案中的时间范围或机位参数无效。');
      this.ports.stopPreview();
      this.armed = null;
      this.plan = {
        mode: value.mode,
        range: { ...range },
        selected: new Set(selected as ShotKind[]),
        sequence: value.sequence,
        views: views,
      };
      this.plans.set(track, this.plan);
      this.refreshRange();
      this.refreshCards();
      this.message('已恢复此录像的时间范围、镜头勾选和保存机位。');
    } catch (error) {
      this.message(error instanceof Error ? error.message : String(error));
    }
  }
  private makeCard(kind: ShotKind): void {
    const card = document.createElement('section');
    card.className = 'shot-card';
    card.id = `shot-${kind}`;
    card.innerHTML = `<label class="shot-title"><input id="shotCheck-${kind}" type="checkbox" /> ${SHOT_LABELS[kind]} <span class="small shot-saved"></span></label>
      <p class="small">${guidance[kind]}</p><div class="shot-actions"><button type="button" data-action="place">布置</button><button type="button" data-action="save">保存当前机位</button><button type="button" data-action="diagram">查看 3D 图示</button></div>
      ${kind !== 'cockpit' ? '<div class="shot-segments"></div>' : ''}
      <div class="shot-actions shot-preview"><span class="small">预览</span><button type="button" data-at="0">起点</button><button type="button" data-at="0.5">中点</button><button type="button" data-at="1">终点</button><button type="button" data-at="play">播放选段</button><button type="button" data-action="stop" hidden>结束预览</button></div>`;
    this.node('shotCards').append(card);
    this.cards.set(kind, card);
    card.querySelector<HTMLButtonElement>('[data-action="stop"]')!.onclick = () => this.ports.stopPreview();
    card.querySelector<HTMLInputElement>('input')!.onchange = (event): void => {
      if (!this.plan) return;
      if ((event.target as HTMLInputElement).checked) this.plan.selected.add(kind);
      else this.plan.selected.delete(kind);
    };
    card.querySelector<HTMLButtonElement>('[data-action="place"]')!.onclick = (): void => {
      if (!this.track || !this.plan) return;
      const view = this.plan.views[kind] ?? recommendShots(this.track, this.plan.range)[kind];
      this.diagramKind = kind;
      this.placedView = structuredClone(view);
      this.ports.stopPreview();
      this.ports.place(structuredClone(view));
      this.message(`正在布置${SHOT_LABELS[kind]}。调整后请点此镜头的“保存当前机位”。`);
    };
    card.querySelector<HTMLButtonElement>('[data-action="save"]')!.onclick = (): void => {
      if (!this.plan) return;
      try {
        const captured = this.ports.capture(kind),
          previous = this.plan.views[kind];
        if (captured.kind !== 'cockpit' && previous && previous.kind !== 'cockpit' && previous.segments && this.track)
          saveShotSegment(previous, captured, this.track, this.ports.seconds());
        else this.plan.views[kind] = captured;
        this.diagramKind = kind;
        this.placedView = null;
        this.refreshCards();
        this.message(`${SHOT_LABELS[kind]}已保存。`);
      } catch (error) {
        this.message(error instanceof Error ? error.message : String(error));
      }
    };
    card.querySelector<HTMLButtonElement>('[data-action="diagram"]')!.onclick = (): void => {
      const view = this.plan?.views[kind] ?? (this.placedView?.kind === kind ? this.placedView : null);
      if (!view) {
        this.message('请先布置并保存，或推荐此镜头的机位。');

        return;
      }
      this.ports.stopPreview();
      this.diagramKind = kind;
      this.node<HTMLInputElement>('shotDiagramToggle').checked = true;
      this.ports.inspect(structuredClone(view));
      this.message(
        `正在从外侧观察${SHOT_LABELS[kind]}；橙色为摄像头，青色为 16:9 视锥。移动观察视角不会改变已保存机位。`,
      );
    };
    for (const button of card.querySelectorAll<HTMLButtonElement>('[data-at]'))
      button.onclick = (): void => {
        const range = this.plan?.range,
          view = this.plan?.views[kind];
        if (!view || !range || !this.track || !validShotRange(range, this.track.duration)) {
          this.message('请先设置有效时间范围，并保存或推荐此镜头的机位。');

          return;
        }
        const play = button.dataset.at === 'play';
        this.ports.preview(
          structuredClone(view),
          play ? range.start : range.start + (range.end - range.start) * Number(button.dataset.at),
          play ? range.end : undefined,
        );
      };
  }

  private message(value: string): void {
    this.node('shotRangeNote').textContent = value;
  }

  private node<T extends HTMLElement = HTMLElement>(id: string): T {
    return this.element.querySelector(`#${id}`) as T;
  }

  private refreshCards(): void {
    for (const [kind, card] of this.cards) {
      card.querySelector<HTMLInputElement>('input')!.checked = this.plan?.selected.has(kind) ?? false;
      const view = this.plan?.views[kind];
      card.querySelector('.shot-saved')!.textContent = view ? '已保存' : '未保存';
      const editor = card.querySelector<HTMLElement>('.shot-segments');
      if (editor) {
        editor.replaceChildren();
        if (view && view.kind !== 'cockpit') this.refreshSegmentEditor(editor, view);
      }
    }
  }

  private refreshMode(): void {
    const sequence = this.plan?.mode === 'sequence';
    this.node('shotPlacementGuide').textContent = sequence
      ? '在进度条或迹线上选择切点，按“在当前时间分段”，为各段选择镜头。推荐机位可用“布置本段 → 鼠标/键盘调整 → 保存本段机位”修改。导出隐藏辅助图示。'
      : '推荐机位是可调整的初稿。点“布置”进入对应视角，移动后点“保存当前机位”；片段导出隐藏迹线和选段标记。';
    this.node('shotCards').hidden = sequence;
    this.node('shotBatchActions').hidden = sequence;
    this.node('shotSequenceEditor').hidden = !sequence;
    this.node('shotModeBatch').setAttribute('aria-pressed', String(!sequence));
    this.node('shotModeSequence').setAttribute('aria-pressed', String(sequence));
    this.node('shotExport').textContent = sequence ? '导出编排 MP4' : '批量导出独立 MP4';
    if (sequence && this.plan?.sequence && this.track) this.sequenceEditor.draw(this.plan.sequence, this.track);
  }

  private refreshRange(): void {
    const duration = this.track?.duration ?? 0,
      range = this.plan?.range ?? { end: 0, start: 0 };
    for (const bound of ['start', 'end'] as const) {
      this.node(bound === 'start' ? 'shotStart' : 'shotEnd').textContent = `${range[bound].toFixed(3)} s`;
      this.node(bound === 'start' ? 'shotPickStart' : 'shotPickEnd').setAttribute(
        'aria-pressed',
        String(this.armed === bound),
      );
    }
    const bar = this.node('shotRangeBar').firstElementChild as HTMLElement;
    bar.style.left = `${duration ? (range.start / duration) * 100 : 0}%`;
    bar.style.width = `${duration ? (Math.max(0, range.end - range.start) / duration) * 100 : 0}%`;
    this.message(
      this.armed
        ? `请在自由视角迹线上点击${this.armed === 'start' ? '起点 A' : '终点 B'}；拖动仍用于移动相机。`
        : !this.track
          ? '请先载入录像。'
          : !validShotRange(range, duration)
            ? '终点必须晚于起点。请调整时间。'
            : `A ${range.start.toFixed(3)} s → B ${range.end.toFixed(3)} s · 片长 ${(range.end - range.start).toFixed(3)} s`,
    );
    this.overlayKey = '';
    if (this.plan?.sequence && validShotRange(range, duration)) {
      const clips = this.plan.sequence.clips;
      if (clips[0].start !== range.start || clips[clips.length - 1].end !== range.end)
        this.plan.sequence = resizeShotSequence(this.plan.sequence, range);
    }
    this.refreshMode();
  }

  private refreshSegmentEditor(editor: HTMLElement, view: ExteriorShotView): void {
    if (!this.track || !this.plan) return;
    shotSegmentEditor(
      editor,
      view,
      this.plan.range,
      () => this.ports.seconds(),
      (text) => this.message(text),
      () => {
        this.ports.stopPreview();
        this.diagramKind = view.kind;
        this.refreshCards();
      },
      (seconds) => this.ports.preview(structuredClone(view), seconds),
      (seconds) => {
        this.ports.stopPreview();
        this.diagramKind = view.kind;
        this.node<HTMLInputElement>('shotDiagramToggle').checked = true;
        this.ports.seek(seconds);
        this.message(`已定位到所选分段 ${seconds.toFixed(3)} s，并刷新图示；保留当前观察视角。`);
      },
    );
  }

  private setBound(bound: 'end' | 'start', seconds: number): void {
    if (!this.plan || !this.track || !Number.isFinite(seconds)) {
      this.refreshRange();

      return;
    }
    this.ports.stopPreview();
    this.plan.range[bound] = Math.max(0, Math.min(this.track.duration, seconds));
    this.refreshRange();
  }
}
