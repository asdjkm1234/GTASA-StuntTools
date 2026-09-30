/** Real v10 Hydra recording: gauges, damage transition, pause/scrub and GPU export. Fresh Chrome only. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

mkdirSync('captures', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
// Inspect actual atlas drawing in this disposable test browser, including endpoint needles.
await page.addInitScript(() => {
  const prototype = CanvasRenderingContext2D.prototype,
    clear = prototype.clearRect,
    fillText = prototype.fillText,
    rotate = prototype.rotate;
  prototype.clearRect = function (...args) {
    if (this.canvas.width === 1024 && this.canvas.height === 1024)
      globalThis.__gaugeDraw = { labels: [], rotations: [] };
    return clear.apply(this, args);
  };
  prototype.fillText = function (...args) {
    if (this.canvas.width === 1024 && this.canvas.height === 1024 && globalThis.__gaugeDraw) {
      const matrix = this.getTransform();
      globalThis.__gaugeDraw.labels.push({ text: args[0], x: matrix.e, y: matrix.f });
    }
    return fillText.apply(this, args);
  };
  prototype.rotate = function (angle) {
    if (this.canvas.width === 1024 && this.canvas.height === 1024 && globalThis.__gaugeDraw) {
      const matrix = this.getTransform();
      globalThis.__gaugeDraw.rotations.push({ angle, x: matrix.e, y: matrix.f });
    }
    return rotate.call(this, angle);
  };
});
const failures = [];
const realCsv = readFileSync('../../GTA San Andreas/flight_recordings/flight_20260930_220316_220_m520_002.csv', 'utf8');
let csvBody = realCsv;
page.on('pageerror', (e) => failures.push(e.message));
page.on('console', (m) => {
  if (/validation error|device.*lost|invalid shader|Invalid CommandBuffer/i.test(m.text())) failures.push(m.text());
});
await page.route('**/local-recording/latest.csv', (r) =>
  r.fulfill({
    contentType: 'text/csv',
    body: csvBody,
  }),
);
async function seek(s) {
  await page.locator('#scrub').evaluate((e, value) => {
    e.value = String(value);
    e.dispatchEvent(new Event('input', { bubbles: true }));
  }, s);
  await page.waitForFunction((value) => Math.abs(globalThis.__flight.instrumentState?.s - value) < 0.002, s);
  await page.waitForTimeout(300);
  return page.evaluate(() => globalThis.__flight.instrumentState);
}
async function shot(name, clean = false) {
  const style = clean
    ? await page.addStyleTag({ content: 'body > :not(#canvas):not(script) { visibility:hidden !important; }' })
    : null;
  await page.locator('#canvas').screenshot({ path: `captures/cockpit-instruments-${name}.png` });
  if (style) await style.evaluate((e) => e.remove());
}
try {
  await page.goto('http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&weather=10&hour=12&axes=0');
  await page.waitForFunction(
    () => globalThis.__flight?.phase === 'rendering' && globalThis.__flight.instrumentState,
    null,
    { timeout: 90000 },
  );
  for (let i = 0; i < 3; i++) await page.locator('#follow').click();
  await page.waitForTimeout(2000);
  await shot('normal-eye');
  await page.locator('#cockpitLook').click();
  await page.mouse.move(500, 450);
  await page.mouse.down();
  await page.mouse.move(500, 495, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await shot('dashboard');
  await shot('dashboard-clean', true);
  const before = await seek(116.9);
  assert.deepEqual(before.damage, [0, 0, 0, 0, 0]);
  const after = await seek(117.1);
  assert.deepEqual(after.damage, [0, 0, 0, 0, 1]);
  assert(after.health < 0.9);
  assert(after.healthDisplay > after.health, 'The real impact must animate the health display');
  await shot('damage');
  const uploads = await page.evaluate(() => globalThis.__flight.instrumentUploads);
  await page.waitForTimeout(500);
  assert.equal(
    await page.evaluate(() => globalThis.__flight.instrumentUploads),
    uploads,
    'Paused gauges must not upload again',
  );
  assert.deepEqual((await seek(116.9)).damage, before.damage);
  await seek(30);
  await shot('flight');
  await page.mouse.move(500, 450);
  await page.mouse.down();
  await page.mouse.move(637, 450, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await shot('side');
  assert.equal(await page.locator('#analysis-hud, .analysis-hud').count(), 0);
  const report = { before, after, uploads, failures };
  // Explicitly SYNTHETIC key input over four real local poses, to exercise the published v11 consumer.
  const lines = realCsv.trim().split(/\r?\n/),
    headerIndex = lines.findIndex((l) => l.startsWith('local_timestamp,'));
  const columns = lines[headerIndex].split(','),
    timeColumn = columns.indexOf('capture_elapsed_s');
  const keyRows = [
    [1, 0, 1, 0, 1],
    [0, 0, 0, 0, 1],
    [0, 1, 0, 1, 1],
    [-1, -1, -1, -1, 0],
  ];
  const times = [];
  const bodyRows = lines
    .slice(headerIndex + 1)
    .filter((l) => !l.startsWith('#'))
    .slice(0, 4)
    .map((l, i) => {
      const values = l.split(',');
      values[timeColumn] = String(i * 0.04); // Align the synthetic key edges with the scrubber's 1 ms precision.
      times.push(i * 0.04);
      for (const name of ['key_q', 'key_a', 'key_e', 'key_d', 'key_up', 'key_down'])
        values[columns.indexOf(name)] = '0';
      return [...values, ...keyRows[i]].join(',');
    });
  csvBody =
    '# gtasa_flight_recorder,version=11,sample_hz=25\n' +
    columns.join(',') +
    ',key_w,key_s,key_left,key_right,keyboard_state_valid\n' +
    bodyRows.join('\n');
  await page.goto('http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&weather=10&hour=12');
  await page.waitForFunction(
    () => globalThis.__flight?.phase === 'rendering' && globalThis.__flight.instrumentState?.throttleSource === 'keys',
    null,
    { timeout: 90000 },
  );
  for (let i = 0; i < 3; i++) await page.locator('#follow').click();
  const keyboardStates = [];
  for (let i = 0; i < times.length; i++) {
    const state = await seek(times[i]);
    keyboardStates.push(state.throttle);
    await shot(`synthetic-keys-${i}`);
  }
  assert.deepEqual(keyboardStates, [1, 0.5, 0, null]);
  report.syntheticKeyboardThrottle = keyboardStates;
  // Synthetic repeated control changes and repair, rendered on the real local cockpit model.
  const template = lines[headerIndex + 1].split(',');
  csvBody =
    '# gtasa_flight_recorder,version=11,sample_hz=25\n' +
    columns.join(',') +
    ',key_w,key_s,key_left,key_right,keyboard_state_valid\n' +
    Array.from({ length: 151 }, (_, i) => {
      const values = [...template],
        s = i * 0.04;
      values[timeColumn] = String(s);
      values[columns.indexOf('health')] = String(s < 1 ? 1000 : s < 3 ? 200 : 750);
      const valid = s < 5 || s >= 5.4;
      const w = s < 1 || (s >= 1.12 && s < 2) || (s >= 4 && s < 5);
      const down = (s >= 1 && s < 1.12) || (s >= 3 && s < 4);
      return [...values, valid ? +w : -1, valid ? +down : -1, valid ? 0 : -1, valid ? 0 : -1, +valid].join(',');
    }).join('\n');
  await page.goto('http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&weather=10&hour=12&axes=0');
  await page.waitForFunction(
    () => globalThis.__flight?.phase === 'rendering' && globalThis.__flight.instrumentState,
    null,
    { timeout: 90000 },
  );
  for (let i = 0; i < 3; i++) await page.locator('#follow').click();
  await page.locator('#cockpitLook').click();
  await page.mouse.move(500, 450);
  await page.mouse.down();
  await page.mouse.move(500, 495, { steps: 12 });
  await page.mouse.up();
  report.syntheticLevelAnimation = [];
  for (const s of [1, 1.08, 1.12, 1.2, 1.44, 3, 3.14, 3.44, 4.14, 4.44, 5, 5.4]) {
    const state = await seek(s);
    const labels = await page.evaluate(() => globalThis.__gaugeDraw.labels);
    assert(labels.some((r) => r.x === 0 && r.y === 360 && r.text === `${Math.round(state.healthDisplay * 100)}%`));
    assert(
      labels.some(
        (r) =>
          r.x === 0 &&
          r.y === 512 &&
          r.text === (state.throttleDisplay === null ? '--' : `${Math.round(state.throttleDisplay * 100)}%`),
      ),
    );
    report.syntheticLevelAnimation.push(state);
    if ([1, 1.08, 1.2, 1.44].includes(s)) await shot(`synthetic-animation-${s}`, true);
  }
  const animated = report.syntheticLevelAnimation;
  assert.equal(animated[0].health, 0.2);
  assert.equal(animated[0].healthDisplay, 1);
  assert.equal(animated[0].throttle, 0);
  assert.equal(animated[0].throttleDisplay, 1);
  assert(animated[1].healthDisplay < 1 && animated[1].healthDisplay > 0.2);
  assert(animated[1].throttleDisplay < 1 && animated[1].throttleDisplay > 0);
  assert(animated[3].throttleDisplay > animated[2].throttleDisplay, 'Reversal must continue from the current display');
  assert(Math.abs(animated[4].healthDisplay - 0.2) < 1e-9);
  assert.equal(animated[4].throttleDisplay, 1);
  assert(animated[6].healthDisplay > 0.2 && animated[6].healthDisplay < 0.75);
  assert(Math.abs(animated[7].healthDisplay - 0.75) < 1e-9);
  assert.equal(animated[7].throttleDisplay, 0);
  assert(animated[8].throttleDisplay > 0 && animated[8].throttleDisplay < 1);
  assert.equal(animated[9].throttleDisplay, 1);
  assert.equal(animated[10].throttleDisplay, null);
  assert.equal(animated[11].throttleDisplay, 0.5);
  const rewind = await seek(1.2);
  assert.deepEqual(rewind, animated[3]);
  const animationUploads = await page.evaluate(() => globalThis.__flight.instrumentUploads);
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => globalThis.__flight.instrumentUploads), animationUploads);
  // Clearly synthetic range/jitter fixtures; retain the real local model's recorded orientation.
  report.syntheticGaugeRanges = [];
  for (const [kmh, z, tag] of [
    [270, 800, 'cruise'],
    [300, 1000, 'full-scale'],
    [350, 1250, 'over-range'],
    [0, -15, 'below-zero'],
  ]) {
    const fixtureRows = Array.from({ length: 151 }, (_, i) => {
      const values = [...template],
        s = i * 0.04;
      values[timeColumn] = String(s);
      values[columns.indexOf('x')] = String(
        +template[columns.indexOf('x')] + (kmh / 3.6) * s + (tag === 'cruise' ? 0.024 * Math.sin(10 * Math.PI * s) : 0),
      );
      values[columns.indexOf('z')] = String(z);
      return values.join(',');
    });
    csvBody = '# gtasa_flight_recorder,version=10,sample_hz=25\n' + columns.join(',') + '\n' + fixtureRows.join('\n');
    await page.goto('http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&weather=10&hour=12&axes=0');
    await page.waitForFunction(
      () => globalThis.__flight?.phase === 'rendering' && globalThis.__flight.instrumentState,
      null,
      { timeout: 90000 },
    );
    for (let i = 0; i < 3; i++) await page.locator('#follow').click();
    await page.locator('#cockpitLook').click();
    await page.mouse.move(500, 450);
    await page.mouse.down();
    await page.mouse.move(500, 495, { steps: 12 });
    await page.mouse.up();
    const state = await seek(4);
    assert(Math.abs(state.speedKmh - kmh) < 0.2);
    assert.equal(state.altitude, z);
    const draw = await page.evaluate(() => globalThis.__gaugeDraw);
    const labels = (x) => draw.labels.filter((r) => r.x === x && r.y === 0).map((r) => r.text);
    assert(labels(0).includes('300') && !labels(0).includes('900'), 'Speed dial must end at 300');
    assert(labels(680).includes('1000'), 'Altitude dial must end at 1000');
    assert.equal(labels(0).includes('OVR'), kmh > 300);
    assert.equal(labels(680).includes('OVR'), z > 1000);
    assert.equal(labels(680).includes('LOW'), z < 0);
    const altitudeNeedle = draw.rotations.find((r) => r.x === 830 && r.y === 150);
    assert(
      Math.abs(altitudeNeedle.angle - ((-135 + (Math.min(1000, Math.max(0, z)) / 1000) * 270) * Math.PI) / 180) < 1e-9,
    );
    await shot(`synthetic-range-${tag}`, true);
    report.syntheticGaugeRanges.push({
      tag,
      state,
      labels: { speed: labels(0), altitude: labels(680) },
      altitudeNeedle,
    });
  }
  csvBody = realCsv;
  const view = encodeURIComponent(JSON.stringify({ mode: 'cockpit-look', cockpitLookPose: { yaw: 0, pitch: -0.18 } }));
  await page.goto(
    `http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&weather=10&hour=0&videoExport=1&exportView=${view}`,
  );
  await page.waitForFunction(() => globalThis.__flightVideoExport && globalThis.__flight?.phase === 'rendering', null, {
    timeout: 90000,
  });
  const exported = await page.evaluate(async () => {
    const ready = await globalThis.__flightVideoExport.ready();
    const bytes = await globalThis.__flightVideoExport.renderFrame(117.1);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return { ready, base64: btoa(binary), state: globalThis.__flight.instrumentState };
  });
  const png = new PNG({ width: 1920, height: 1080 });
  png.data = Buffer.from(exported.base64, 'base64');
  assert.equal(png.data.length, 1920 * 1080 * 4);
  assert.deepEqual(exported.state.damage, after.damage);
  assert.equal(exported.state.healthDisplay, after.healthDisplay);
  assert.equal(exported.state.throttleDisplay, after.throttleDisplay);
  writeFileSync('captures/cockpit-instruments-export-night.png', PNG.sync.write(png));
  report.export = { state: exported.state, compositor: exported.ready.compositor };
  assert.deepEqual(failures, []);
  writeFileSync('captures/cockpit-instruments.json', JSON.stringify(report, null, 2));
  console.log('PASS cockpit instruments', JSON.stringify(report));
} finally {
  await browser.close();
}
