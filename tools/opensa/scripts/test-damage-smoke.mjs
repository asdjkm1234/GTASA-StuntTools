/** The user's bridge recording: damage onset, all chase distances, paused pixels, seek and GPU export. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

mkdirSync('captures', { recursive: true });
const recording = readFileSync('../../GTA San Andreas/flight_recordings/flight_20261003_023437_649_m520_017.csv');
const errors = [];
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (/validation error|device.*lost|invalid shader|Invalid CommandBuffer/i.test(m.text())) errors.push(m.text());
});
await page.route('**/local-recording/latest.csv', (r) => r.fulfill({ body: recording, contentType: 'text/csv' }));
await page.route('**/assets/flightReplay-*.js', async (r) => {
  const response = await r.fetch();
  const body = await response.text();
  const hook = 'this.statsValue.residencyBytes=this.resources.totalBytes(),this.statsValue';
  assert.ok(body.includes(hook));
  await r.fulfill({ response, body: body.replace(hook,
    'this.statsValue.residencyBytes=this.resources.totalBytes(),globalThis.__smokeEngine=this,this.statsValue') });
});

function difference(a, b) {
  let changed = 0;
  // Ignore instrument canvases; count visible smoke on the main scene.
  for (let y = 0; y < 800; y++) for (let x = 0; x < 1920; x++) {
    const at = (y * 1920 + x) * 4;
    if ([0, 1, 2].some((c) => Math.abs(a[at + c] - b[at + c]) > 3)) changed++;
  }
  return changed;
}
async function frame(seconds, name) {
  const encoded = await page.evaluate(async (s) => {
    const bytes = await globalThis.__flightVideoExport.renderFrame(s);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return btoa(binary);
  }, seconds);
  const png = new PNG({ width: 1920, height: 1080 });
  png.data = Buffer.from(encoded, 'base64');
  if (name) writeFileSync(`captures/damage-smoke-${name}.png`, PNG.sync.write(png));
  return png.data;
}
async function smokeParticles() {
  return page.evaluate(() => {
    const pool = globalThis.__smokeEngine.dynamicParticles.blend.pool;
    const rows = [];
    for (let i = 0; i < pool.count; i++) {
      const at = i * 9;
      if (Math.floor(pool.data[at + 8]) === 0) rows.push(Array.from(pool.data.subarray(at, at + 9)));
    }
    return rows;
  });
}
try {
  console.log('Normal headed replay');
  const base = 'http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&hour=12&weather=10';
  await page.goto(base);
  await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering' || globalThis.__flight?.error, null, { timeout: 120000 });
  assert.equal(await page.evaluate(() => globalThis.__flight.error), null);
  await page.locator('#scrub').evaluate((el) => { el.value = '11.2'; el.dispatchEvent(new Event('input')); });
  // Wait for streaming and camera invalidations to settle; paused smoke must retain exact pixels.
  let stable = false;
  for (let i = 0; i < 120; i++) {
    const renders = await page.evaluate(() => globalThis.__flight.renders);
    await page.waitForTimeout(250);
    if (renders === await page.evaluate(() => globalThis.__flight.renders)) { stable = true; break; }
  }
  assert.ok(stable, 'paused scene settles');
  const paused = await page.locator('#canvas').screenshot();
  await page.waitForTimeout(500);
  assert.deepEqual(await page.locator('#canvas').screenshot(), paused);
  assert.ok((await smokeParticles()).length > 0);
  await page.screenshot({ path: 'captures/damage-smoke-headed-paused.png' });

  const results = [];
  for (const mode of ['chase-near', 'chase-mid', 'chase-far']) {
    console.log('GPU export', mode);
    await page.goto(base + '&videoExport=1&exportView=' + encodeURIComponent(JSON.stringify({ mode })));
    await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering' || globalThis.__flight?.error, null, { timeout: 120000 });
    assert.equal(await page.evaluate(() => globalThis.__flight.error), null);
    // ready() hands the frame loop over to the exporter. Let the ordinary streamer fill the bridge first.
    let residentCount = 0;
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(250);
      const count = await page.evaluate(() => Array.from(globalThis.__smokeEngine.cells.all()).length);
      if (count > 50 && count === residentCount) break;
      residentCount = count;
    }
    await page.evaluate(() => globalThis.__flightVideoExport.ready());
    await frame(11.2);
    await page.waitForTimeout(500);
    await frame(11.2);
    await page.evaluate(() => {
      const engine = globalThis.__smokeEngine;
      const spawn = engine.spawnParticleAt.bind(engine);
      engine.spawnParticleAt = (...args) => {
        if (!globalThis.__hideDamageSmoke || args[1] !== 0) spawn(...args);
      };
    });
    await frame(9.687, mode + '-pre-impact');
    assert.equal((await smokeParticles()).length, 0, 'no smoke before the real damage sample');
    const onset = await frame(9.9, mode + '-onset');
    const early = await smokeParticles();
    assert.ok(early.length > 0 && early.every((p) => -p[7] >= 9.830244), 'prompt, causal damage emission');
    await page.evaluate(() => { globalThis.__hideDamageSmoke = true; });
    const onsetOff = await frame(9.9);
    await page.evaluate(() => { globalThis.__hideDamageSmoke = false; });
    const onsetPixels = difference(onset, onsetOff);
    assert.ok(onsetPixels > 20, `${mode}: smoke visible within 70 ms of the damage sample`);
    const on = await frame(11.2, mode);
    const camera = await page.evaluate(() => ({ state: globalThis.__flight.cameraState, cells: globalThis.__flight.cells }));
    const particles = await smokeParticles();
    await page.waitForTimeout(200);
    assert.deepEqual(await smokeParticles(), particles, 'pause retains the smoke window');
    await page.evaluate(() => { globalThis.__hideDamageSmoke = true; });
    const off = await frame(11.2, mode + '-without-smoke');
    await page.evaluate(() => { globalThis.__hideDamageSmoke = false; });
    const changed = difference(on, off);
    assert.ok(changed > 250, `${mode}: smoke must be visible (${changed} pixels)`);
    await frame(1);
    assert.equal((await smokeParticles()).length, 0, 'rewind clears old damage particles');
    await frame(11.2);
    assert.deepEqual(await smokeParticles(), particles, 'seek/export reconstruct identical particles');
    results.push({ mode, changedPixels: changed, onsetPixels, particles: particles.length, onsetParticles: early.length, camera });
  }
  console.log('Bridge side view');
  const eye = [-1625, 72, 1520], target = [-1622, 41, 1616];
  const view = {
    mode: 'free', position: eye,
    pitch: Math.atan2(target[1] - eye[1], Math.hypot(target[0] - eye[0], target[2] - eye[2])),
    yaw: Math.atan2(target[0] - eye[0], -(target[2] - eye[2])),
  };
  await page.goto(base + '&videoExport=1&exportView=' + encodeURIComponent(JSON.stringify(view)));
  await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering' || globalThis.__flight?.error, null, { timeout: 120000 });
  await page.waitForTimeout(4000);
  await page.evaluate(() => globalThis.__flightVideoExport.ready());
  for (let i = 0; i < 4; i++) await frame(11.2);
  await frame(11.2, 'bridge-side');
  assert.ok((await smokeParticles()).length > 0);
  assert.deepEqual(errors, []);
  writeFileSync('captures/damage-smoke-result.json', JSON.stringify({ results, errors, pausedStable: true }, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
