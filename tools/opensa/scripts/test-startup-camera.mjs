/** Verify the SA-MP connecting overview with/without recordings in fresh ordinary headed Chrome. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const probe = createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../web-replay');
const server = spawn(process.execPath, [path.join(root, 'local-server.mjs')], {
  cwd: root,
  env: { ...process.env, PORT: String(port), NO_OPEN: '1', GAME_ROOT: path.join(tmpdir(), 'opensa-no-game-install') },
  stdio: ['ignore', 'ignore', 'pipe'],
  windowsHide: true,
});
server.stderr.on('data', (bytes) => process.stderr.write(bytes));
process.once('exit', () => {
  if (!server.killed) server.kill();
});
const origin = `http://127.0.0.1:${port}`;
const fixture = [
  '# synthetic,startup_camera',
  '# gtasa_flight_recorder,version=12',
  'local_timestamp,model,health,x,y,z,capture_elapsed_s,vx,vy,vz',
  ...[0, 1, 2, 3].map((i) => `2026-10-04T00:00:0${i}.000,520,1000,${1200 + i * 80},-800,400,${i},80,0,0`),
].join('\n');
const output = path.resolve('captures');
mkdirSync(output, { recursive: true });
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin + '/opensa/flight-replay.html')).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launchPersistentContext(path.join(tmpdir(), `opensa-startup-${Date.now()}`), {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1600, height: 900 },
  });
  const page = browser.pages()[0] ?? (await browser.newPage());
  const errors = [],
    cells = new Set(),
    gameRequests = [];
  let hasRecording = false;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (/validation error|device.*lost|invalid commandbuffer/i.test(message.text())) errors.push(message.text());
  });
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/map-pak/cells/')) cells.add(pathname);
    if (/\/(?:game-src|gta)\//.test(pathname)) gameRequests.push(pathname);
  });
  await page.route('**/local-recording/latest.csv', (route) =>
    route.fulfill(
      hasRecording ? { status: 200, body: fixture, contentType: 'text/csv' } : { status: 404, body: 'No recording' },
    ),
  );
  const snapshot = () =>
    page.evaluate(() => ({
      mode: globalThis.__flight.cameraMode,
      camera: globalThis.__flight.cameraState,
      error: globalThis.__flight.error,
      renders: globalThis.__flight.renders,
      tracks: document.querySelectorAll('#tracks .track').length,
    }));
  const open = async (suffix = '') => {
    await page.goto(origin + '/opensa/flight-replay.html?hour=12&weather=10' + suffix);
    await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering' || globalThis.__flight?.error, null, {
      timeout: 120000,
    });
    assert.equal((await snapshot()).error, null);
    await page.waitForTimeout(4000);
  };
  const overview = (state) => {
    assert.equal(state.mode, 'free');
    assert.deepEqual(state.camera.eye, [1093, 90, 2036]);
    for (const [axis, value] of [384, 20, 1557].entries()) {
      assert.ok(Math.abs(state.camera.target[axis] - value) < 1e-7, 'SA-MP look-at matches');
    }
  };
  const snapshots = {};
  await open();
  snapshots.empty = await snapshot();
  overview(snapshots.empty);
  assert.equal(snapshots.empty.tracks, 0);
  assert.ok(cells.size > 10, 'The map streams without a CSV');
  await page.screenshot({ path: path.join(output, 'startup-camera-empty.png') });
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.down('w');
  await page.waitForTimeout(200);
  await page.keyboard.up('w');
  snapshots.moved = await snapshot();
  assert.equal(snapshots.moved.camera.eye[1], 90);
  assert.ok(Math.hypot(...snapshots.moved.camera.eye.map((n, i) => n - snapshots.empty.camera.eye[i])) > 0.1);
  // The idle world's unchanged frame stays cached once its current cell ring is resident.
  await page.waitForTimeout(3000);
  const renders = (await snapshot()).renders;
  await page.waitForTimeout(500);
  assert.equal((await snapshot()).renders, renders);

  // Exercise the actual drop handler, without pressing any camera controls after import.
  await page.evaluate((csv) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([csv], 'startup-drop.csv', { type: 'text/csv' }));
    document
      .getElementById('drop')
      .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
  }, fixture);
  await page.waitForFunction(
    () => globalThis.__flight.cameraMode === 'chase-mid' && document.querySelectorAll('#tracks .track').length === 1,
  );
  snapshots.dropped = await snapshot();
  assert.ok(Math.hypot(...snapshots.dropped.camera.eye.map((n, i) => n - [1200, 400, 800][i])) < 100);
  assert.equal(await page.locator('#freeView').textContent(), '自由视角');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(output, 'startup-camera-imported.png') });

  await page.locator('#freeView').click();
  await page.waitForFunction(() => globalThis.__flight.cameraMode === 'free');
  snapshots.beforeFailedImport = await snapshot();
  await page.setInputFiles('#picker', { name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from('invalid') });
  await page.waitForFunction(() => document.getElementById('trackNotice').textContent.includes('导入失败'));
  assert.deepEqual((await snapshot()).camera, snapshots.beforeFailedImport.camera);
  assert.equal((await snapshot()).mode, 'free');

  // File-picker import also switches out of free/cockpit views and selects the last retained CSV.
  const rustler = fixture.replace(/,520,/g, ',476,');
  await page.setInputFiles('#picker', {
    name: 'picker-rustler.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(rustler),
  });
  await page.waitForFunction(
    () => globalThis.__flight.cameraMode === 'chase-mid' && globalThis.__flight.aircraft.includes('rustler'),
  );
  snapshots.picker = await snapshot();
  assert.equal(snapshots.picker.tracks, 2);
  assert.ok(Math.hypot(...snapshots.picker.camera.eye.map((n, i) => n - [1200, 400, 800][i])) < 100);
  await page.locator('#cockpitLook').click();
  await page.waitForFunction(() => globalThis.__flight.cameraMode === 'cockpit-look');
  await page.setInputFiles('#picker', [
    { name: 'batch-rustler.csv', mimeType: 'text/csv', buffer: Buffer.from(rustler) },
    { name: 'batch-hydra.csv', mimeType: 'text/csv', buffer: Buffer.from(fixture) },
  ]);
  await page.waitForFunction(
    () =>
      globalThis.__flight.cameraMode === 'chase-mid' &&
      globalThis.__flight.aircraft.includes('hydra') &&
      document.querySelectorAll('#tracks .track').length === 4,
  );
  snapshots.batch = await snapshot();
  assert.equal(await page.locator('.track.active .track-name').textContent(), 'batch-hydra.csv');

  hasRecording = true;
  await open();
  snapshots.loaded = await snapshot();
  overview(snapshots.loaded);
  assert.equal(snapshots.loaded.tracks, 1, 'Auto-loading a CSV preserves the initial overview');
  await page.screenshot({ path: path.join(output, 'startup-camera-loaded.png') });
  await page.locator('#resetView').click();
  await page.waitForFunction(() => globalThis.__flight.cameraMode === 'chase-mid');
  snapshots.follow = await snapshot();
  assert.ok(Math.hypot(...snapshots.follow.camera.eye.map((n, i) => n - [1200, 400, 800][i])) < 100);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(output, 'startup-camera-follow.png') });
  await page.locator('#freeView').click();
  await page.waitForFunction(() => globalThis.__flight.cameraMode === 'free');
  snapshots.returnedFree = await snapshot();
  assert.deepEqual(
    snapshots.returnedFree.camera.eye,
    snapshots.follow.camera.eye,
    'Explicit free view starts at the current camera',
  );
  await page.locator('#follow').click();
  await page.waitForFunction(() => globalThis.__flight.cameraMode === 'chase-far');
  await open('&videoExport=1');
  snapshots.diagnosticExport = await snapshot();
  assert.equal(snapshots.diagnosticExport.mode, 'chase-mid', 'Diagnostic exports keep the default follow camera');
  assert.deepEqual(errors, []);
  assert.deepEqual(gameRequests, []);
  writeFileSync(
    path.join(output, 'startup-camera-check.json'),
    JSON.stringify({ snapshots, cells: cells.size, errors }, null, 2),
  );
  console.log(JSON.stringify({ result: 'PASS', cells: cells.size, output, cases: Object.keys(snapshots) }));
} finally {
  await browser?.close();
  if (!server.killed) server.kill();
}
