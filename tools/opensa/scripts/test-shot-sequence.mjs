/** Test-owned ordinary headed Chrome, no GPU flags: world camera/FOV diagrams. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const probe = createServer();
await new Promise((resolve) => probe.listen(45000 + Math.floor(Math.random() * 10000), '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../web-replay');
const server = spawn(process.execPath, [path.join(root, 'local-server.mjs')], {
  cwd: root,
  env: { ...process.env, PORT: String(port), NO_OPEN: '1' },
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
    if ((await fetch(origin + '/opensa/flight-replay.html')).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 100));
}
const fixture = [
  '# synthetic,shot_camera_diagram',
  '# gtasa_flight_recorder,version=12',
  'local_timestamp,model,health,x,y,z,capture_elapsed_s,vx,vy,vz',
  ...Array.from({ length: 11 }, (_, i) => i).map((i) =>
    [
      `2026-10-04T00:00:${String(i).padStart(2, '0')}.000`,
      520,
      1000,
      1200 + i * 80,
      -800 + i * 20,
      400,
      i,
      80,
      20,
      0,
    ].join(','),
  ),
].join('\n');
mkdirSync('captures', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const errors = [],
  requests = [],
  cuts = [];
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (/validation error|device.*lost|invalid commandbuffer/i.test(m.text())) errors.push(m.text());
  });
  page.on('request', (r) => {
    if (r.url().includes('/video-export')) requests.push(r.url());
  });
  await page.route('**/local-recording/latest.csv', (r) => r.fulfill({ body: fixture, contentType: 'text/csv' }));
  await page.goto(origin + '/opensa/flight-replay.html?local=latest&hour=12&weather=10');
  await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering', null, { timeout: 120000 });
  const seek = async (seconds) => {
    await page.locator('#scrub').evaluate((node, s) => {
      node.value = String(s);
      node.dispatchEvent(new Event('input', { bubbles: true }));
    }, seconds);
    await page.waitForTimeout(100);
  };
  const state = () =>
    page.evaluate(() => ({
      camera: globalThis.__flight.cameraState,
      mode: globalThis.__flight.cameraMode,
      time: Number(document.querySelector('#scrub').value),
    }));
  const save = async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#shotPlanSave').click()]);
    return JSON.parse(readFileSync(await download.path(), 'utf8'));
  };
  await page.locator('#batchShots').click();
  await page.waitForFunction(() => !globalThis.__flight.flyActive);
  await page.locator('#shotModeSequence').click();
  assert.equal(await page.locator('#shotCards').isVisible(), false);
  await seek(4);
  const observer = (await state()).camera;
  await page.locator('#shotSequenceSplit').click();
  assert.deepEqual((await state()).camera, observer, 'splitting preserves observer');
  await page.locator('#shotSequenceKind').selectOption('follow');
  assert.deepEqual((await state()).camera, observer, 'type selection preserves observer');
  await page.locator('#shotSequencePlace').click();
  await page.keyboard.down('d');
  await page.waitForTimeout(200);
  await page.keyboard.up('d');
  await page.locator('#shotSequenceSave').click();
  await page.locator('#shotSequenceClip').selectOption('0');
  await page.locator('#shotSequencePlace').click();
  await page.locator('#shotSequenceSave').click();
  const plan = await save();
  assert.deepEqual(
    plan.sequence.clips.map((c) => [c.start, c.end, c.view.kind]),
    [
      [0, 4, 'fixed'],
      [4, 10, 'follow'],
    ],
  );
  assert.equal(await page.locator('#shotPanel input[type=number]').count(), 0);
  await page.locator('#shotSequenceDiagram').click();
  await page.waitForFunction(() => globalThis.__flight.shotDiagramSegments.length === 2);
  await page.screenshot({ path: 'captures/shot-sequence-diagram.png' });
  const before = await state();
  await page.locator('#shotSequencePlay').click();
  await page.locator('#shotPreviewToolbar').waitFor();
  await page.waitForTimeout(100);
  await page.locator('#shotSequenceStop').click();
  assert.deepEqual(await state(), before, 'exit restores original observer and time');
  for (const time of [0, 3.999, 4, 7, 10, 4, 0]) {
    await page.locator('#shotSequencePreview').click();
    await seek(time);
    const shot = await state();
    cuts.push(shot);
    assert.equal(shot.mode, time < 4 ? 'shot-fixed' : 'shot-follow');
    if (time < 4) assert.deepEqual(shot.camera.eye, plan.sequence.clips[0].view.position);
    await page.locator('#shotPreviewExit').click();
  }
  await page.locator('#shotExport').click();
  await page.locator('#clientExportProgress').waitFor();
  await page.screenshot({ path: 'captures/shot-sequence-export-progress.png' });
  await page.locator('#clientExportProgress').waitFor({ state: 'detached', timeout: 240000 });
  assert.equal(await page.locator('#shotResults a').count(), 1, await page.locator('#shotExportNote').textContent());
  assert.deepEqual(await state(), before, 'single file export restores observer and clock');
  const link = page.locator('#shotResults a');
  assert.ok((await link.getAttribute('href')).startsWith('blob:'));
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  const file = 'captures/shot-sequence.mp4';
  await download.saveAs(file);
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(probe.status, 0, probe.stderr);
  const streams = JSON.parse(probe.stdout).streams,
    video = streams.find((s) => s.codec_type === 'video'),
    audio = streams.find((s) => s.codec_type === 'audio');
  assert.equal(video.codec_name, 'h264');
  assert.equal(video.nb_frames, '300');
  assert.equal(Number(video.duration), 10);
  assert.equal(audio.codec_name, 'aac');
  for (const [frame, label] of [
    [119, 'before-cut'],
    [120, 'after-cut'],
  ]) {
    const result = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-v',
        'error',
        '-i',
        file,
        '-vf',
        'select=eq(n\\,' + frame + ')',
        '-frames:v',
        '1',
        'captures/shot-sequence-' + label + '.png',
      ],
      { windowsHide: true },
    );
    assert.equal(result.status, 0, result.stderr?.toString());
  }
  await page.locator('#shotModeBatch').click();
  await page
    .locator('#shotPlanFile')
    .setInputFiles({ name: 'sequence.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plan)) });
  await page.waitForFunction(() => document.querySelector('#shotModeSequence').getAttribute('aria-pressed') === 'true');
  assert.deepEqual(await save(), plan);
  const invalid = structuredClone(plan);
  invalid.sequence.clips[1].start = 5;
  await page
    .locator('#shotPlanFile')
    .setInputFiles({ name: 'gap.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) });
  await page.waitForTimeout(150);
  assert.deepEqual(await save(), plan);
  await page.locator('#shotSequenceClip').selectOption('1');
  await page.locator('#shotSequenceEqual').click();
  await page.locator('#shotSequenceKind').selectOption('cockpit');
  await page.locator('#shotSequenceEqual').click();
  await page.locator('#shotSequenceKind').selectOption('tracking');
  await page.locator('#shotSequenceDiagram').click();
  await page.waitForFunction(() => globalThis.__flight.shotDiagramSegments.length === 4);
  await page.screenshot({ path: 'captures/shot-sequence-four-cameras.png' });
  for (const [seconds, mode] of [
    [6, 'shot-follow'],
    [7, 'cockpit-look'],
    [8.5, 'shot-tracking'],
    [7, 'cockpit-look'],
    [3, 'shot-fixed'],
  ]) {
    await page.locator('#shotSequencePreview').click();
    await seek(seconds);
    assert.equal((await state()).mode, mode);
    await page.locator('#shotPreviewExit').click();
  }
  await seek(3);
  await page.locator('#shotStartNow').click();
  await seek(9);
  await page.locator('#shotEndNow').click();
  const cropped = await save();
  assert.deepEqual(
    cropped.sequence.clips.map((c) => [c.start, c.end]),
    [
      [3, 4],
      [4, 7],
      [7, 8.5],
      [8.5, 9],
    ],
  );
  await page.evaluate(() => {
    globalThis.sequenceExportSamples = [];
    globalThis.sequenceExportTimer = setInterval(() => {
      const mode = globalThis.__flight.cameraMode;
      if (document.querySelector('#clientExportProgress') && (mode.startsWith('shot-') || mode === 'cockpit-look'))
        globalThis.sequenceExportSamples.push({ mode, seconds: Number(document.querySelector('#scrub').value) });
    }, 10);
  });
  await page.locator('#shotExport').click();
  await page.locator('#clientExportProgress').waitFor();
  await page.locator('#clientExportProgress').waitFor({ state: 'detached', timeout: 240000 });
  const exportSamples = await page.evaluate(() => {
    clearInterval(globalThis.sequenceExportTimer);
    return globalThis.sequenceExportSamples;
  });
  assert.deepEqual(
    new Set(exportSamples.map((s) => s.mode)),
    new Set(['shot-fixed', 'shot-follow', 'cockpit-look', 'shot-tracking']),
  );
  for (const sample of exportSamples) {
    const expected =
      sample.seconds < 4
        ? 'shot-fixed'
        : sample.seconds < 7
          ? 'shot-follow'
          : sample.seconds < 8.5
            ? 'cockpit-look'
            : 'shot-tracking';
    assert.equal(sample.mode, expected, 'export camera uses absolute capture time for nonzero A/B');
  }
  const croppedLink = page.locator('#shotResults a').last();
  const [croppedDownload] = await Promise.all([page.waitForEvent('download'), croppedLink.click()]);
  await croppedDownload.saveAs('captures/shot-sequence-cropped.mp4');
  const croppedProbe = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_streams', '-of', 'json', 'captures/shot-sequence-cropped.mp4'],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(croppedProbe.status, 0);
  const croppedStreams = JSON.parse(croppedProbe.stdout).streams,
    croppedVideo = croppedStreams.find((s) => s.codec_type === 'video');
  assert.equal(croppedVideo.nb_frames, '180');
  assert.equal(Number(croppedVideo.duration), 6);
  assert.equal(croppedStreams.find((s) => s.codec_type === 'audio').codec_name, 'aac');
  const cockpitImage = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-v',
      'error',
      '-ss',
      '4.5',
      '-i',
      'captures/shot-sequence-cropped.mp4',
      '-frames:v',
      '1',
      'captures/shot-sequence-cockpit.png',
    ],
    { windowsHide: true },
  );
  assert.equal(cockpitImage.status, 0);
  const beforeDelete = (await state()).camera;
  await page.locator('#shotSequenceDelete').click();
  assert.deepEqual((await state()).camera, beforeDelete);
  assert.equal((await save()).sequence.clips.length, 3);
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
  writeFileSync(
    'captures/shot-sequence-result.json',
    JSON.stringify({ plan, cuts, video, audio, croppedVideo, exportSamples, requests, errors }, null, 2),
  );
  console.log(
    JSON.stringify(
      { frames: video.nb_frames, duration: video.duration, cuts: cuts.map((c) => [c.time, c.mode]), requests, errors },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  const exited = new Promise((r) => server.once('exit', r));
  server.kill();
  await exited;
}
