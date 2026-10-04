import type { OfflineRenderResult } from './audio-offline';
import type { ShotRange } from './shot-camera';

import { encodeWavPcm16 } from './audio-offline';

/** Crop after mixing the original prefix, preserving loop phase, filters and reverb at the clip's start. */
export function cropShotAudio(
  result: Pick<OfflineRenderResult, 'channels' | 'pcm' | 'sampleRateHz'>,
  range: ShotRange,
): Uint8Array {
  const first = Math.round(range.start * result.sampleRateHz) * result.channels;
  const pcm = new Int16Array(Math.round((range.end - range.start) * result.sampleRateHz) * result.channels);
  pcm.set(result.pcm.subarray(first, first + pcm.length));

  return encodeWavPcm16(pcm, result.sampleRateHz, result.channels);
}
