/** Real Chrome AAC round trip: a changing stereo signal must survive every 4096-frame PCM boundary. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
import { build } from 'vite';

import { encodeWavPcm16 } from '../apps/web/src/flight/audio-offline.ts';

mkdirSync('captures', { recursive: true });
const compiled = await build({
  build: {
    lib: {
      entry: path.resolve('apps/web/src/flight/browser-video-export.ts'),
      formats: ['iife'],
      name: 'AudioExportQA',
    },
    write: false,
  },
  configFile: false,
  logLevel: 'error',
});
const script = (Array.isArray(compiled) ? compiled[0] : compiled).output.find((item) => item.type === 'chunk').code;
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/qa.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/qa.js' ? script : '<!doctype html><script src="/qa.js"></script>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const duration = 2,
  rate = 44100,
  pcm = new Int16Array(duration * rate * 2);
for (let i = 0; i < duration * rate; i++) {
  const s = i / rate;
  pcm[i * 2] = Math.round(12000 * Math.sin(2 * Math.PI * (350 * s + 287.5 * s * s)));
  pcm[i * 2 + 1] = Math.round(9000 * Math.sin(2 * Math.PI * (900 * s - 125 * s * s)));
}
const wav = encodeWavPcm16(pcm, rate, 2);
const browser = await chromium.launch({ channel: 'chrome', headless: false });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(
    async ({ audio, duration }) => {
      const pixels = new Uint8Array(1920 * 1080 * 4);
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = 30;
        pixels[i + 1] = 60;
        pixels[i + 2] = 90;
        pixels[i + 3] = 255;
      }
      const blob = await globalThis.AudioExportQA.browserMp4({
        audio: Uint8Array.from(audio),
        duration,
        fps: 30,
        maxBytes: 30_000_000,
        progress() {},
        render: async () => pixels,
        signal: new AbortController().signal,
      });
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    { audio: Array.from(wav), duration },
  );
  const file = 'captures/browser-audio-roundtrip.mp4';
  writeFileSync(file, Uint8Array.from(result));
  writeFileSync('captures/browser-audio-roundtrip-source.wav', wav);
  const decode = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-f', 's16le', '-'], {
    maxBuffer: 5_000_000,
    windowsHide: true,
  });
  assert.equal(decode.status, 0, decode.stderr?.toString());
  const decoded = new Int16Array(decode.stdout.buffer, decode.stdout.byteOffset, decode.stdout.byteLength / 2);
  function correlation(shift, channel, repeat = false) {
    let xx = 0,
      xy = 0,
      yy = 0;
    for (let i = 8000; i < 70000; i += 8) {
      const x = decoded[i * 2 + channel];
      const y = repeat ? decoded[(i + shift) * 2 + channel] : pcm[(i + shift) * 2 + channel];
      xx += x * x;
      yy += y * y;
      xy += x * y;
    }
    return xy / Math.sqrt(xx * yy);
  }
  let best = { left: -1, offset: 0, right: -1 };
  for (let shift = -2048; shift <= 2048; shift++) {
    const left = correlation(shift, 0);
    if (left > best.left) best = { left, offset: shift, right: correlation(shift, 1) };
  }
  const repeated = correlation(4096, 0, true);
  assert.ok(best.left > 0.98 && best.right > 0.98, JSON.stringify(best));
  assert.ok(Math.abs(repeated) < 0.1, `output must not repeat its first 4096-frame block: ${repeated}`);
  const report = { decodedFrames: decoded.length / 2, file, ...best, blockRepetitionCorrelation: repeated };
  writeFileSync('captures/browser-audio-roundtrip-result.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
