/** Real + explicitly synthetic rudder linkage, visual clearance and night GPU export. Fresh Chrome. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

mkdirSync('captures', { recursive: true });
const real = readFileSync('../../GTA San Andreas/flight_recordings/flight_20260930_220316_220_m520_002.csv', 'utf8');
let csv = real;
const headed = process.argv.includes('--headed');
const browser = await chromium.launch({
  args: headed ? [] : ['--enable-unsafe-webgpu'],
  channel: 'chrome',
  headless: !headed,
});
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
    () => globalThis.__flight?.phase === 'rendering' && globalThis.__flight.pedalMotion,
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
  await page.waitForTimeout(300);
  return page.evaluate(() => globalThis.__flight.pedalMotion);
}
async function cockpit() {
  for (let i = 0; i < 3; i++) await page.locator('#follow').click();
  await page.setViewportSize({ width: 1920, height: 911 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'captures/cockpit-pedals-default-wide-ui.png' });
  await shot('default-wide');
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.waitForTimeout(500);
  await shot('normal-eye');
  await page.locator('#cockpitLook').click();
  await page.setViewportSize({ width: 1920, height: 911 });
  await page.waitForFunction(
    () => !document.querySelector('#mapLoading') || document.querySelector('#mapLoading').hidden,
    null,
    { timeout: 90000 },
  );
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'captures/cockpit-pedals-default-look-ui.png' });
  await shot('default-look');
  await page.mouse.move(500, 450);
  await page.mouse.down();
  await page.mouse.move(500, 540, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'captures/cockpit-pedals-compact-footwell-ui.png' });
  await shot('compact-footwell');
  await page.locator('#cockpitLook').click();
  await page.locator('#cockpitLook').click();
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.waitForTimeout(1200);
}
async function shot(label) {
  const style = await page.addStyleTag({
    content: 'body > :not(#canvas):not(script) { visibility:hidden !important; }',
  });
  const bytes = await page.locator('#canvas').screenshot({ path: `captures/cockpit-pedals-${label}.png` });
  await style.evaluate((e) => e.remove());
  return PNG.sync.read(bytes);
}
try {
  await page.goto(url);
  await ready();
  await cockpit();
  const left = await seek(11.862);
  assert(left.control < 0 && left.leftTravel > 0 && left.source === 'recorded');
  assert.equal(left.rightTravel, 0);
  await shot('real-left');
  const right = await seek(8.003);
  assert(right.control > 0 && right.rightTravel > 0);
  assert.equal(right.leftTravel, 0);
  assert.deepEqual(await seek(11.862), left);
  await page.waitForTimeout(500);
  assert.deepEqual(await page.evaluate(() => globalThis.__flight.pedalMotion), left);

  const lines = real.trim().split(/\r?\n/);
  const head = lines.findIndex((l) => l.startsWith('local_timestamp,'));
  const columns = lines[head].split(',');
  const base = lines
    .slice(head + 1)
    .find((l) => !l.startsWith('#'))
    .split(',');
  const states = [
    ['neutral', 0, 0, 0],
    ['left', -40, 0, 1],
    ['right', 40, 1, 0],
    ['center', 0, 1, 0],
    ['unknown-left', null, 1, 0],
    ['unknown-right', null, 0, 1],
  ];
  const rows = states.map(([, degrees, q, e], i) => {
    const values = [...base];
    values[columns.indexOf('capture_elapsed_s')] = String(i);
    values[columns.indexOf('key_q')] = String(q);
    values[columns.indexOf('key_e')] = String(e);
    const angle = (degrees * Math.PI) / 180;
    for (const [axis, value] of [
      ['x', 0],
      ['y', 0],
      ['z', Math.sin(angle / 2)],
      ['w', Math.cos(angle / 2)],
    ])
      values[columns.indexOf(`rudder_q${axis}`)] = degrees === null ? 'nan' : String(value);
    return values.join(',');
  });
  csv = '# gtasa_flight_recorder,version=10,sample_hz=25\n' + columns.join(',') + '\n' + rows.join('\n');
  await page.goto(url);
  await ready();
  await cockpit();
  const motions = [],
    images = [];
  for (let i = 0; i < states.length; i++) {
    const motion = await seek(i);
    motions.push(motion);
    images.push(await shot(`synthetic-${states[i][0]}`));
  }
  assert.equal(motions[0].control, 0);
  assert(motions[1].leftTravel > 0 && motions[2].rightTravel > 0);
  assert.equal(motions[3].control, 0, 'Recorded neutral overrides pressed E');
  assert(motions[4].control === 0 && motions[4].source === 'unknown');
  assert(motions[5].control === 0 && motions[5].source === 'unknown');
  const halfway = await seek(0.5);
  assert(halfway.leftTravel > 0 && halfway.leftTravel < motions[1].leftTravel);
  const pixels = images.slice(1, 3).map((image) => {
    let changed = 0;
    for (let y = 650; y < 1100; y++)
      for (let x = 350; x < 1250; x++) {
        const at = (y * image.width + x) * 4;
        if ([0, 1, 2].some((c) => Math.abs(image.data[at + c] - images[0].data[at + c]) > 8)) changed++;
      }
    assert(changed > 100, 'Pedal motion must visibly change the footwell');
    return changed;
  });
  // Fixed synthetic body, close side/underside cameras: inspect attachment/face clearance at full stroke.
  const number = (column) => Number(base[columns.indexOf(column)]);
  const position = [number('x'), number('z'), -number('y')];
  const axes = ['right', 'forward', 'up'].map((name) => [
    number(`${name}_x`),
    number(`${name}_z`),
    -number(`${name}_y`),
  ]);
  const world = (point) =>
    position.map((value, axis) => value + point.reduce((sum, v, i) => sum + v * axes[i][axis], 0));
  for (const side of [-1, 1]) {
    const eye = world([side * 0.32, 2.78, 0.18]);
    const target = world([0, 3.82, 0.14]);
    const direction = target.map((value, axis) => value - eye[axis]);
    const sideView = {
      mode: 'free',
      position: eye,
      yaw: Math.atan2(direction[0], -direction[2]),
      pitch: Math.atan2(direction[1], Math.hypot(direction[0], direction[2])),
    };
    await page.goto(url + `&videoExport=1&exportView=${encodeURIComponent(JSON.stringify(sideView))}`);
    await ready();
    let neutral;
    for (const time of [0, 1, 2]) {
      const frame = await page.evaluate(async (time) => {
        await globalThis.__flightVideoExport.ready();
        const bytes = await globalThis.__flightVideoExport.renderFrame(time);
        let binary = '';
        for (let at = 0; at < bytes.length; at += 32768)
          binary += String.fromCharCode(...bytes.subarray(at, at + 32768));
        return { motion: globalThis.__flight.pedalMotion, base64: btoa(binary) };
      }, time);
      assert.deepEqual(frame.motion, motions[time]);
      const image = new PNG({ width: 1920, height: 1080 });
      image.data = Buffer.from(frame.base64, 'base64');
      if (time === 0) neutral = image.data;
      else {
        let changed = 0;
        for (let at = 0; at < image.data.length; at += 4)
          if ([0, 1, 2].some((c) => Math.abs(image.data[at + c] - neutral[at + c]) > 8)) changed++;
        assert(changed > 100, 'Close footwell camera must see the moving pedal, not an occluding cabin wall');
      }
      writeFileSync(`captures/cockpit-pedals-footwell-side-${side}-${states[time][0]}.png`, PNG.sync.write(image));
    }
  }
  const view = encodeURIComponent(JSON.stringify({ mode: 'cockpit-look', cockpitLookPose: { yaw: 0, pitch: -0.5 } }));
  await page.goto(url.replace('hour=12', 'hour=0') + `&videoExport=1&exportView=${view}`);
  await ready();
  const exported = await page.evaluate(async () => {
    await globalThis.__flightVideoExport.ready();
    const bytes = await globalThis.__flightVideoExport.renderFrame(2);
    let binary = '';
    for (let at = 0; at < bytes.length; at += 32768) binary += String.fromCharCode(...bytes.subarray(at, at + 32768));
    return { motion: globalThis.__flight.pedalMotion, base64: btoa(binary) };
  });
  assert.deepEqual(exported.motion, motions[2]);
  const png = new PNG({ width: 1920, height: 1080 });
  png.data = Buffer.from(exported.base64, 'base64');
  assert.equal(png.data.length, 1920 * 1080 * 4);
  writeFileSync('captures/cockpit-pedals-export-night.png', PNG.sync.write(png));
  assert.deepEqual(failures, []);
  const report = { right, left, motions, pixels, failures };
  writeFileSync('captures/cockpit-pedals.json', JSON.stringify(report, null, 2));
  console.log('PASS', JSON.stringify(report));
} finally {
  await browser.close();
}
