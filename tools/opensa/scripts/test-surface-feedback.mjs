/** Published WebGPU controls: real CSV, v12, inverted pose, missing/detached nodes and encoded export. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

mkdirSync('captures', { recursive: true });
const real = readFileSync('../../GTA San Andreas/flight_recordings/flight_20260930_220316_220_m520_002.csv', 'utf8');
let csv = real;
const browser = await chromium.launch({ channel: 'chrome', headless: !process.argv.includes('--headed') });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const failures = [];
page.on('pageerror', (e) => failures.push(e.message));
page.on('console', (m) => {
  if (/validation error|device.*lost|invalid shader|Invalid CommandBuffer/i.test(m.text())) failures.push(m.text());
});
await page.route('**/local-recording/latest.csv', (r) => r.fulfill({ contentType: 'text/csv', body: csv }));
const url = 'http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&weather=10&hour=12';
const probe = () =>
  page.evaluate(() => ({
    controls: __flight.controls,
    visible: __flight.controlsVisible,
    camera: __flight.cameraMode,
    stick: __flight.stickMotion,
    pedals: __flight.pedalMotion,
    throttle: __flight.instrumentState.throttle,
  }));
async function ready(target = url) {
  await page.goto(target);
  await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering' && globalThis.__flight.controls, null, {
    timeout: 90000,
  });
  if (!target.includes('videoExport=1')) await page.locator('#resetView').click();
  await page.locator('#mapLoading').waitFor({ state: 'hidden', timeout: 120000 });
  assert.equal(await page.locator('#keys').count(), 0);
}
async function seek(s) {
  await page.locator('#scrub').evaluate((e, s) => {
    e.value = String(s);
    e.dispatchEvent(new Event('input', { bubbles: true }));
  }, s);
  await page.waitForFunction((s) => Math.abs(__flight.instrumentState.s - s) < 0.002, s);
  await page.waitForTimeout(150);
  return probe();
}
async function exported(s, label) {
  const frame = await page.evaluate(async (s) => {
    const api = globalThis.__flightVideoExport;
    const bytes = await api.renderFrame(s);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return { base64: btoa(binary), visible: __flight.controlsVisible, layout: __flight.hudExportLayout };
  }, s);
  const png = new PNG({ width: 1920, height: 1080 });
  png.data = Buffer.from(frame.base64, 'base64');
  writeFileSync(`captures/surface-feedback-${label}.png`, PNG.sync.write(png));
  return { png, visible: frame.visible, layout: frame.layout };
}
try {
  await ready();
  const screenshotPose = await seek(1.499);
  assert(screenshotPose.controls.yaw.value > 0 && screenshotPose.pedals.rightTravel > 0);
  assert.equal(screenshotPose.pedals.leftTravel, 0);
  await page.screenshot({ path: 'captures/surface-feedback-pedals-corrected-1.499.png' });
  const measured = await seek(11.862);
  assert(
    measured.visible &&
      measured.controls.roll.value > 0 &&
      measured.controls.pitch.value > 0 &&
      measured.controls.yaw.value < 0,
  );
  await page.screenshot({ path: 'captures/surface-feedback-real.png' });

  const lines = real.trim().split(/\r?\n/),
    head = lines.findIndex((l) => l.startsWith('local_timestamp,'));
  const oldColumns = lines[head].split(','),
    base = lines
      .slice(head + 1)
      .find((l) => !l.startsWith('#'))
      .split(',');
  const removed = new Set(['key_q', 'key_e', 'key_a', 'key_d', 'key_up', 'key_down', 'key_left', 'key_right']);
  const columns = oldColumns.filter((c) => !removed.has(c));
  for (const name of ['key_w', 'key_s', 'keyboard_state_valid']) if (!columns.includes(name)) columns.push(name);
  const rows = Array.from({ length: 7 }, (_, i) => {
    const row = Object.fromEntries(oldColumns.map((c, j) => [c, base[j]]));
    row.capture_elapsed_s = String(i);
    row.key_w = i === 4 ? '1' : '0';
    row.key_s = i === 4 ? '1' : '0';
    row.keyboard_state_valid = '1';
    row.node_status = i === 2 ? '0' : '31';
    row.surface_damage_valid = '31';
    row.surface_damage_source = 'game_memory';
    row.plane_damage_raw = i === 3 ? String(2 << 8) : '0';
    for (const n of ['rudder', 'elevator_l', 'elevator_r', 'aileron_l', 'aileron_r'])
      row[n + '_damage'] = i === 3 && n === 'rudder' ? '2' : '0';
    for (const [name, axis, angle] of [
      ['rudder', 'z', i === 5 ? 0 : i === 6 ? -0.7 : 0.7],
      ['elevator_l', 'x', -0.3],
      ['elevator_r', 'x', -0.3],
      ['aileron_l', 'x', 0.4],
      ['aileron_r', 'x', -0.4],
    ]) {
      for (const c of ['x', 'y', 'z', 'w'])
        row[name + '_q' + c] =
          i === 2 ? 'nan' : String(c === 'w' ? Math.cos(angle / 2) : c === axis ? Math.sin(angle / 2) : 0);
    }
    if (i === 1)
      for (const a of ['right', 'up'])
        for (const c of ['x', 'y', 'z']) row[a + '_' + c] = String(-Number(row[a + '_' + c]));
    return columns.map((c) => row[c] ?? '-1').join(',');
  });
  csv = '# gtasa_flight_recorder,version=12,sample_hz=25\n' + columns.join(',') + '\n' + rows.join('\n');
  await ready();
  const upright = await seek(0),
    inverted = await seek(1);
  assert.deepEqual(inverted.controls, upright.controls, 'Inversion must not invert body-local surface feedback');
  assert.deepEqual(inverted.stick, upright.stick);
  assert.deepEqual(inverted.pedals, upright.pedals);
  await page.screenshot({ path: 'captures/surface-feedback-inverted.png' });
  await page.locator('#surface-feedback').screenshot({ path: 'captures/surface-feedback-icon.png' });
  const iconPixels = () =>
    page.evaluate(() => {
      const ctx = document.querySelector('#surface-feedback').getContext('2d');
      return {
        left: Array.from(ctx.getImageData(140, 42, 36, 113).data),
        right: Array.from(ctx.getImageData(183, 42, 36, 113).data),
        leftPivot: Array.from(ctx.getImageData(156, 47, 4, 4).data),
        rightPivot: Array.from(ctx.getImageData(199, 47, 4, 4).data),
        leftRod: Array.from(ctx.getImageData(146, 56, 20, 20).data),
        rightRod: Array.from(ctx.getImageData(189, 56, 20, 20).data),
      };
    });
  await seek(5);
  const neutralIcon = await iconPixels();
  await page.locator('#surface-feedback').screenshot({ path: 'captures/surface-feedback-neutral.png' });
  await seek(5.5);
  await page.locator('#surface-feedback').screenshot({ path: 'captures/surface-feedback-half-press.png' });
  const leftOnly = await seek(6);
  const leftIcon = await iconPixels();
  await page.locator('#surface-feedback').screenshot({ path: 'captures/surface-feedback-left-only.png' });
  const rightOnly = await seek(0);
  const rightIcon = await iconPixels();
  await page.locator('#surface-feedback').screenshot({ path: 'captures/surface-feedback-right-only.png' });
  assert.equal(leftOnly.pedals.rightTravel, 0);
  assert.equal(rightOnly.pedals.leftTravel, 0);
  assert.deepEqual(leftIcon.right, neutralIcon.right, 'Left yaw must leave the right icon exactly neutral');
  assert.deepEqual(rightIcon.left, neutralIcon.left, 'Right yaw must leave the left icon exactly neutral');
  assert.notDeepEqual(leftIcon.left, neutralIcon.left);
  assert.notDeepEqual(rightIcon.right, neutralIcon.right);
  // The front projection keeps the rods vertical and the upper pivots fixed throughout a press.
  const rodX = (pixels) => {
    let weight = 0,
      weightedX = 0;
    for (let at = 0; at < pixels.length; at += 4) {
      const ink = Math.max(0, Math.max(...pixels.slice(at, at + 3)) - 40);
      weight += ink;
      weightedX += ((at / 4) % 20) * ink;
    }
    return weightedX / weight;
  };
  assert.deepEqual(leftIcon.leftPivot, neutralIcon.leftPivot);
  assert.deepEqual(rightIcon.rightPivot, neutralIcon.rightPivot);
  assert(Math.abs(rodX(leftIcon.leftRod) - rodX(neutralIcon.leftRod)) < 0.15, 'Left linkage must stay centered');
  assert(Math.abs(rodX(rightIcon.rightRod) - rodX(neutralIcon.rightRod)) < 0.15, 'Right linkage must stay centered');
  // Observe the rendered face contour, excluding the stem and labels. Recession must shrink both axes.
  const faceSize = (pixels, color) => {
    let minX = 36,
      maxX = -1,
      minY = 113,
      maxY = -1;
    for (let y = 35; y < 80; y++)
      for (let x = 0; x < 36; x++) {
        if (Math.abs(x - 18) < 4) continue;
        const at = (y * 36 + x) * 4;
        if (color.some((value, channel) => Math.abs(value - pixels[at + channel]) > 25)) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    assert(maxX > minX && maxY > minY, 'Pedal contour must be visible');
    return { width: maxX - minX + 1, height: maxY - minY + 1 };
  };
  for (const [restPixels, pressedPixels] of [
    [neutralIcon.left, leftIcon.left],
    [neutralIcon.right, rightIcon.right],
  ]) {
    const rest = faceSize(restPixels, [145, 164, 186]);
    const pushed = faceSize(pressedPixels, [79, 209, 197]);
    const widthScale = pushed.width / rest.width,
      heightScale = pushed.height / rest.height;
    assert(widthScale < 0.95 && heightScale < 0.95, 'A pushed pedal must recede in depth');
    assert(Math.abs(widthScale - heightScale) < 0.12, 'Keep a rigid face instead of squashing its height');
  }
  const missing = await seek(2);
  assert.equal(missing.controls.pitch.value, null);
  assert.equal(missing.controls.roll.value, null);
  assert.equal(missing.controls.yaw.value, null);
  assert.equal(missing.stick.available, false);
  assert.equal(missing.pedals.source, 'unknown');
  await page.locator('#surface-feedback').screenshot({ path: 'captures/surface-feedback-unknown.png' });
  assert.equal((await seek(2.5)).controls.yaw.value, null, 'Do not borrow the next readable node');
  const detached = await seek(3);
  assert.equal(detached.controls.yaw.value, null);
  assert(detached.controls.damaged);
  assert.equal((await seek(4)).throttle, null, 'Simultaneous W/S is ambiguous');
  assert.deepEqual((await seek(0)).controls, upright.controls);
  const views = [];
  for (let i = 0; i < 5; i++) {
    await page.locator('#follow').click();
    await page.waitForTimeout(150);
    const f = await probe();
    views.push([f.camera, f.visible]);
    assert.deepEqual(f.controls, upright.controls, 'Camera switching must not alter feedback');
    assert.equal(f.visible, f.camera.startsWith('chase-'));
    assert.equal(await page.locator('#surface-feedback').isVisible(), f.visible);
  }
  await page.locator('#freeView').click();
  await page.waitForFunction(() => __flight.cameraMode === 'free');
  assert.equal((await probe()).visible, false);
  assert.equal(await page.locator('#surface-feedback').isVisible(), false);
  await page.locator('#freeView').click();
  await page.waitForFunction(() => __flight.controlsVisible);
  await page.locator('#cockpitLook').click();
  await page.waitForFunction(() => __flight.cameraMode === 'cockpit-look');
  assert.equal((await probe()).visible, false);
  await page.locator('#cockpitLook').click();
  const chaseView = encodeURIComponent(JSON.stringify({ mode: 'chase-mid' }));
  await ready(url + `&videoExport=1&exportView=${chaseView}`);
  const compositor = await page.evaluate(() => __flightVideoExport.ready());
  assert.equal(compositor.compositor.backend, 'browser-gpu-compositor');
  const chase = await exported(1, 'export-chase');
  assert(chase.visible);
  let green = 0;
  for (
    let y = Math.ceil(chase.layout.controls.top);
    y < Math.floor(chase.layout.controls.top + chase.layout.controls.height);
    y++
  )
    for (
      let x = Math.ceil(chase.layout.controls.left);
      x < Math.floor(chase.layout.controls.left + chase.layout.controls.width);
      x++
    ) {
      const at = (y * 1920 + x) * 4,
        [r, g, b] = chase.png.data.subarray(at, at + 3);
      if (g > 140 && b > 130 && r < 110) green++;
    }
  assert(green > 150, 'Export must contain the same turquoise control graphics in RGBA order');
  const encoding = await page.evaluate(async () => {
    const api = __flightVideoExport,
      support = await api.beginEncode(25);
    if (!support.supported) return { supported: false, reason: support.reason };
    const batch = await api.encodeFrames(25, 2),
      tail = await api.endEncode();
    return { supported: true, frames: batch.frames, error: batch.error, bytes: batch.bytes + tail.bytes };
  });
  if (encoding.supported) {
    assert.equal(encoding.error, null);
    assert(encoding.bytes > 0);
  }
  const cockpitView = encodeURIComponent(JSON.stringify({ mode: 'cockpit' }));
  await ready(url + `&videoExport=1&exportView=${cockpitView}`);
  await page.evaluate(() => __flightVideoExport.ready());
  assert.equal((await exported(1, 'export-cockpit')).visible, false);
  assert.deepEqual(failures, []);
  const report = { measured, upright, inverted, missing, detached, views, compositor, green, encoding, failures };
  writeFileSync('captures/surface-feedback.json', JSON.stringify(report, null, 2));
  console.log('PASS', JSON.stringify({ views, green, encoding, failures }));
} finally {
  await browser.close();
}
