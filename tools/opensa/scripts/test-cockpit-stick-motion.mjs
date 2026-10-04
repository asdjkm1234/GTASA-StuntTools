/** Published WebGPU replay: real linkage and explicitly synthetic directional screenshots. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

mkdirSync('captures', { recursive: true });
const real = readFileSync('../../GTA San Andreas/flight_recordings/flight_20260930_220316_220_m520_002.csv', 'utf8');
let csv = real;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const failures = [];
page.on('pageerror', (e) => failures.push(e.message));
page.on('console', (m) => {
  if (/validation error|device.*lost|invalid shader|Invalid CommandBuffer/i.test(m.text())) failures.push(m.text());
});
await page.route('**/local-recording/latest.csv', (r) => r.fulfill({ contentType: 'text/csv', body: csv }));
const url = 'http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&weather=10&hour=12';
async function ready() {
  await page.waitForFunction(
    () => globalThis.__flight?.phase === 'rendering' && globalThis.__flight.stickMotion,
    null,
    { timeout: 90000 },
  );
}
async function seek(s) {
  await page.locator('#scrub').evaluate((e, value) => {
    e.value = String(value);
    e.dispatchEvent(new Event('input', { bubbles: true }));
  }, s);
  await page.waitForFunction((s) => Math.abs(globalThis.__flight.instrumentState?.s - s) < 0.002, s);
  await page.waitForTimeout(250);
  return page.evaluate(() => globalThis.__flight.stickMotion);
}
async function cockpit() {
  for (let i = 0; i < 3; i++) await page.locator('#follow').click();
  await page.locator('#cockpitLook').click();
  await page.mouse.move(500, 450);
  await page.mouse.down();
  await page.mouse.move(500, 495, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(1000);
}
async function shot(label) {
  const style = await page.addStyleTag({
    content: 'body > :not(#canvas):not(script) { visibility:hidden !important; }',
  });
  const bytes = await page.locator('#canvas').screenshot({ path: `captures/cockpit-stick-motion-${label}.png` });
  await style.evaluate((e) => e.remove());
  return PNG.sync.read(bytes);
}
try {
  await page.goto(url);
  await ready();
  await cockpit();
  const realRight = await seek(11.862);
  assert(realRight.pitch > 0 && realRight.roll > 0);
  await shot('real-pull-right');
  const realLeft = await seek(8.003);
  assert(realLeft.roll < 0);
  assert.deepEqual(await seek(11.862), realRight, 'Rewind must reproduce motion');
  await page.waitForTimeout(500);
  assert.deepEqual(await page.evaluate(() => globalThis.__flight.stickMotion), realRight, 'Pause freezes motion');

  // Same real root pose for all rows; ONLY synthetic node angles differ, independent of keyboard.
  const lines = real.trim().split(/\r?\n/);
  const headerAt = lines.findIndex((l) => l.startsWith('local_timestamp,'));
  const columns = lines[headerAt].split(',');
  const base = lines
    .slice(headerAt + 1)
    .find((l) => !l.startsWith('#'))
    .split(',');
  const states = [
    ['neutral', 0, 0],
    ['push', 0.4, 0],
    ['pull', -0.4, 0],
    ['left', 0, -0.45],
    ['right', 0, 0.45],
    ['pull-right', -0.4, 0.45],
  ];
  const rows = states.map(([, pitch, roll], i) => {
    const values = [...base];
    values[columns.indexOf('capture_elapsed_s')] = String(i);
    for (const name of ['key_up', 'key_down', 'key_a', 'key_d']) values[columns.indexOf(name)] = '0';
    for (const [name, angle] of [
      ['elevator_l', pitch],
      ['elevator_r', pitch],
      ['aileron_l', roll],
      ['aileron_r', -roll],
    ]) {
      for (const [axis, value] of [
        ['x', Math.sin(angle / 2)],
        ['y', 0],
        ['z', 0],
        ['w', Math.cos(angle / 2)],
      ]) {
        const at = columns.indexOf(`${name}_q${axis}`);
        assert(at >= 0, `Missing quaternion column: ${name}_q${axis}`);
        values[at] = String(value);
      }
    }
    return values.join(',');
  });
  csv = '# gtasa_flight_recorder,version=10,sample_hz=25\n' + columns.join(',') + '\n' + rows.join('\n');
  await page.goto(url);
  await ready();
  await cockpit();
  const synthetic = [];
  const images = [];
  for (let i = 0; i < states.length; i++) {
    const motion = await seek(i);
    const [, pitch, roll] = states[i];
    assert.equal(Math.sign(motion.pitch), Math.sign(-pitch));
    assert.equal(Math.sign(motion.roll), Math.sign(roll));
    synthetic.push({ label: states[i][0], ...motion });
    images.push(await shot(`synthetic-${states[i][0]}`));
  }
  const differences = images.slice(1).map((image) => {
    let changed = 0;
    const neutral = images[0];
    // Central lower cockpit: directional motion must actually change rendered stick pixels.
    for (let y = 600; y < 1000; y++)
      for (let x = 500; x < 1100; x++) {
        const at = (y * image.width + x) * 4;
        if ([0, 1, 2].some((c) => Math.abs(image.data[at + c] - neutral.data[at + c]) > 8)) changed++;
      }
    assert(changed > 100, 'Moving geometry must be visible');
    return changed;
  });
  assert.deepEqual(await seek(2), {
    pitch: synthetic[2].pitch,
    roll: synthetic[2].roll,
    rotation: synthetic[2].rotation,
  });
  const between = await seek(0.5);
  assert(between.pitch < 0 && between.pitch > synthetic[1].pitch, 'Interpolated surface frames must move smoothly');

  const view = encodeURIComponent(JSON.stringify({ mode: 'cockpit-look', cockpitLookPose: { yaw: 0, pitch: -0.18 } }));
  await page.goto(url.replace('hour=12', 'hour=0') + `&videoExport=1&exportView=${view}`);
  await ready();
  const exported = await page.evaluate(async () => {
    const api = globalThis.__flightVideoExport;
    await api.ready();
    const bytes = await api.renderFrame(5);
    const motion = globalThis.__flight.stickMotion;
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    return { motion, length: bytes.length, base64: btoa(binary) };
  });
  assert.deepEqual(exported.motion, {
    pitch: synthetic[5].pitch,
    roll: synthetic[5].roll,
    rotation: synthetic[5].rotation,
  });
  assert.equal(exported.length, 1920 * 1080 * 4);
  const png = new PNG({ width: 1920, height: 1080 });
  png.data = Buffer.from(exported.base64, 'base64');
  writeFileSync('captures/cockpit-stick-motion-export.png', PNG.sync.write(png));
  assert.deepEqual(failures, []);
  const report = { realRight, realLeft, synthetic, differences, exportLength: exported.length, failures };
  writeFileSync('captures/cockpit-stick-motion.json', JSON.stringify(report, null, 2));
  console.log('PASS', JSON.stringify(report));
} finally {
  await browser.close();
}
