import type { FlightTrack } from './csv';
import type { ShotKind, ShotRange, ShotView } from './shot-camera';
import type { ShotClip, ShotSequence } from './shot-sequence';

import { recommendShots, SHOT_KINDS, SHOT_LABELS } from './shot-camera';
import { sequenceIndex } from './shot-sequence';

interface SequencePorts {
  capture(kind: ShotKind): ShotView;
  changed(): void;
  inspect(): void;
  message(text: string): void;
  place(view: ShotView): void;
  preview(sequence: ShotSequence, seconds: number, end?: number): void;
  seconds(): number;
  select(seconds: number): void;
  stop(): void;
}
const selections = new WeakMap<ShotSequence, number>();
export class ShotSequenceEditor {
  private previewing = false;
  constructor(
    private readonly container: HTMLElement,
    private readonly ports: SequencePorts,
  ) {}
  draw(sequence: ShotSequence, track: FlightTrack): void {
    const clips = sequence.clips,
      index = Math.min(clips.length - 1, selections.get(sequence) ?? sequenceIndex(sequence, this.ports.seconds())),
      clip = clips[index];
    this.container.innerHTML = `<p class="small">每段选一种镜头，连续播放后导出一个 MP4。切换直接剪切，录像和音频不中断。</p>
      <div id="shotSequenceTimeline" aria-label="镜头编排时间轴"></div>
      <label class="small">选择分段<select id="shotSequenceClip" aria-label="选择编排分段"></select></label>
      <label class="small">本段镜头<select id="shotSequenceKind" aria-label="本段镜头类型"></select></label>
      <div class="shot-actions"><button id="shotSequenceSplit" type="button">在当前时间分段</button><button id="shotSequenceEqual" type="button">将当前段等分</button><button id="shotSequenceDelete" type="button">删除当前段</button></div>
      <div class="shot-actions"><button id="shotSequencePlace" type="button">布置本段</button><button id="shotSequenceSave" type="button">保存本段机位</button><button id="shotSequenceDiagram" type="button">查看 3D 图示</button></div>
      <p class="small">${SHOT_LABELS[clip.view.kind]} · ${clip.start.toFixed(3)}–${clip.end.toFixed(3)} s。选段保留观察视角，布置后用鼠标和键盘调整，再保存本段。</p>
      <p class="small">${clip.view.kind === 'fixed' ? '放在航迹侧面，转动镜头让飞行动作经过画面。' : clip.view.kind === 'tracking' ? '选择地面或空中观察点，相机会自动看向飞机。' : clip.view.kind === 'follow' ? '移到飞机侧面、前方或后方，再保存；机位随航向移动。' : '拖动调整舱内方向，用 WASD / 空格 / Shift 调整眼位。'}</p>
      <div class="shot-actions"><button id="shotSequencePreview" type="button">预览本段</button><button id="shotSequencePlayClip" type="button">播放本段</button><button id="shotSequencePlay" type="button">播放完整编排</button><button id="shotSequenceStop" type="button" ${this.previewing ? '' : 'hidden'}>结束预览</button></div>`;
    const node = <T extends HTMLElement>(id: string): T => this.container.querySelector('#' + id) as T;
    const select = (selected: number): void => {
      selections.set(sequence, selected);
      this.ports.select(this.middle(clips[selected]));
      this.draw(sequence, track);
    };
    const list = node<HTMLSelectElement>('shotSequenceClip');
    clips.forEach((part, i) => {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = `第 ${i + 1} 段 · ${part.start.toFixed(3)}–${part.end.toFixed(3)} s · ${SHOT_LABELS[part.view.kind]}`;
      list.append(option);
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.clip = String(i);
      button.textContent = `${i + 1} · ${SHOT_LABELS[part.view.kind]}\n${part.start.toFixed(2)}–${part.end.toFixed(2)} s`;
      button.style.flexGrow = String(part.end - part.start);
      button.setAttribute('aria-pressed', String(i === index));
      button.onclick = () => select(i);
      node('shotSequenceTimeline').append(button);
    });
    list.value = String(index);
    list.onchange = () => select(Number(list.value));
    const kinds = node<HTMLSelectElement>('shotSequenceKind');
    for (const kind of SHOT_KINDS) {
      const option = document.createElement('option');
      option.value = kind;
      option.textContent = SHOT_LABELS[kind];
      kinds.append(option);
    }
    kinds.value = clip.view.kind;
    kinds.onchange = () => {
      clip.view = recommendShots(track, clip)[kinds.value as ShotKind];
      this.ports.changed();
      select(index);
      this.ports.message('已为本段设置推荐机位，可布置后保存；当前观察视角保持不变。');
    };
    const button = (id: string, action: () => void): void => {
      node<HTMLButtonElement>(id).onclick = () => {
        try {
          action();
        } catch (error) {
          this.ports.message(error instanceof Error ? error.message : String(error));
        }
      };
    };
    const split = (time: number): void => {
      if (clips.length >= 64 || time <= clip.start + 0.01 || time >= clip.end - 0.01) {
        this.ports.message('请把进度拖到本段内部再分段，最多 64 段。');

        return;
      }
      const next = { end: clip.end, start: time, view: structuredClone(clip.view) };
      clip.end = time;
      clips.splice(index + 1, 0, next);
      selections.set(sequence, index + 1);
      this.ports.changed();
      select(index + 1);
    };
    button('shotSequenceSplit', () => split(this.ports.seconds()));
    button('shotSequenceEqual', () => split(this.middle(clip)));
    button('shotSequenceDelete', () => {
      if (clips.length === 1) {
        this.ports.message('至少保留一段镜头。');

        return;
      }
      if (index) clips[index - 1].end = clip.end;
      else clips[1].start = clip.start;
      clips.splice(index, 1);
      selections.set(sequence, Math.max(0, index - 1));
      this.ports.changed();
      select(Math.max(0, index - 1));
    });
    button('shotSequencePlace', () => {
      this.ports.select(this.editTime(clip));
      this.ports.place(structuredClone(clip.view));
    });
    button('shotSequenceSave', () => {
      const seconds = this.ports.seconds();
      if (seconds < clip.start || seconds > clip.end || (seconds === clip.end && index + 1 < clips.length)) {
        this.ports.message('请先选择或布置本段，再保存机位。');

        return;
      }
      clip.view = this.ports.capture(clip.view.kind);
      this.ports.changed();
      this.draw(sequence, track);
      this.ports.message('已保存本段机位，其他段保持不变。');
    });
    button('shotSequenceDiagram', () => this.ports.inspect());
    button('shotSequencePreview', () => this.ports.preview(structuredClone(sequence), this.middle(clip)));
    button('shotSequencePlayClip', () => this.ports.preview(structuredClone(sequence), clip.start, clip.end));
    button('shotSequencePlay', () =>
      this.ports.preview(structuredClone(sequence), clips[0].start, clips[clips.length - 1].end),
    );
    button('shotSequenceStop', () => this.ports.stop());
  }
  setPreview(active: boolean): void {
    this.previewing = active;
    const stop = this.container.querySelector<HTMLButtonElement>('#shotSequenceStop');
    if (stop) stop.hidden = !active;
  }
  private editTime(clip: ShotClip): number {
    const time = this.ports.seconds();

    return time >= clip.start && time < clip.end ? time : this.middle(clip);
  }
  private middle(clip: ShotRange): number {
    return (clip.start + clip.end) / 2;
  }
}
