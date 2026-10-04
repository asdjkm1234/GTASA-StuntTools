/** Backlit normal-output A/B check. For sunlit visibility use test-canopy-lighting.mjs. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const tag = process.argv[2] ?? 'canopy-visibility';
const recording = process.argv[3] ?? '../../GTA San Andreas/flight_recordings/flight_20260928_002942_500_m520_002.csv';
const seconds = Number(process.argv[4] ?? 27.165);
const out = join(process.cwd(), 'captures');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 945 } });
let mode = 'on';
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (/validation error|invalid shader|device.*lost|error while parsing wgsl/i.test(message.text())) {
    errors.push(message.text());
    console.error(message.text());
  }
});
await page.route('**/local-recording/latest.csv', (route) =>
  route.fulfill({ body: readFileSync(recording), contentType: 'text/csv' }),
);
await page.route('**/assets/flightReplay-*.js', async (route) => {
  const response = await route.fetch();
  let body = await response.text();
  const hook = 'let canopyAlpha = tintAlpha;';
  assert(body.includes(hook));
  if (mode === 'off') body = body.replace(hook, 'wear = vec3f(0.0); ' + hook);
  await route.fulfill({ response, body });
});

function compare(a, b) {
  const differences = [];
  // Include the lower side glass as well; a top-only region misses its sparse wear entirely.
  // The panel and scene are identical, and both versions have the same smoke tint.
  for (let y = 40; y < 900; y++)
    for (let x = 50; x < 1870; x++) {
      const at = (y * a.width + x) * 4;
      differences.push(Math.max(...[0, 1, 2].map((c) => Math.abs(a.data[at + c] - b.data[at + c]))));
    }
  differences.sort((a, b) => a - b);
  return {
    mean: differences.reduce((a, b) => a + b, 0) / differences.length,
    p95: differences[Math.floor(differences.length * 0.95)],
    p99: differences[Math.floor(differences.length * 0.99)],
    max: differences.at(-1),
    pixelsOver4: differences.filter((d) => d > 4).length,
  };
}

try {
  const shots = {};
  for (mode of ['on', 'off']) {
    await page.goto('http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&weather=10&hour=12');
    await page.waitForFunction(
      () => globalThis.__flight?.phase === 'rendering' && globalThis.__flight?.aircraft?.includes('hydra'),
      null,
      { timeout: 90000 },
    );
    await page.locator('#scrub').evaluate((slider, time) => {
      slider.value = String(time);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }, seconds);
    for (let i = 0; i < 3; i++) await page.locator('#follow').click();
    await page.locator('#cockpitLook').click();
    await page.waitForTimeout(3500);
    await page.addStyleTag({ content: 'body > :not(#canvas):not(script) {display:none !important;}' });
    shots[mode] = PNG.sync.read(await page.locator('#canvas').screenshot({ path: join(out, `${tag}-${mode}.png`) }));
    console.log('captured', mode);
  }
  assert.deepEqual(errors, []);
  const report = {
    wear: compare(shots.on, shots.off),
  };
  writeFileSync(join(out, `${tag}.json`), JSON.stringify(report, null, 2));
  console.log('Normal-output differences (0-255)', report);
  assert(report.wear.max <= 8, 'Backlit scratches remain conspicuously bright without direct light');
  assert(report.wear.pixelsOver4 < 1000, 'Backlit wear covers too much of the forward view');
} finally {
  await browser.close();
}
