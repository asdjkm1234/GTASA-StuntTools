import type { FlightTrack } from './csv';
import type { ExteriorShotView, ShotRange, ShotSegment } from './shot-camera';

import { segmentInspectTime, SHOT_LABELS, shotHeading, shotSegmentIndex } from './shot-camera';

const selections = new WeakMap<ExteriorShotView, number>();

/** Save an actual placed camera into the segment at the current capture time, preserving other segments. */
export function saveShotSegment(
  view: ExteriorShotView,
  captured: ExteriorShotView,
  track: FlightTrack,
  seconds: number,
): void {
  if (!view.segments?.length || view.kind !== captured.kind) return;
  const index = shotSegmentIndex(view, seconds);
  if (view.kind === 'follow' && captured.kind === 'follow') {
    const part = view.segments[index];
    part.offset = [...captured.offset];
    part.fovYDeg = captured.fovYDeg;
    if (part.heading === 'world') {
      const [right, ahead, height] = captured.offset,
        yaw = shotHeading(track, seconds);
      part.offset = [
        right * Math.cos(yaw) + ahead * Math.sin(yaw),
        ahead * Math.cos(yaw) - right * Math.sin(yaw),
        height,
      ];
    }
  } else if (view.kind !== 'follow' && captured.kind !== 'follow') {
    const part = view.segments[index];
    part.position = [...captured.position];
    part.yaw = captured.yaw;
    part.pitch = captured.pitch;
    part.fovYDeg = captured.fovYDeg;
  }
  selections.set(view, index);
}

export function shotSegmentEditor(
  container: HTMLElement,
  view: ExteriorShotView,
  range: ShotRange,
  seconds: () => number,
  message: (text: string) => void,
  changed: () => void,
  preview: (seconds: number) => void,
  select: (seconds: number) => void,
): void {
  const draw = (): void => {
    container.replaceChildren();
    const button = (text: string, action: () => void): void => {
      const node = document.createElement('button');
      node.type = 'button';
      node.textContent = text;
      node.onclick = action;
      container.append(node);
    };
    if (!view.segments?.length) {
      button(`启用分段${SHOT_LABELS[view.kind]}`, () => {
        if (range.end <= range.start) {
          message('请先设置有效的起止时间。');

          return;
        }
        if (view.kind === 'follow')
          view.segments = [
            { ...range, fovYDeg: view.fovYDeg, heading: 'aircraft', offset: [...view.offset], transition: 0 },
          ];
        else
          view.segments = [
            {
              ...range,
              fovYDeg: view.fovYDeg,
              pitch: view.pitch,
              position: [...view.position],
              transition: 0,
              yaw: view.yaw,
            },
          ];
        selections.set(view, 0);
        changed();
        draw();
      });

      return;
    }
    const parts: ShotSegment[] = view.segments;
    const index = Math.min(parts.length - 1, selections.get(view) ?? shotSegmentIndex(view, seconds())),
      part = parts[index];
    const list = document.createElement('select');
    list.dataset.field = 'segment';
    list.setAttribute('aria-label', `选择${SHOT_LABELS[view.kind]}分段`);
    parts.forEach((item, i) => {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = `第 ${i + 1} 段：${item.start.toFixed(3)} → ${item.end.toFixed(3)} s`;
      list.append(option);
    });
    list.value = String(index);
    list.onchange = () => {
      const selected = Number(list.value);
      selections.set(view, selected);
      select(segmentInspectTime(parts[selected]));
      draw();
    };
    container.append(list);
    const split = (time: number): void => {
      if (parts.length >= 64 || time <= part.start + 0.01 || time >= part.end - 0.01) {
        message('分段时间须位于当前段内部，最多 64 段。');

        return;
      }
      const next = { ...structuredClone(part), start: time, transition: Math.min(1, part.end - time) };
      part.end = time;
      part.transition = Math.min(part.transition, part.end - part.start);
      parts.splice(index + 1, 0, next);
      selections.set(view, index + 1);
      changed();
      select(segmentInspectTime(next));
      draw();
    };
    button('在当前播放时间分段', () => split(seconds()));
    button('将当前段等分', () => split((part.start + part.end) / 2));
    button('预览本段', () => preview(segmentInspectTime(part)));
    button('删除当前段', () => {
      if (parts.length === 1) delete view.segments;
      else {
        if (index) parts[index - 1].end = part.end;
        else parts[1].start = part.start;
        parts.splice(index, 1);
        selections.set(view, Math.max(0, index - 1));
      }
      changed();
      if (view.segments?.length) select(segmentInspectTime(view.segments[Math.max(0, index - 1)]));
      draw();
    });
    button(`恢复单段${view.kind === 'follow' ? '伴飞' : SHOT_LABELS[view.kind]}`, () => {
      delete view.segments;
      changed();
      draw();
    });
    const hint = document.createElement('p');
    hint.className = 'small';
    hint.textContent =
      '选择分段后点“布置”，用鼠标和键盘调整，再点“保存当前机位”。只更新当前播放时间所在段；新建的后续段自动平滑转入。';
    container.append(hint);
  };
  draw();
}
