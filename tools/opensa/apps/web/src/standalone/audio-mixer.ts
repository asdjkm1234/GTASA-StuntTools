import type { AudioMixTuning } from '../flight/audio-tuning';

import { AUDIO_MIX_TUNING_LIMITS, DEFAULT_AUDIO_MIX_TUNING, normalizeAudioMixTuning } from '../flight/audio-tuning';

export type AudioMixModel = 476 | 520;

interface SliderSpec {
  readonly key: TuningKey;
  readonly label: string;
  readonly step: number;
  readonly tip: string;
}
type TuningKey = keyof AudioMixTuning;

const STORAGE_KEY = 'flight-replay-audio-mix-v2';
const LEGACY_STORAGE_KEY = 'flight-replay-audio-mix-v1';
const COMMON: readonly SliderSpec[] = [
  { key: 'master', label: '发动机响度', step: 0.05, tip: '仅调整合成发动机；录制 WAV 和碰撞声不变' },
  { key: 'pitch', label: '发动机音高', step: 0.01, tip: '全部发动机声层的播放速率' },
];
const HYDRA: readonly SliderSpec[] = [
  {
    key: 'powerDynamics',
    label: '油门响度变化',
    step: 0.05,
    tip: 'W、松开和 S 之间的响度差；1.00× 为当前推断基准，0.00× 关闭此响度变化，不改变音高或声源',
  },
  { key: 'front', label: '前喷气 HARRIER_FRONT', step: 0.05, tip: '游戏 Hydra 路径调用的 VEHICLE_GEN 声音 10' },
  { key: 'frontPitch', label: '前喷气音高', step: 0.01, tip: '仅改变 HARRIER_FRONT 的播放速率' },
  { key: 'rear', label: '后喷气 HARRIER_REAR', step: 0.05, tip: '游戏 Hydra 路径调用的 VEHICLE_GEN 声音 11' },
  { key: 'rearPitch', label: '后喷气音高', step: 0.01, tip: '仅改变 HARRIER_REAR 的播放速率' },
  { key: 'turbine', label: '喷气主体 THRUST', step: 0.05, tip: '原始 THRUST 声层的响度' },
  { key: 'turbinePitch', label: 'THRUST 音高', step: 0.01, tip: '单独改变 THRUST 声层的播放速率' },
  { key: 'presence', label: 'THRUST 中频补偿', step: 0.05, tip: '实验性 THRUST 滤波支路；新基准关闭' },
  { key: 'presenceHighHz', label: '中频下限', step: 50, tip: '向上调可减少低频呜声' },
  { key: 'presenceLowHz', label: '中频上限', step: 100, tip: '向下调可减弱高频锐利感' },
  {
    key: 'jetDistance',
    label: 'JET_DIST 近场混入',
    step: 0.05,
    tip: '游戏有调用；原程序给 Hydra 的静态基础电平为 -100 dB，近场基准关闭',
  },
  { key: 'jetDistancePitch', label: '远景喷气音高', step: 0.01, tip: '仅对 JET_DIST 生效' },
];
const RUSTLER: readonly SliderSpec[] = [
  { key: 'front', label: '前螺旋桨 FRONT', step: 0.05, tip: 'FASTPROP FRONT 原始声层' },
  { key: 'frontPitch', label: 'FRONT 音高', step: 0.01, tip: '单独改变前螺旋桨播放速率' },
  { key: 'rear', label: '后螺旋桨 REAR', step: 0.05, tip: 'FASTPROP REAR 原始声层' },
  { key: 'rearPitch', label: 'REAR 音高', step: 0.01, tip: '单独改变后螺旋桨播放速率' },
  { key: 'near', label: '近场 PROP_NEAR', step: 0.05, tip: 'VEHICLE_GEN 近场螺旋桨声层' },
  { key: 'nearPitch', label: 'PROP_NEAR 音高', step: 0.01, tip: '单独改变近场螺旋桨播放速率' },
  { key: 'propDistance', label: '远场 PROP_DIST', step: 0.05, tip: '远离飞机时的螺旋桨声层' },
  { key: 'propDistancePitch', label: 'PROP_DIST 音高', step: 0.01, tip: '单独改变远场螺旋桨播放速率' },
];

/** Local-only controls for the inferred mix; no game bytes or recordings are stored. */
export class AudioMixer {
  private model: AudioMixModel = 520;
  private readonly profiles: Record<AudioMixModel, AudioMixTuning>;

  constructor(
    private readonly host: HTMLElement,
    private readonly onChange: (model: AudioMixModel, tuning: AudioMixTuning) => void,
  ) {
    this.profiles = loadProfiles();
    this.host.querySelector<HTMLButtonElement>('#audioMixerReset')?.addEventListener('click', () => {
      this.profiles[this.model] = { ...DEFAULT_AUDIO_MIX_TUNING };
      this.save();
      this.render();
      this.onChange(this.model, this.profiles[this.model]);
    });
    this.host.querySelector<HTMLButtonElement>('#audioMixerClose')?.addEventListener('click', () => {
      this.host.hidden = true;
    });
    this.host.querySelector<HTMLButtonElement>('#audioMixerCopy')?.addEventListener('click', () => {
      void this.copyReport();
    });
    this.render();
  }

  get(model: number): AudioMixTuning {
    return this.profiles[model === 476 ? 476 : 520];
  }

  setModel(model: number): void {
    const next = model === 476 ? 476 : 520;
    if (next !== this.model) {
      this.model = next;
      this.render();
    }
  }

  toggle(): void {
    this.host.hidden = !this.host.hidden;
    if (!this.host.hidden) this.host.scrollTop = 0;
  }

  private async copyReport(): Promise<void> {
    const modelName = this.model === 520 ? 'Hydra 520' : 'Rustler 476';
    const specs = [...COMMON, ...(this.model === 520 ? HYDRA : RUSTLER)];
    const lines = specs.map(
      (spec) => `${spec.label} (${spec.key}) = ${formatValue(spec.key, this.profiles[this.model][spec.key])}`,
    );
    const report = [
      `GTASA Flight Replay 音频调音参数 v2 · ${modelName}`,
      ...lines,
      JSON.stringify({ model: this.model, tuning: this.profiles[this.model] }),
    ].join('\n');
    const area = this.host.querySelector<HTMLTextAreaElement>('#audioMixerReport');
    if (area) {
      area.value = report;
      area.hidden = false;
    }
    const button = this.host.querySelector<HTMLButtonElement>('#audioMixerCopy');
    try {
      await navigator.clipboard.writeText(report);
      if (button) button.textContent = '已复制';
    } catch {
      area?.focus();
      area?.select();
      if (button) button.textContent = '请复制下方文本';
    }
  }

  private render(): void {
    const title = this.host.querySelector<HTMLElement>('#audioMixerModel');
    const rows = this.host.querySelector<HTMLElement>('#audioMixerRows');
    if (!title || !rows) return;
    const report = this.host.querySelector<HTMLTextAreaElement>('#audioMixerReport');
    if (report) report.hidden = true;
    const copy = this.host.querySelector<HTMLButtonElement>('#audioMixerCopy');
    if (copy) copy.textContent = '复制参数';
    title.textContent = this.model === 520 ? 'Hydra 520' : 'Rustler 476';
    rows.replaceChildren();
    for (const spec of [...COMMON, ...(this.model === 520 ? HYDRA : RUSTLER)]) {
      const [minimum, maximum] = AUDIO_MIX_TUNING_LIMITS[spec.key];
      const label = document.createElement('label');
      label.className = 'audio-mixer__row';
      label.title = spec.tip;
      const heading = document.createElement('span');
      heading.textContent = spec.label;
      const value = document.createElement('output');
      const slider = document.createElement('input');
      slider.id = `audioTune-${spec.key}`;
      slider.type = 'range';
      slider.min = String(minimum);
      slider.max = String(maximum);
      slider.step = String(spec.step);
      slider.value = String(this.profiles[this.model][spec.key]);
      value.textContent = formatValue(spec.key, Number(slider.value));
      slider.addEventListener('input', () => {
        const updated = normalizeAudioMixTuning({ ...this.profiles[this.model], [spec.key]: Number(slider.value) });
        this.profiles[this.model] = updated;
        value.textContent = formatValue(spec.key, updated[spec.key]);
        if (report) report.hidden = true;
        if (copy) copy.textContent = '复制参数';
        this.save();
        this.onChange(this.model, updated);
      });
      label.append(heading, value, slider);
      rows.append(label);
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.profiles));
    } catch {
      // Live tuning still works when local storage is disabled.
    }
  }
}

function formatValue(key: TuningKey, value: number): string {
  if (key === 'presenceHighHz' || key === 'presenceLowHz') return `${value.toFixed(0)} Hz`;

  return key === 'presence' || key === 'jetDistance' ? value.toFixed(2) : `${value.toFixed(2)}×`;
}

function loadProfiles(): Record<AudioMixModel, AudioMixTuning> {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current) {
      const stored = JSON.parse(current) as Record<string, unknown>;

      return { 476: normalizeAudioMixTuning(stored['476']), 520: normalizeAudioMixTuning(stored['520']) };
    }
    // Keep an existing Rustler profile. Older Hydra settings targeted WHINE/LIFT and cannot describe the
    // corrected four-source mix; leave them in the v1 key for reference and start Hydra from the new baseline.
    const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) ?? '{}') as Record<string, unknown>;

    return { 476: normalizeAudioMixTuning(legacy['476']), 520: normalizeAudioMixTuning(null) };
  } catch {
    return { 476: normalizeAudioMixTuning(null), 520: normalizeAudioMixTuning(null) };
  }
}
