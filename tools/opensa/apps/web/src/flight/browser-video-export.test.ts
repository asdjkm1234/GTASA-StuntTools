// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

import { encodeWavPcm16 } from './audio-offline';
import { BrowserVideoDownloads, CLIENT_EXPORT_BYTES, exportFrameCount, pcmWavInfo } from './browser-video-export';
import { browserMp4 } from './browser-video-export';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it('gives the encoder owned PCM chunks, excluding the WAV header and advancing to the next chunk', async () => {
  const chunks: { data: Uint8Array; timestamp: number }[] = [];
  vi.doMock('mediabunny', () => ({
    AudioSample: class {
      close = vi.fn();
      constructor(public init: { data: Uint8Array; timestamp: number }) {
        chunks.push(init);
      }
    },
    AudioSampleSource: class {
      add = vi.fn().mockResolvedValue(undefined);
      close = vi.fn();
    },
    BufferTarget: class {
      buffer = new ArrayBuffer(10);
    },
    canEncodeAudio: vi.fn().mockResolvedValue(true),
    canEncodeVideo: vi.fn().mockResolvedValue(true),
    Mp4OutputFormat: class {},
    Output: class {
      addAudioTrack = vi.fn();
      addVideoTrack = vi.fn();
      cancel = vi.fn().mockResolvedValue(undefined);
      start = vi.fn().mockResolvedValue(undefined);
      state = 'pending';
      finalize(): void {
        this.state = 'finalized';
      }
    },
    VideoSample: class {
      close = vi.fn();
    },
    VideoSampleSource: class {
      add = vi.fn().mockResolvedValue(undefined);
      close = vi.fn();
    },
  }));
  vi.stubGlobal('AudioEncoder', class {});
  vi.stubGlobal('VideoEncoder', class {});
  vi.stubGlobal(
    'VideoFrame',
    class {
      close = vi.fn();
    },
  );
  const pcm = new Int16Array(9000 * 2);
  for (let i = 0; i < pcm.length; i++) pcm[i] = (i % 30000) - 15000;
  const wav = encodeWavPcm16(pcm, 44100, 2);
  try {
    await browserMp4({
      audio: wav,
      duration: 0.01,
      fps: 30,
      maxBytes: 10_000_000,
      progress: vi.fn(),
      render: vi.fn().mockResolvedValue(new Uint8Array(4)),
      signal: new AbortController().signal,
    });
    expect(chunks).toHaveLength(3);
    for (const [index, chunk] of chunks.entries()) {
      expect(chunk.data.byteOffset).toBe(0);
      expect(chunk.data.buffer.byteLength).toBe(chunk.data.byteLength);
      expect(chunk.data).toEqual(wav.slice(44 + index * 4096 * 4, 44 + Math.min(9000, (index + 1) * 4096) * 4));
      expect(chunk.timestamp).toBe((index * 4096) / 44100);
    }
    expect(chunks[0].data).not.toEqual(chunks[1].data);
  } finally {
    vi.doUnmock('mediabunny');
  }
});

it('preserves exact clip counts and rejects unsupported rates', () => {
  expect(exportFrameCount(1.4 - 0.8, 30)).toBe(18);
  expect(exportFrameCount(0.6, 60)).toBe(36);
  expect(exportFrameCount(0.601, 120)).toBe(73);
  expect(() => exportFrameCount(1, 61)).toThrow();
  expect(() => exportFrameCount(Number.NaN, 30)).toThrow();
});

it('reads generated stereo PCM and rejects truncated or misaligned samples', () => {
  const wav = encodeWavPcm16(new Int16Array(4800 * 2), 48000, 2);
  expect(pcmWavInfo(wav)).toEqual({ channels: 2, frames: 4800, rate: 48000 });
  expect(() => pcmWavInfo(wav.subarray(0, wav.length - 1))).toThrow();
  expect(() => pcmWavInfo(new Uint8Array(0))).toThrow();
});

it('retains completed downloads until explicit cleanup, then revokes links and releases its budget', () => {
  const create = vi.fn(() => 'blob:test'),
    revoke = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
  const files = new BrowserVideoDownloads();
  const link = files.add(new Blob(['video']), 'flight.mp4');
  document.body.append(link);
  expect(link.download).toBe('flight.mp4');
  expect(files.bytes).toBe(5);
  expect(revoke).not.toHaveBeenCalled();
  expect(() => files.add({ size: CLIENT_EXPORT_BYTES } as Blob, 'large.mp4')).toThrow('缓存');
  expect(create).toHaveBeenCalledOnce();
  files.clear();
  expect(revoke).toHaveBeenCalledWith('blob:test');
  expect(document.querySelector('a')).toBeNull();
  expect(files.bytes).toBe(0);
  files.clear();
  expect(revoke).toHaveBeenCalledOnce();
});
