/**
 * Bridge between the baked pak's GENRL WAV lane and the offline PCM renderer (`audio-offline.ts`).
 *
 * The baker ships canonical 16-bit PCM RIFF/WAVE files (see `scripts/bake-map.mts`), one per manifest entry;
 * the offline renderer wants decoded mono Float32 frames. This module is the only place that knows the pak's
 * byte layout, so `audio-offline.ts` stays byte-agnostic and its tests can pass synthetic samples.
 *
 * `createOfflineSampleBank` decodes every manifest entry eagerly and returns the
 * `OfflineSampleBank` the renderer consumes. A malformed sample THROWS rather than being skipped: a partial bank
 * would silently drop a layer, and "no audio" must never look like "correct audio".
 */
import type { AudioBankManifest } from './audio-engine';
import type { OfflineSample, OfflineSampleBank } from './audio-offline';
import type { PakAudioManifest, PakResources } from './pak-resources';

/** A canonical WAV header (RIFF + fmt + data) is at least 44 bytes; anything shorter is not a PCM WAV. */
const WAV_MIN_BYTES = 44;
/** RIFF `WAVE` format tag 1 is linear PCM. */
const PCM_FORMAT_TAG = 1;
const WAV_CHUNK_HEADER_BYTES = 8;

interface DecodeOptions {
  readonly loop: boolean;
  readonly loopStartFrame: number;
}

/**
 * The pak manifest carries `loopStartFrame: number | null`; the core wants a number. `null` (no loop point)
 * maps to frame 0 — a projection, not a measurement (same rule as `audio-engine-web.ts`).
 */
export function coreManifestFromPak(manifest: PakAudioManifest): AudioBankManifest {
  return {
    samples: manifest.samples.map((sample) => ({ ...sample, loopStartFrame: sample.loopStartFrame ?? 0 })),
    source: manifest.source ?? 'map-pak/audio/manifest.json',
    version: manifest.version,
  };
}

/**
 * Decode every sample the pak's audio manifest lists into an `OfflineSampleBank`. Engine samples loop; sets and
 * one-shots do not. Every collision file is a separate original bank member, selected by its real sound ID.
 */
export function createOfflineSampleBank(resources: PakResources): OfflineSampleBank {
  const manifest = resources.getAudioManifest();
  const samples = new Map<string, OfflineSample>();
  for (const entry of manifest?.samples ?? []) {
    const bytes = resources.getAudioSample(entry.file);
    if (!bytes || bytes.byteLength < WAV_MIN_BYTES) {
      continue;
    }
    samples.set(
      entry.file,
      decodePcmWavSample(bytes, {
        loop: entry.category.startsWith('engine '),
        loopStartFrame: entry.loopStartFrame ?? 0,
      }),
    );
  }

  return { get: (file) => samples.get(file) ?? null };
}

/**
 * Decode one canonical 16-bit PCM RIFF/WAVE into mono Float32 frames. Multichannel input is averaged to mono
 * (the renderer's sample contract is mono); a non-PCM or non-16-bit layout throws instead of guessing.
 */
export function decodePcmWavSample(bytes: Uint8Array, options: DecodeOptions): OfflineSample {
  if (bytes.byteLength < WAV_MIN_BYTES || readAscii(bytes, 0, 4) !== 'RIFF' || readAscii(bytes, 8, 12) !== 'WAVE') {
    throw new Error('baked audio sample is not a RIFF/WAVE file');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format = 0;
  let channels = 0;
  let sampleRateHz = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataBytes = 0;
  let offset = 12;
  while (offset + WAV_CHUNK_HEADER_BYTES <= bytes.byteLength) {
    const id = readAscii(bytes, offset, offset + 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + WAV_CHUNK_HEADER_BYTES;
    if (id === 'fmt ' && size >= 16 && body + 16 <= bytes.byteLength) {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRateHz = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === 'data' && body <= bytes.byteLength) {
      dataOffset = body;
      dataBytes = Math.min(size, bytes.byteLength - body);
    }
    // RIFF chunks are word-aligned: an odd size is followed by one pad byte.
    offset = body + size + (size % 2);
  }
  if (format !== PCM_FORMAT_TAG || bitsPerSample !== 16 || channels < 1 || sampleRateHz < 1 || dataOffset < 0) {
    throw new Error(
      `unsupported baked WAV layout (format=${format}, bits=${bitsPerSample}, channels=${channels}, rate=${sampleRateHz})`,
    );
  }
  const bytesPerFrame = channels * 2;
  const frames = Math.floor(dataBytes / bytesPerFrame);
  const pcm = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let mixed = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      mixed += view.getInt16(dataOffset + frame * bytesPerFrame + channel * 2, true);
    }
    pcm[frame] = mixed / (channels * 32768);
  }

  return { frames: pcm, loop: options.loop, loopStartFrame: options.loopStartFrame, sampleRateHz };
}

function readAscii(bytes: Uint8Array, from: number, to: number): string {
  let text = '';
  for (let index = from; index < to; index += 1) {
    text += String.fromCharCode(bytes[index] ?? 0);
  }

  return text;
}
