/** Client-only MP4s in fresh ordinary headed Chrome. Server export is disabled and never requested. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const probe = createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../web-replay');
const server = spawn(process.execPath, [path.join(webRoot, 'local-server.mjs')], {
  cwd: webRoot,
  env: { ...process.env, PORT: String(port), NO_OPEN: '1', ENABLE_SERVER_VIDEO_EXPORT: '0' },
  stdio: ['ignore', 'ignore', 'pipe'],
  windowsHide: true,
});
server.stderr.on('data', (bytes) => process.stderr.write(bytes));
process.once('exit', () => {
  if (!server.killed) server.kill();
});
const origin = `http://127.0.0.1:${port}`;
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(`${origin}/opensa/flight-replay.html`)).ok) break;
  } catch {
    /* booting */
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}
assert.equal((await fetch(`${origin}/video-export`, { method: 'POST' })).status, 410);
const positions = [
  [1200, -800, 400],
  [1280, -800, 415],
  [1360, -780, 435],
  [1440, -810, 420],
  [1520, -800, 410],
];
const csv = [
  '# synthetic,browser_export',
  '# gtasa_flight_recorder,version=12',
  'local_timestamp,model,health,x,y,z,capture_elapsed_s,vx,vy,vz',
  ...positions.map((p, i) => [`2026-10-04T00:00:0${i}.000`, 520, 1000, ...p, i, 80, 0, 0].join(',')),
].join('\n');
mkdirSync('captures', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const errors = [],
  requests = [],
  outputs = [];
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (/validation error|device.*lost|invalid commandbuffer/i.test(message.text())) errors.push(message.text());
  });
  page.on('request', (request) => {
    if (request.url().includes('/video-export')) requests.push(request.url());
  });
  await page.route('**/local-recording/latest.csv', (route) => route.fulfill({ body: csv, contentType: 'text/csv' }));
  await page.goto(`${origin}/opensa/flight-replay.html?local=latest&hour=12&weather=10`);
  await page.waitForFunction(
    () => globalThis.__flight?.worldReady && globalThis.__flight?.phase === 'rendering',
    null,
    { timeout: 120000 },
  );
  await page.locator('#batchShots').click();
  await page.waitForFunction(() => !globalThis.__flight.flyActive);
  await page.locator('#scrub').evaluate((node) => {
    node.value = '0.8';
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#shotStartNow').click();
  await page.locator('#scrub').evaluate((node) => {
    node.value = '1.4';
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#shotEndNow').click();
  await page.locator('#shotGenerate').click();
  for (const [kind, label] of [
    ['fixed', '固定镜头'],
    ['tracking', '定点跟拍'],
    ['follow', '伴飞机位'],
  ]) {
    const card = page.locator('#shot-' + kind);
    await card.getByRole('button', { name: '启用分段' + label }).click();
    await card.getByRole('button', { name: '将当前段等分' }).click();
    await card.locator('[data-action="place"]').click();
    await page.keyboard.down('d');
    await page.waitForTimeout(300);
    await page.keyboard.up('d');
    await card.locator('[data-action="save"]').click();
  }
  const state = () =>
    page.evaluate(() => ({
      camera: globalThis.__flight.cameraState,
      time: document.querySelector('#scrub').value,
      mode: globalThis.__flight.cameraMode,
      playing: document.querySelector('#play').textContent,
    }));
  const before = await state();
  await page.locator('#shotExport').click();
  await page.locator('#clientExportProgress').waitFor();
  await page.screenshot({ path: 'captures/browser-export-progress.png' });
  await page.locator('#clientExportProgress').waitFor({ state: 'detached', timeout: 180000 });
  assert.equal(
    await page.locator('#shotResults a').count(),
    4,
    (await page.locator('#shotExportNote').textContent()) + (await page.locator('#shotResults').textContent()),
  );
  assert.deepEqual(await state(), before, 'export restores clock, full camera and pause state');
  const audioHashes = [];
  for (let i = 0; i < 4; i++) {
    const link = page.locator('#shotResults a').nth(i);
    assert.ok((await link.getAttribute('href')).startsWith('blob:'), 'client Blob, not server download');
    const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
    const file = `captures/browser-export-${['fixed', 'tracking', 'follow', 'cockpit'][i]}.mp4`;
    await download.saveAs(file);
    const metadata = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file], {
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(metadata.status, 0, metadata.stderr);
    const streams = JSON.parse(metadata.stdout).streams;
    const video = streams.find((s) => s.codec_type === 'video'),
      audio = streams.find((s) => s.codec_type === 'audio');
    assert.equal(video.codec_name, 'h264');
    assert.equal(video.width, 1920);
    assert.equal(video.height, 1080);
    assert.equal(video.nb_frames, '18');
    assert.equal(video.avg_frame_rate, '30/1');
    assert.ok(Math.abs(Number(video.duration) - 0.6) < 0.0001);
    assert.equal(audio.codec_name, 'aac');
    const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-f', 's16le', '-'], {
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });
    assert.equal(decoded.status, 0);
    audioHashes.push(createHash('sha256').update(decoded.stdout).digest('hex'));
    const image = spawnSync(
      'ffmpeg',
      ['-y', '-v', 'error', '-i', file, '-frames:v', '1', `captures/browser-export-first-${i}.png`],
      { windowsHide: true },
    );
    assert.equal(image.status, 0);
    outputs.push({ file, filename: download.suggestedFilename(), video, audio });
  }
  assert.ok(new Set(audioHashes).size >= 3, 'each moving/static observer must have its own audio');
  await page.screenshot({ path: 'captures/browser-export-complete.png' });
  // Cancellation during the next camera leaves completed files and restores the same view.
  await page.locator('#shotExport').click();
  await page.waitForFunction(
    () => document.querySelector('#clientExportProgress') && document.querySelector('#shotResults a'),
    null,
    { timeout: 180000 },
  );
  const firstUrl = await page.locator('#shotResults a').first().getAttribute('href');
  await page.locator('#clientExportCancel').click();
  await page.locator('#clientExportProgress').waitFor({ state: 'detached', timeout: 30000 });
  assert.ok((await page.locator('#shotExportNote').textContent()).includes('已取消'));
  assert.equal(await page.evaluate(async (url) => (await fetch(url)).status, firstUrl), 200);
  assert.deepEqual(await state(), before);
  await page.locator('#clearClientVideos').click();
  assert.equal(await page.locator('#shotResults a').count(), 0);
  assert.equal(
    await page.evaluate(async (url) => {
      try {
        await fetch(url);
        return false;
      } catch {
        return true;
      }
    }, firstUrl),
    true,
  );
  await page.locator('#shotClose').click();
  for (const fps of [60, 120]) {
    await page.locator('#exportFps').selectOption(String(fps));
    await page.locator('#singleVideoExport').click();
    await page.locator('#clientExportProgress').waitFor();
    await page.locator('#clientExportProgress').waitFor({ state: 'detached', timeout: 180000 });
    const link = page.locator('#exportNote a');
    assert.equal(await link.count(), 1, await page.locator('#exportNote').textContent());
    const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
    const file = `captures/browser-export-${fps}fps.mp4`;
    await download.saveAs(file);
    const metadata = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file], { windowsHide: true });
    assert.equal(metadata.status, 0);
    const streams = JSON.parse(metadata.stdout.toString()).streams;
    const video = streams.find((s) => s.codec_type === 'video'),
      audio = streams.find((s) => s.codec_type === 'audio');
    assert.equal(video.nb_frames, String(4 * fps));
    assert.equal(video.avg_frame_rate, `${fps}/1`);
    assert.ok(Math.abs(Number(video.duration) - 4) < 0.0001);
    assert.equal(audio.codec_name, 'aac');
    outputs.push({ file, video, audio });
    assert.deepEqual(await state(), before);
  }
  await page.locator('#clearClientVideos').click();
  assert.deepEqual(requests, [], 'no CSV/PCM/raw frame/encoded video uploads to server');
  assert.deepEqual(errors, []);
  writeFileSync(
    'captures/browser-export-result.json',
    JSON.stringify({ outputs, audioHashes, requests, errors }, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        outputs: outputs.map(({ file, video, audio }) => ({
          file,
          frames: video.nb_frames,
          duration: video.duration,
          audio: audio.codec_name,
        })),
        requests,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill();
  await exited;
}
