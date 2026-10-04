/** Capture the stock Hydra stick A/B and verify the deleted panel also stays absent from exports. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const tag = process.argv[2] ?? 'cockpit-dashboard';
mkdirSync('captures', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const failures = [];
page.on('pageerror', (error) => failures.push(error.message));
page.on('console', (message) => {
  if (
    /validation error|device.*lost|invalid shader|Invalid CommandBuffer|usage .*doesn't include/i.test(message.text())
  )
    failures.push(message.text());
});
await page.route('**/local-recording/latest.csv', (route) =>
  route.fulfill({
    body: readFileSync('../../GTA San Andreas/flight_recordings/flight_20260930_012855_010_m520_002.csv'),
    contentType: 'text/csv',
  }),
);
let opaque = false;
await page.route('**/assets/flightReplay-*.js', async (route) => {
  const response = await route.fetch();
  let body = await response.text();
  const hook = 'let alpha = clamp(texel.a * in.color.a + amount, 0.0, 1.0);';
  assert(body.includes(hook));
  if (opaque)
    body = body.replace(
      hook,
      'let alpha = select(clamp(texel.a * in.color.a + amount, 0.0, 1.0), 1.0, in.matClass == 0u && in.color.a < 0.3);',
    );
  await route.fulfill({ response, body });
});
const report = {};
try {
  const comparisons = [];
  for (const [label, solid, yaw, pitch, hour] of [
    ['opaque', true, 0, -0.16, 12],
    ['transparent', false, 0, -0.16, 12],
    ['normal-eye', false, 0, 0, 12],
    ['side', false, 0.65, -0.1, 12],
    ['night', false, 0, -0.16, 0],
  ]) {
    opaque = solid;
    await page.goto(`http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&weather=10&hour=${hour}`);
    await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering', null, { timeout: 90000 });
    assert.equal(await page.locator('#analysis-hud, .analysis-hud').count(), 0);
    for (let i = 0; i < 3; i++) await page.locator('#follow').click();
    await page.locator('#cockpitLook').click();
    await page.mouse.move(500, 450);
    await page.mouse.down();
    await page.mouse.move(500 + yaw / 0.004, 450 - pitch / 0.004, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(2500);
    if (label === 'transparent') await page.screenshot({ path: `captures/${tag}-page.png` });
    await page.addStyleTag({ content: 'body > :not(#canvas):not(script) { display:none !important; }' });
    const pixels = PNG.sync.read(await page.locator('#canvas').screenshot({ path: `captures/${tag}-${label}.png` }));
    assert(pixels.data.some((v, i) => i % 4 !== 3 && v > 8));
    if (comparisons.length < 2) comparisons.push(pixels);
  }
  const [a, b] = comparisons;
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 4)
    if ([0, 1, 2].some((c) => Math.abs(a.data[i + c] - b.data[i + c]) > 4)) changed++;
  assert(changed > 100, 'Stick transparency must visibly reveal the panel');
  report.changedPixels = changed;
  opaque = false;
  await page.goto('http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&weather=10&hour=12&videoExport=1');
  await page.waitForFunction(() => globalThis.__flightVideoExport && globalThis.__flight?.phase === 'rendering', null, {
    timeout: 90000,
  });
  const exported = await page.evaluate(async () => {
    const api = globalThis.__flightVideoExport;
    const ready = await api.ready();
    const bytes = await api.renderFrame(0);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    return {
      ready,
      length: bytes.length,
      base64: btoa(binary),
      panelCount: document.querySelectorAll('#analysis-hud, .analysis-hud').length,
    };
  });
  assert.equal(exported.length, 1920 * 1080 * 4);
  assert.equal(exported.panelCount, 0);
  const png = new PNG({ width: 1920, height: 1080 });
  png.data = Buffer.from(exported.base64, 'base64');
  assert(png.data.some((v, i) => i % 4 !== 3 && v > 8));
  writeFileSync(`captures/${tag}-export.png`, PNG.sync.write(png));
  report.export = { length: exported.length, panelCount: exported.panelCount, compositor: exported.ready.compositor };
  assert.deepEqual(failures, []);
  writeFileSync(`captures/${tag}.json`, JSON.stringify(report, null, 2));
  console.log('PASS', JSON.stringify(report));
} finally {
  await browser.close();
}
