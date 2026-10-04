import { describe, expect, it } from 'vitest';

import { DEFAULT_AUDIO_MIX_TUNING, normalizeAudioMixTuning } from './audio-tuning';

describe('local audio mix presets', () => {
  it('keeps the previous inferred mix when no custom values exist', () => {
    expect(normalizeAudioMixTuning(null)).toEqual(DEFAULT_AUDIO_MIX_TUNING);
  });

  it('clamps malformed saved values before they can reach a renderer', () => {
    const result = normalizeAudioMixTuning({
      front: 99,
      jetDistance: -2,
      pitch: Infinity,
      powerDynamics: 5,
      presenceHighHz: 1,
    });
    expect(result.front).toBe(2);
    expect(result.jetDistance).toBe(0);
    expect(result.pitch).toBe(1);
    expect(result.powerDynamics).toBe(2);
    expect(result.presenceHighHz).toBe(200);
  });
});
