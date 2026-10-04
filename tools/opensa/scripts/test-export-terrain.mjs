/** Cold, delayed map streaming in ordinary headed Chrome; only test-owned browsers are closed. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const origin = process.env.EXPORT_TERRAIN_ORIGIN ?? 'http://127.0.0.1:4173';
const index = await (await fetch(`${origin}/map-pak/index.json`)).json();
const radius = { hd: 1200, lod: 3000 };
const positions = [
  [1200, -800, 400],
  [1450, -500, 420],
  [1700, -200, 430],
  [1950, 100, 420],
];
const csv = [
  '# synthetic,export_terrain_cold_streaming',
  '# gtasa_flight_recorder,version=12',
  'local_timestamp,model,health,x,y,z,capture_elapsed_s,vx,vy,vz',
  ...positions.map((pos, i) => [`2026-10-04T00:00:0${i}.000`, 520, 1000, ...pos, i, 250, 300, 0].join(',')),
].join('\n');
function expectedCells(eye) {
  const wanted = new Map();
  for (const cell of index.cells) {
    const distance = Math.hypot((cell.cx + 0.5) * index.cellSize - eye[0], (cell.cy + 0.5) * index.cellSize + eye[2]);
    if (cell.lod) {
      if (distance <= radius.lod && !wanted.has(`${cell.cx},${cell.cy}`))
        wanted.set(`${cell.cx},${cell.cy},lod`, `/map-pak/cells/${cell.cx}_${cell.cy}_lod.bin`);
    } else if (distance <= radius.hd) wanted.set(`${cell.cx},${cell.cy}`, `/map-pak/cells/${cell.cx}_${cell.cy}.bin`);
  }
  return [...wanted.values()];
}
mkdirSync('captures', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const errors = [],
  results = [];
try {
  for (const [name, view, times] of [
    ['free', { mode: 'free', position: [-1800, 350, 1100], yaw: 1.4, pitch: -0.65, fovYDeg: 65 }, [0]],
    ['follow', { mode: 'shot', shot: { kind: 'follow', offset: [0, -180, 180], fovYDeg: 65 } }, [0, 3]],
  ]) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (/validation error|device.*lost|invalid commandbuffer/i.test(message.text())) errors.push(message.text());
    });
    const fulfilled = new Set();
    await page.route('**/local-recording/latest.csv', (route) => route.fulfill({ body: csv, contentType: 'text/csv' }));
    await page.route('**/map-pak/cells/**', async (route) => {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      // Several two-cell batches must remain outstanding after the first fetch completes.
      await new Promise((resolve) => setTimeout(resolve, 35));
      await route.fulfill({ response });
      fulfilled.add(new URL(route.request().url()).pathname);
    });
    await page.goto(
      `${origin}/opensa/flight-replay.html?local=latest&videoExport=1&hour=12&weather=10&exportView=${encodeURIComponent(JSON.stringify(view))}`,
    );
    await page.waitForFunction(() => globalThis.__flightVideoExport, null, { timeout: 120000 });
    await page.evaluate(() => globalThis.__flightVideoExport.ready());
    for (const time of times) {
      const frame = await page.evaluate(async (seconds) => {
        const pixels = await globalThis.__flightVideoExport.renderFrame(seconds);
        let binary = '';
        for (let i = 0; i < pixels.length; i += 32768) binary += String.fromCharCode(...pixels.subarray(i, i + 32768));
        return {
          pixels: btoa(binary),
          camera: globalThis.__flight.cameraState,
          capture: document.querySelector('#scrub').value,
        };
      }, time);
      const wanted = expectedCells(frame.camera.eye);
      const missing = wanted.filter((file) => !fulfilled.has(file));
      assert.ok(wanted.length > 10, 'exercise many more tiles than the first two-cell batch');
      assert.deepEqual(missing, [], `${name} t=${time}: required cells must all arrive before frame readback`);
      assert.equal(Number(frame.capture), time, 'waiting must not advance capture time');
      const pixels = Buffer.from(frame.pixels, 'base64');
      writeFileSync(
        `captures/export-terrain-${name}-${time}.png`,
        PNG.sync.write({ width: 1920, height: 1080, data: pixels }),
      );
      const warm = await page.evaluate(async (seconds) => {
        const pixels = await globalThis.__flightVideoExport.renderFrame(seconds);
        let binary = '';
        for (let i = 0; i < pixels.length; i += 32768) binary += String.fromCharCode(...pixels.subarray(i, i + 32768));
        return btoa(binary);
      }, time);
      const stable = Buffer.from(warm, 'base64');
      let difference = 0;
      for (let i = 0; i < pixels.length; i++) difference += Math.abs(pixels[i] - stable[i]);
      const meanDifference = difference / pixels.length;
      assert.ok(meanDifference < 0.1, `cold and fully loaded same-time frames differ: ${meanDifference}`);
      results.push({ name, time, wantedCells: wanted.length, missingCells: missing.length, meanDifference });
    }
    if (name === 'free') {
      const encoded = await page.evaluate(async () => {
        const api = globalThis.__flightVideoExport;
        const support = await api.beginEncode(30);
        if (!support.supported) throw new Error(support.reason);
        const batch = await api.encodeFrames(0, 18);
        const tail = await api.endEncode();
        if (batch.error || tail.error) throw new Error(batch.error || tail.error);
        return [...batch.chunks, ...tail.chunks];
      });
      writeFileSync(
        'captures/export-terrain-free.h264',
        Buffer.concat(encoded.map((chunk) => Buffer.from(chunk, 'base64'))),
      );
      const mux = spawnSync(
        'ffmpeg',
        [
          '-y',
          '-v',
          'error',
          '-r',
          '30',
          '-i',
          'captures/export-terrain-free.h264',
          '-c:v',
          'copy',
          'captures/export-terrain-free.mp4',
        ],
        { windowsHide: true },
      );
      assert.equal(mux.status, 0, mux.stderr?.toString());
      const first = spawnSync(
        'ffmpeg',
        [
          '-y',
          '-v',
          'error',
          '-i',
          'captures/export-terrain-free.mp4',
          '-frames:v',
          '1',
          'captures/export-terrain-mp4-first.png',
        ],
        { windowsHide: true },
      );
      assert.equal(first.status, 0, first.stderr?.toString());
    }
    assert.equal(await page.evaluate(() => globalThis.__flight.error), null);
    await context.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync('captures/export-terrain-result.json', JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ results, errors }, null, 2));
} finally {
  await browser.close();
}
