/** Fresh ordinary headed Chrome: route range, guided cameras, previews and four real MP4 exports. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { viewProjection } from '../apps/web/src/flight/endpoint-picking.ts';
import { gtaToEngine } from '../apps/web/src/flight/math.ts';

let testServer = null;
let origin = process.env.SHOT_TEST_ORIGIN;
if (!origin) {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../web-replay');
  testServer = spawn(process.execPath, [path.join(webRoot, 'local-server.mjs')], {
    cwd: webRoot,
    env: { ...process.env, PORT: String(port), NO_OPEN: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  testServer.stderr.on('data', (bytes) => process.stderr.write(bytes));
  process.once('exit', () => {
    if (testServer && !testServer.killed) testServer.kill();
  });
  origin = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin + '/opensa/flight-replay.html')).ok) break;
    } catch {
      /* booting */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
mkdirSync('captures', { recursive: true });
const positions = [
  [1200, -800, 400],
  [1280, -800, 415],
  [1360, -780, 435],
  [1440, -810, 420],
  [1520, -800, 410],
];
const fixture = [
  '# synthetic,shot_export_range_and_cameras',
  '# gtasa_flight_recorder,version=12',
  'local_timestamp,model,health,x,y,z,capture_elapsed_s,vx,vy,vz',
  ...positions.map((pos, i) => [`2026-10-04T00:00:0${i}.000`, 520, 1000, ...pos, i, 80, 0, 0].join(',')),
].join('\n');
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [],
  snapshots = {};
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (/validation error|device.*lost|Invalid CommandBuffer/i.test(message.text())) errors.push(message.text());
});
await page.route('**/local-recording/latest.csv', (route) => route.fulfill({ body: fixture, contentType: 'text/csv' }));
async function projected(segment, t) {
  const camera = await page.evaluate(() => globalThis.__flight.cameraState),
    box = await page.locator('#canvas').boundingBox();
  const m = viewProjection(camera),
    pos = gtaToEngine(...positions[segment].map((v, i) => v + (positions[segment + 1][i] - v) * t));
  const clip = [0, 1, 3].map((a) => m[a] * pos[0] + m[a + 4] * pos[1] + m[a + 8] * pos[2] + m[a + 12]);
  return {
    x: box.x + ((clip[0] / clip[2] + 1) * box.width) / 2,
    y: box.y + ((1 - clip[1] / clip[2]) * box.height) / 2,
  };
}
async function pickBound(bound, segment, t) {
  await page.locator(bound === 'start' ? '#shotPickStart' : '#shotPickEnd').click();
  const p = await projected(segment, t),
    before = await page.evaluate(() => globalThis.__flight.cameraState);
  assert.ok(p.x > 300 && p.x < 1500 && p.y > 60 && p.y < 800, `route click must clear panels: ${JSON.stringify(p)}`);
  await page.mouse.click(p.x, p.y);
  await page.waitForFunction(
    ({ bound, time }) =>
      Math.abs(parseFloat(document.querySelector(bound === 'start' ? '#shotStart' : '#shotEnd').textContent) - time) <
      0.04,
    { bound, time: segment + t },
  );
  assert.deepEqual(await page.evaluate(() => globalThis.__flight.cameraState), before);
}
try {
  await page.goto(`${origin}/opensa/flight-replay.html?local=latest&hour=12&weather=10`);
  await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering' || globalThis.__flight?.error, null, {
    timeout: 120000,
  });
  assert.equal(await page.evaluate(() => globalThis.__flight.error), null);
  await page.locator('#resetView').click();
  await page.locator('#scrub').evaluate((slider) => {
    slider.value = slider.max;
    slider.dispatchEvent(new Event('input'));
  });
  await page.locator('#freeView').click();
  await page.waitForFunction(() => globalThis.__flight.cameraMode === 'free' && !globalThis.__flight.flyActive);
  await page.locator('#mapLoading').waitFor({ state: 'hidden', timeout: 120000 });
  const angles = await page.evaluate(() => {
    const { eye, target } = globalThis.__flight.cameraState;
    const [x, y, z] = target.map((v, i) => v - eye[i]);
    return { yaw: Math.atan2(x, -z), pitch: Math.atan2(y, Math.hypot(x, z)) };
  });
  await page.mouse.move(960, 450);
  await page.mouse.down();
  await page.mouse.move(960 - angles.yaw / 0.004, 450 + (angles.pitch + 0.35) / 0.004, { steps: 10 });
  await page.mouse.up();
  await page.mouse.wheel(0, 7500);
  await page.waitForTimeout(300);
  await page.locator('#batchShots').click();
  await pickBound('start', 0, 0.8);
  await pickBound('end', 1, 0.4);
  assert.equal(await page.locator('#shotRangeOverlay').isVisible(), true);
  await page.screenshot({ path: 'captures/shot-export-range.png' });
  // Use exact non-zero bounds so frame and audio probes can assert the requested duration.
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
  await page.locator('#shotExport').click();
  assert.match(await page.locator('#shotExportNote').textContent(), /保存或推荐/);
  await page.locator('#shotGenerate').click();
  for (const kind of ['fixed', 'tracking', 'follow', 'cockpit']) {
    const card = page.locator(`#shot-${kind}`);
    await card.locator('[data-action="place"]').click();
    await page.waitForFunction(
      (kind) => globalThis.__flight.cameraMode === (kind === 'cockpit' ? 'cockpit-look' : 'free'),
      kind,
    );
    await card.locator('[data-action="save"]').click();
    assert.equal(await card.locator('.shot-saved').textContent(), '已保存');
    const before = await page.evaluate(() => globalThis.__flight.cameraState);
    snapshots[kind] = [];
    for (const at of ['0', '0.5', '1']) {
      await card.locator(`[data-at="${at}"]`).click();
      await page.waitForFunction(
        (kind) => globalThis.__flight.cameraMode === (kind === 'cockpit' ? 'cockpit-look' : `shot-${kind}`),
        kind,
      );
      assert.equal(await page.evaluate(() => globalThis.__flight.routeVisible), false);
      assert.equal(await page.locator('#shotRangeOverlay').isVisible(), false);
      snapshots[kind].push(await page.evaluate(() => globalThis.__flight.cameraState));
    }
    await page.screenshot({ path: `captures/shot-export-preview-${kind}.png` });
    await page.locator('#shotStop').click();
    assert.deepEqual(await page.evaluate(() => globalThis.__flight.cameraState), before);
  }
  assert.deepEqual(snapshots.fixed[0], snapshots.fixed[2]);
  assert.deepEqual(snapshots.tracking[0].eye, snapshots.tracking[2].eye);
  assert.notDeepEqual(snapshots.tracking[0].target, snapshots.tracking[2].target);
  assert.notDeepEqual(snapshots.follow[0].eye, snapshots.follow[2].eye);
  assert.deepEqual(snapshots.follow[1].up, [0, 1, 0]);
  const planDownload = page.waitForEvent('download');
  await page.locator('#shotPlanSave').click();
  const savedPlan = JSON.parse(readFileSync(await (await planDownload).path(), 'utf8'));
  assert.deepEqual(savedPlan.range, { start: 0.8, end: 1.4 });
  assert.equal(Object.keys(savedPlan.views).length, 4);
  await page.locator('#shotNone').click();
  assert.equal(await page.locator('#shotCards input:checked').count(), 0);
  await page.locator('#shotPlanFile').setInputFiles({
    name: 'shot-plan.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(savedPlan)),
  });
  await page.waitForFunction(() => document.querySelector('#shotRangeNote').textContent.includes('已恢复'));
  assert.equal(await page.locator('#shotCards input:checked').count(), 4);
  await page.locator('#shotPlanFile').setInputFiles({
    name: 'bad-plan.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...savedPlan, recording: 'different recording' })),
  });
  await page.waitForFunction(() => document.querySelector('#shotRangeNote').textContent.includes('不匹配'));
  assert.equal(await page.locator('#shotCards input:checked').count(), 4);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(200);
  const panelBox = await page.locator('#shotPanel').boundingBox(),
    transportBox = await page.locator('#transport').boundingBox();
  assert.ok(panelBox.y + panelBox.height < transportBox.y, 'shot panel must stay above the actual transport');
  await page.screenshot({ path: 'captures/shot-export-resized.png' });
  await page.setViewportSize({ width: 1920, height: 1080 });
  // The whole play segment stops exactly at B and explicit exit restores the user's view/time.
  const beforePlay = await page.evaluate(() => ({
    camera: globalThis.__flight.cameraState,
    time: document.querySelector('#scrub').value,
  }));
  await page.locator('#shot-follow [data-at="play"]').click();
  await page.waitForFunction(
    () => document.querySelector('#scrub').value === '1.4' && document.querySelector('#play').textContent === '▶',
    null,
    { timeout: 10000 },
  );
  await page.locator('#shotStop').click();
  assert.deepEqual(
    await page.evaluate(() => ({
      camera: globalThis.__flight.cameraState,
      time: document.querySelector('#scrub').value,
    })),
    beforePlay,
  );
  const exportRequests = [];
  page.on('request', (request) => {
    if (request.url().includes('/video-export')) exportRequests.push(request.url());
  });
  await page.locator('#shotExport').click();
  await page.locator('#clientExportProgress').waitFor();
  await page.locator('#clientExportProgress').waitFor({ state: 'detached', timeout: 180000 });
  assert.equal(await page.locator('#shotResults a').count(), 4, await page.locator('#shotExportNote').textContent());
  const outputs = [],
    hashes = [];
  for (const [index, shotKind] of ['fixed', 'tracking', 'follow', 'cockpit'].entries()) {
    const link = page.locator('#shotResults a').nth(index);
    const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
    const file = `captures/shot-export-${shotKind}.mp4`;
    await download.saveAs(file);
    const bytes = readFileSync(file);
    const job = { shotKind, filename: download.suggestedFilename() };
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], {
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(probe.status, 0, probe.stderr);
    const metadata = JSON.parse(probe.stdout);
    const video = metadata.streams.find((s) => s.codec_type === 'video');
    assert.equal(video.width, 1920);
    assert.equal(video.height, 1080);
    assert.equal(Number(video.nb_frames), 18);
    assert.equal(video.avg_frame_rate, '30/1');
    assert.ok(Math.abs(Number(video.duration) - 0.6) < 1 / 30);
    assert.ok(metadata.streams.some((s) => s.codec_type === 'audio' && s.codec_name === 'aac'));
    const audio = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-f', 's16le', '-'], {
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
    assert.equal(audio.status, 0, audio.stderr?.toString());
    hashes.push(createHash('sha256').update(audio.stdout).digest('hex'));
    outputs.push({
      file,
      filename: job.filename,
      frames: video.nb_frames,
      duration: video.duration,
      bytes: bytes.length,
    });
    const frame = spawnSync(
      'ffmpeg',
      ['-y', '-v', 'error', '-i', file, '-frames:v', '1', `captures/shot-export-first-${job.shotKind}.png`],
      { windowsHide: true },
    );
    assert.equal(frame.status, 0);
  }
  assert.ok(new Set(hashes).size >= 3, 'distinct observers must produce spatially different audio');
  await page.screenshot({ path: 'captures/shot-export-complete.png' });
  assert.deepEqual(errors, []);
  // A directly driven export page proves output t=0 maps to capture t=A, with no implicit explosion tail.
  const exportPage = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const view = { mode: 'shot', shot: savedPlan.views.follow };
  await exportPage.route('**/local-recording/latest.csv', (route) =>
    route.fulfill({ body: fixture, contentType: 'text/csv' }),
  );
  await exportPage.goto(
    `${origin}/opensa/flight-replay.html?local=latest&videoExport=1&exportRange=${encodeURIComponent(JSON.stringify({ start: 0.8, end: 1.4 }))}&exportView=${encodeURIComponent(JSON.stringify(view))}`,
  );
  const capture = await exportPage.evaluate(async () => {
    const api = globalThis.__flightVideoExport;
    const ready = await api.ready();
    await api.renderFrame(0);
    return {
      duration: ready.duration,
      seconds: document.querySelector('#scrub').value,
      camera: globalThis.__flight.cameraState,
    };
  });
  assert.ok(Math.abs(capture.duration - 0.6) < 1e-9);
  assert.equal(capture.seconds, '0.8');
  await exportPage.close();
  // Cancellation is local; completed blob URLs survive without a server job.
  await page.locator('#shotExport').click();
  await page.waitForFunction(
    () => document.querySelector('#clientExportProgress') && document.querySelector('#shotResults a'),
  );
  const firstUrl = await page.locator('#shotResults a').first().getAttribute('href');
  await page.locator('#clientExportCancel').click();
  await page.locator('#clientExportProgress').waitFor({ state: 'detached', timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('#shotExportNote').textContent.includes('已取消'));
  assert.equal(await page.evaluate(async (url) => (await fetch(url)).status, firstUrl), 200);
  assert.deepEqual(exportRequests, []);
  const cancelled = { local: true, completed: await page.locator('#shotResults a').count() };
  assert.deepEqual(errors, []);
  writeFileSync(
    'captures/shot-export-result.json',
    JSON.stringify({ outputs, audioHashes: hashes, capture, cancellation: cancelled, errors }, null, 2),
  );
  console.log(JSON.stringify({ outputs, errors, captureSeconds: capture.seconds }, null, 2));
} finally {
  await browser.close();
  if (testServer) {
    const exited = new Promise((resolve) => testServer.once('exit', resolve));
    testServer.kill();
    await exited;
  }
}
