/** Ordinary fresh headed Chrome: measured explosions freeze real aircraft transforms and finish the FX. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { parseFlightCsv } from '../apps/web/src/flight/csv.ts';
import {
  EXPLOSION_REPLAY_SECONDS,
  explosionExportDuration,
  prepareExplosionReplay,
} from '../apps/web/src/flight/flight-explosion.ts';

mkdirSync('captures', { recursive: true });
const recordingName = 'flight_20261003_023601_108_m520_021.csv';
let csv = readFileSync('../../GTA San Andreas/flight_recordings/' + recordingName, 'utf8');
const source = parseFlightCsv(csv, recordingName);
const replay = prepareExplosionReplay(source);
const explosion = replay.explosionReplay.explosionSeconds;
const end = replay.duration;
const errors = [];
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (/validation error|device.*lost|Invalid CommandBuffer/i.test(message.text())) errors.push(message.text());
});
await page.route('**/local-recording/latest.csv', (route) => route.fulfill({ body: csv, contentType: 'text/csv' }));
await page.route('**/assets/flightReplay-*.js', async (route) => {
  const response = await route.fetch();
  const body = await response.text();
  const hook = 'this.statsValue.residencyBytes=this.resources.totalBytes(),this.statsValue';
  assert.ok(body.includes(hook));
  await route.fulfill({
    response,
    body: body.replace(
      hook,
      'this.statsValue.residencyBytes=this.resources.totalBytes(),globalThis.__endingEngine=this,this.statsValue',
    ),
  });
});
const base = 'http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&hour=12&weather=10';
async function open(view) {
  await page.goto(base + (view ? '&videoExport=1&exportView=' + encodeURIComponent(JSON.stringify(view)) : ''));
  await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering' || globalThis.__flight?.error, null, {
    timeout: 120000,
  });
  assert.equal(await page.evaluate(() => globalThis.__flight.error), null);
  await page.locator('#mapLoading').waitFor({ state: 'hidden', timeout: 120000 });
  await page.waitForTimeout(2500);
  if (view) return page.evaluate(() => globalThis.__flightVideoExport.ready());
}
async function seek(seconds) {
  await page.locator('#scrub').evaluate((slider, seconds) => {
    slider.value = String(seconds);
    slider.dispatchEvent(new Event('input'));
  }, seconds);
}
async function state() {
  return page.evaluate(() => {
    const engine = globalThis.__endingEngine;
    const model = [...engine.vehicleModels.values()][0];
    const entity = model.instances.find(Boolean).entity;
    return {
      root: Array.from(entity.root),
      nodes: Array.from(entity.animQuat, (value) => (value === 0 ? 0 : value)),
      visible: Array.from(model.instances.find(Boolean).submeshVisible),
      particles: engine.dynamicParticles.count,
      particleData: ['blend', 'add'].map((lane) => {
        const pool = engine.dynamicParticles[lane]?.pool;
        return pool ? Array.from(pool.data.subarray(0, pool.count * 9)) : [];
      }),
    };
  });
}
async function frame(seconds, name) {
  const bytes = await page.evaluate(async (seconds) => {
    const data = await globalThis.__flightVideoExport.renderFrame(seconds);
    let binary = '';
    for (let i = 0; i < data.length; i += 32768) binary += String.fromCharCode(...data.subarray(i, i + 32768));
    return btoa(binary);
  }, seconds);
  const png = new PNG({ width: 1920, height: 1080 });
  png.data = Buffer.from(bytes, 'base64');
  if (name) writeFileSync('captures/explosion-ending-' + name + '.png', PNG.sync.write(png));
  return png.data;
}
const transform = ({ root, nodes, visible }) => ({ root, nodes, visible });
try {
  console.log('Actual recording: normal playback');
  await open();
  assert.equal(Number(await page.locator('#scrub').getAttribute('max')), end);
  assert.equal(end, explosion, 'recording ends immediately at the explosion');
  await seek(end - 0.2);
  await page.selectOption('#speed', '4');
  await page.locator('#play').click();
  await page.waitForFunction(
    () => globalThis.__flight.explosionAge !== null && document.querySelector('#play').textContent === '▶',
  );
  assert.ok(
    (await page.evaluate(() => globalThis.__flight.explosionAge)) < 0.5,
    'stop immediately, before FX finishes',
  );
  const stoppedProgress = await page.locator('#scrub').inputValue();
  const held = await state();
  const expected = replay.events.find((event) => event.kind === 'explosion').pos;
  [expected[0], expected[2], -expected[1]].forEach((value, axis) =>
    assert.ok(Math.abs(held.root[12 + axis] - value) < 0.001),
  );
  await page.waitForTimeout(300);
  const burst = await state();
  assert.ok(burst.particles > 0, 'explosion particles continue while the aircraft is fixed');
  assert.deepEqual(transform(burst), transform(held));
  const beforeAge = await page.evaluate(() => globalThis.__flight.explosionAge);
  await page.waitForTimeout(600);
  const afterAge = await page.evaluate(() => globalThis.__flight.explosionAge);
  assert.ok(
    afterAge - beforeAge >= 0.5 && afterAge - beforeAge < 1,
    '4x speed must not accelerate the independent burst',
  );
  assert.equal(await page.locator('#scrub').inputValue(), stoppedProgress);
  await page.screenshot({ path: 'captures/explosion-ending-headed-burst.png' });
  await page.waitForTimeout(500);
  assert.deepEqual(transform(await state()), transform(held));
  await page.screenshot({ path: 'captures/explosion-ending-headed-fixed.png' });
  await page.waitForFunction(
    () => globalThis.__flight.explosionAge === 4 && !globalThis.__flight.explosionAnimating,
    null,
    { timeout: 10000 },
  );
  assert.deepEqual(transform(await state()), transform(held));
  assert.equal(await page.locator('#scrub').inputValue(), stoppedProgress);
  assert.equal((await state()).particles, 0, 'full explosion window ends after particle expiry');
  await page.screenshot({ path: 'captures/explosion-ending-headed-end.png' });
  // Large seeks can leave streamed cells uploading after playback ends; wait for those invalidations.
  let settled = false;
  for (let i = 0; i < 120; i++) {
    const renders = await page.evaluate(() => globalThis.__flight.renders);
    await page.waitForTimeout(250);
    if (renders === (await page.evaluate(() => globalThis.__flight.renders))) {
      settled = true;
      break;
    }
  }
  assert.ok(settled, 'ended scene settles after streaming');
  const paused = await page.locator('#canvas').screenshot();
  await page.waitForTimeout(500);
  assert.ok((await page.locator('#canvas').screenshot()).equals(paused), 'ended paused canvas retains its pixels');
  await seek(end - 0.15);
  assert.equal(await page.evaluate(() => globalThis.__flight.explosionAge), null);
  assert.notDeepEqual((await state()).root, held.root, 'rewinding restores the recorded approach');
  await seek(end);
  assert.ok(
    (await page.evaluate(() => globalThis.__flight.explosionAge)) < 0.1,
    'seeking back to the endpoint starts a fresh burst',
  );
  assert.deepEqual(transform(await state()), transform(held));

  const outputs = [];
  for (const view of [
    { mode: 'chase-far' },
    {
      mode: 'free',
      position: [expected[0] + 48, expected[2] + 25, -expected[1] + 65],
      pitch: Math.atan2(-25, Math.hypot(48, 65)),
      yaw: Math.atan2(-48, 65),
    },
  ]) {
    console.log('GPU export', view.mode);
    const ready = await open(view);
    assert.equal(ready.duration, explosionExportDuration(replay));
    // Warm both seek locations and let their streamed geometry/texture uploads finish before comparison.
    await frame(0);
    for (let i = 0; i < 4; i++) {
      await frame(explosion + 0.25);
      await page.waitForTimeout(250);
    }
    const first = await frame(explosion + 0.25, view.mode + '-burst');
    const firstParticles = (await state()).particleData;
    const fixed = transform(await state());
    await frame(explosion + 2.5, view.mode + '-fixed');
    assert.deepEqual(transform(await state()), fixed);
    await frame(0);
    const repeated = await frame(explosion + 0.25, view.mode + '-repeated');
    assert.deepEqual(transform(await state()), fixed);
    assert.deepEqual((await state()).particleData, firstParticles, 'repeat export reconstructs identical particles');
    // Free-view beacon animation is deliberately real-time; check pixels only in chase view.
    if (view.mode !== 'free') {
      let changed = 0,
        maxDelta = 0;
      for (let i = 0; i < first.length; i += 4) {
        const delta = Math.max(...[0, 1, 2].map((channel) => Math.abs(first[i + channel] - repeated[i + channel])));
        if (delta) changed++;
        maxDelta = Math.max(maxDelta, delta);
      }
      // A few overlapping translucent smoke pixels can round differently by one 8-bit level on Arc.
      assert.ok(changed <= 64 && maxDelta <= 1, `repeat pixels: changed=${changed}, maxDelta=${maxDelta}`);
    }
    await frame(end + EXPLOSION_REPLAY_SECONDS, view.mode + '-end');
    assert.equal((await state()).particles, 0);
    assert.deepEqual(transform(await state()), fixed);
    outputs.push({ mode: view.mode, root: fixed.root });
  }
  console.log('Import a recording ending before its measured explosion');
  const shortCsv = readFileSync('../../GTA San Andreas/flight_recordings/flight_20261001_233105_779_m520_001.csv');
  const shortReplay = prepareExplosionReplay(parseFlightCsv(shortCsv.toString(), 'short.csv'));
  await page.setInputFiles('#picker', { buffer: shortCsv, mimeType: 'text/csv', name: 'short.csv' });
  await page.waitForFunction(() => globalThis.__flight.activeTrackIndex === 1);
  const shortTime = shortReplay.explosionReplay.explosionSeconds;
  await frame(shortTime + 0.25, 'short-recording-burst');
  assert.equal(Number(await page.locator('#scrub').getAttribute('max')), shortReplay.duration);
  assert.ok((await state()).particles > 0);
  const shortHeld = transform(await state());
  await frame(explosionExportDuration(shortReplay));
  assert.deepEqual(transform(await state()), shortHeld);
  assert.equal((await state()).particles, 0);
  assert.deepEqual(errors, []);
  writeFileSync(
    'captures/explosion-ending-result.json',
    JSON.stringify(
      {
        recordingName,
        originalDuration: source.duration,
        replayDuration: end,
        exportDuration: explosionExportDuration(replay),
        stoppedProgress,
        independentAgeAdvance: afterAge - beforeAge,
        explosion,
        removedSamples: replay.explosionReplay.removedSamples,
        outputs,
        shortDuration: shortReplay.duration,
        errors,
      },
      null,
      2,
    ),
  );
  console.log('PASS: immediate recording end, independent burst while paused, fixed aircraft, rewind and GPU export');
} finally {
  await browser.close();
}
