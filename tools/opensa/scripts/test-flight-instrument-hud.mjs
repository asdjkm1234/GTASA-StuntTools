/** Published screen gauges, wrapped transport clearance, camera modes, RAW and actual H.264 export. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

mkdirSync('captures', { recursive: true });
const csv = readFileSync('../../GTA San Andreas/flight_recordings/flight_20260930_220316_220_m520_002.csv', 'utf8');
let browser;
let page;
const failures = [];
async function freshPage(width, height) {
  if (browser) await browser.close();
  const headed = process.argv.includes('--headed');
  browser = await chromium.launch({
    channel: 'chrome',
    headless: !headed,
    args: headed ? [] : ['--enable-unsafe-webgpu'],
  });
  page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (e) => failures.push(e.message));
  page.on('console', (m) => {
    if (/validation error|device.*lost|invalid shader|Invalid CommandBuffer/i.test(m.text())) failures.push(m.text());
  });
  await page.route('**/local-recording/latest.csv', (r) => r.fulfill({ contentType: 'text/csv', body: csv }));
  const bundleIndex = process.argv.indexOf('--bundle');
  if (bundleIndex >= 0)
    await page.route('**/assets/flightReplay-*.js', (r) =>
      r.fulfill({
        body: readFileSync(process.argv[bundleIndex + 1]),
        contentType: 'text/javascript',
      }),
    );
}
await freshPage(1920, 1080);
const url = 'http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&weather=10&hour=12';
async function ready(target = url) {
  await page.goto(target);
  await page.waitForFunction(() => __flight?.phase === 'rendering', null, { timeout: 90000 });
  if (!target.includes('videoExport=1')) await page.locator('#resetView').click();
  await page.waitForFunction(() => __flight.hudLayout, null, { timeout: 90000 });
  await page.locator('#mapLoading').waitFor({ state: 'hidden', timeout: 120000 });
}
async function seek(s) {
  await page.locator('#scrub').evaluate((e, s) => {
    e.value = String(s);
    e.dispatchEvent(new Event('input', { bubbles: true }));
  }, s);
  await page.waitForFunction((s) => Math.abs(__flight.instrumentState.s - s) < 0.002, s);
  await page.waitForTimeout(100);
  return page.evaluate(() => __flight.instrumentState);
}
async function layoutProbe() {
  return page.evaluate(() => {
    const rect = (id) => {
      const r = document.getElementById(id).getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height, bottom: r.bottom, right: r.right };
    };
    const instruments = rect('flight-instruments'),
      controls = rect('surface-feedback'),
      transport = rect('transport');
    const sidebar = rect('left');
    return {
      sidebar,
      instruments,
      controls,
      transport,
      layout: __flight.hudLayout,
      state: __flight.instrumentState,
      width: innerWidth,
      height: innerHeight,
    };
  });
}
function checkLayout(p) {
  for (const rect of [p.instruments, p.controls]) {
    assert(rect.left >= 15 && rect.right <= p.width - 15, JSON.stringify(p));
    assert(rect.top >= 15 && rect.bottom <= p.transport.top - 11);
  }
  assert(p.instruments.right < p.controls.left);
  assert(p.sidebar.bottom < p.instruments.top, 'Import sidebar must leave the instrument row clear on wrapped layouts');
}
try {
  await ready();
  const state = await seek(11.862);
  const layouts = [];
  for (const [width, height] of [
    [1920, 1080],
    [1600, 900],
    [1280, 800],
    [800, 700],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(200);
    const layout = await layoutProbe();
    layouts.push(layout);
    checkLayout(layout);
    assert.deepEqual(layout.state, state, 'Viewport resizing must not change instrument readings');
    await page.screenshot({ path: `captures/flight-instruments-${width}x${height}.png` });
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.locator('#flight-instruments').screenshot({ path: 'captures/flight-instruments-panel.png' });
  const instrumentPixels = await page
    .locator('#flight-instruments')
    .evaluate((c) => Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data));
  const repeatState = await seek(8.003);
  assert.notDeepEqual(repeatState, state);
  assert.deepEqual(await seek(11.862), state);
  const repeatPixels = await page
    .locator('#flight-instruments')
    .evaluate((c) => Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data));
  assert.deepEqual(repeatPixels, instrumentPixels, 'Seeking must reproduce instrument pixels');
  for (let i = 0; i < 5; i++) {
    await page.locator('#follow').click();
    await page.waitForTimeout(100);
    const f = await page.evaluate(() => ({
      mode: __flight.cameraMode,
      state: __flight.instrumentState,
      visible: __flight.controlsVisible,
    }));
    assert.equal(await page.locator('#flight-instruments').isVisible(), f.mode.startsWith('chase-'));
    assert.deepEqual(f.state, state, 'Cockpit and chase gauges must share readings');
  }
  await page.locator('#freeView').click();
  await page.waitForFunction(() => __flight.cameraMode === 'free');
  assert.equal(await page.locator('#flight-instruments').isVisible(), false);
  await page.locator('#freeView').click();
  const view = encodeURIComponent(JSON.stringify({ mode: 'chase-mid' }));
  // Deliberately different browser/output dimensions: export must use 1920x1080, without the transport gap.
  // Release the first GPU process before the second full texture-array upload on Intel Arc.
  await freshPage(1280, 800);
  await ready(url + `&videoExport=1&exportView=${view}`);
  await page.evaluate(() => __flightVideoExport.ready());
  const exported = await page.evaluate(async () => {
    const bytes = await __flightVideoExport.renderFrame(11.862);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return { base64: btoa(binary), layout: __flight.hudExportLayout, state: __flight.instrumentState };
  });
  assert.deepEqual(exported.state, state);
  const l = exported.layout;
  assert(Math.abs(l.top + l.height - 1064) < 0.01, 'Export row must be 16 px from video bottom');
  const png = new PNG({ width: 1920, height: 1080 });
  png.data = Buffer.from(exported.base64, 'base64');
  writeFileSync('captures/flight-instruments-export.png', PNG.sync.write(png));
  let green = 0;
  for (let y = Math.ceil(l.instruments.top); y < Math.floor(l.instruments.top + l.instruments.height); y++)
    for (let x = Math.ceil(l.instruments.left); x < Math.floor(l.instruments.left + l.instruments.width); x++) {
      const at = (y * 1920 + x) * 4,
        [r, g, b] = png.data.subarray(at, at + 3);
      if (g > 130 && g > r * 1.2 && g > b * 1.05) green++;
    }
  assert(green > 500, 'Export must contain actual green gauge graphics in the instrument rectangle');
  const encoding = await page.evaluate(async () => {
    const api = __flightVideoExport,
      support = await api.beginEncode(25);
    if (!support.supported) return { supported: false, reason: support.reason };
    const batch = await api.encodeFrames(297, 2),
      tail = await api.endEncode();
    return { supported: true, error: batch.error, frames: batch.frames, bytes: batch.bytes + tail.bytes };
  });
  if (encoding.supported) {
    assert.equal(encoding.error, null);
    assert(encoding.bytes > 0);
  }
  assert.deepEqual(failures, []);
  writeFileSync(
    'captures/flight-instruments.json',
    JSON.stringify({ layouts, exportLayout: l, green, encoding, failures }, null, 2),
  );
  console.log(
    'PASS',
    JSON.stringify({
      layouts: layouts.map((p) => ({
        size: [p.width, p.height],
        top: p.layout.top,
        height: p.layout.height,
        transport: p.transport.top,
      })),
      exportLayout: l,
      green,
      encoding,
      failures,
    }),
  );
} finally {
  await browser.close();
}
