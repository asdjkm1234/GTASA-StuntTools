/** Local WebCodecs + MP4 muxing. Neither raw frames nor encoded packets leave this browser. */
export const CLIENT_EXPORT_BYTES = 512 * 1024 * 1024;
export const CLIENT_AUDIO_BYTES = 192 * 1024 * 1024;

export interface BrowserExportOptions {
  audio: Uint8Array;
  duration: number;
  fps: number;
  maxBytes: number;
  progress: (done: number, total: number) => void;
  render: (seconds: number) => Promise<Uint8Array>;
  signal: AbortSignal;
}

/** Completed files survive cancellation and are released explicitly or when their document closes. */
export class BrowserVideoDownloads {
  get bytes(): number {
    return this.files.reduce((sum, file) => sum + file.size, 0);
  }
  private readonly files: { link: HTMLAnchorElement; size: number; url: string }[] = [];
  add(blob: Blob, filename: string): HTMLAnchorElement {
    if (this.bytes + blob.size > CLIENT_EXPORT_BYTES) throw new Error('浏览器视频缓存已达到上限，请清理已生成视频。');
    const link = document.createElement('a'),
      url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    link.textContent = '下载 MP4';
    link.title = filename;
    this.files.push({ link, size: blob.size, url });

    return link;
  }
  clear(): void {
    for (const { link, url } of this.files) {
      URL.revokeObjectURL(url);
      if (link.isConnected) link.replaceWith(document.createTextNode('已清理'));
    }
    this.files.length = 0;
  }
}

export async function browserMp4(options: BrowserExportOptions): Promise<Blob> {
  const {
    AudioSample,
    AudioSampleSource,
    BufferTarget,
    canEncodeAudio,
    canEncodeVideo,
    Mp4OutputFormat,
    Output,
    VideoSample,
    VideoSampleSource,
  } = await import('mediabunny');
  const { audio, duration, fps, maxBytes, progress, render, signal } = options;
  const total = exportFrameCount(duration, fps);
  const info = pcmWavInfo(audio);
  if (!globalThis.VideoEncoder || !globalThis.AudioEncoder)
    throw new Error('此浏览器不支持视频/音频编码，请使用支持 WebCodecs 的 Chrome 或 Edge。');
  signal.throwIfAborted();
  const codec = fps > 60 ? 'avc1.640033' : 'avc1.64002a';
  if (
    !(await canEncodeVideo('avc', { frameRate: fps, fullCodecString: codec, height: 1080, width: 1920 })) ||
    !(await canEncodeAudio('aac', { numberOfChannels: info.channels, sampleRate: info.rate }))
  )
    throw new Error('此设备无法编码所选帧率的 H.264/AAC MP4，请降低帧率或使用支持的 Chrome/Edge。');
  let bytes = 0;
  const countBytes = (packet: { data: Uint8Array }): void => {
    bytes += packet.data.byteLength;
    if (bytes + 1024 * 1024 > maxBytes) throw new Error('浏览器视频缓存已达到上限，请缩短片段或清理已生成视频。');
  };
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const video = new VideoSampleSource({
    bitrate: fps > 60 ? 24_000_000 : 16_000_000,
    codec: 'avc',
    fullCodecString: codec,
    hardwareAcceleration: 'no-preference',
    latencyMode: 'quality',
    onEncodedPacket: countBytes,
  });
  const sound = new AudioSampleSource({ bitrate: 192_000, codec: 'aac', onEncodedPacket: countBytes });
  output.addVideoTrack(video, { frameRate: fps });
  output.addAudioTrack(sound);
  try {
    await output.start();
    for (let first = 0; first < info.frames; first += 4096) {
      signal.throwIfAborted();
      const last = Math.min(info.frames, first + 4096);
      const sample = new AudioSample({
        // Mediabunny 1.61.1's toAudioData reads the underlying ArrayBuffer from offset zero.
        // Own each chunk so it cannot read the WAV header or repeat the first chunk.
        data: audio.slice(44 + first * info.channels * 2, 44 + last * info.channels * 2),
        format: 's16',
        numberOfChannels: info.channels,
        sampleRate: info.rate,
        timestamp: first / info.rate,
      });
      try {
        await sound.add(sample);
      } finally {
        sample.close();
      }
      if (first % 65536 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    sound.close();
    for (let index = 0; index < total; index++) {
      signal.throwIfAborted();
      const pixels = await render(index / fps);
      signal.throwIfAborted();
      const frame = new VideoFrame(pixels, {
        codedHeight: 1080,
        codedWidth: 1920,
        duration: Math.round(Math.min(1 / fps, duration - index / fps) * 1_000_000),
        format: 'RGBA',
        timestamp: Math.round((index * 1_000_000) / fps),
      });
      const sample = new VideoSample(frame);
      try {
        await video.add(sample);
      } finally {
        sample.close();
        frame.close();
      }
      progress(index + 1, total);
      if (index % 4 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    video.close();
    signal.throwIfAborted();
    await output.finalize();
    signal.throwIfAborted();
    if (!target.buffer || target.buffer.byteLength > maxBytes)
      throw new Error('浏览器视频缓存已达到上限，请清理已生成视频。');

    return new Blob([target.buffer], { type: 'video/mp4' });
  } finally {
    if (output.state !== 'finalized') await output.cancel();
  }
}

export function exportFrameCount(duration: number, fps: number): number {
  if (!Number.isFinite(duration) || duration <= 0 || ![30, 60, 120].includes(fps))
    throw new Error('导出时长或帧率无效');

  return Math.ceil(duration * fps - 1e-9);
}

export function pcmWavInfo(wav: Uint8Array): { channels: number; frames: number; rate: number } {
  const data = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  if (
    wav.length < 44 ||
    data.getUint32(0) !== 0x52494646 ||
    data.getUint32(8) !== 0x57415645 ||
    data.getUint32(12) !== 0x666d7420 ||
    data.getUint32(16, true) !== 16 ||
    data.getUint16(20, true) !== 1 ||
    data.getUint16(34, true) !== 16 ||
    data.getUint32(36) !== 0x64617461
  )
    throw new Error('导出合成音频格式无效');
  const bytes = data.getUint32(40, true),
    channels = data.getUint16(22, true),
    rate = data.getUint32(24, true);
  if (![1, 2].includes(channels) || rate <= 0 || bytes !== wav.length - 44 || bytes % (channels * 2))
    throw new Error('导出合成音频长度无效');

  return { channels, frames: bytes / (channels * 2), rate };
}
