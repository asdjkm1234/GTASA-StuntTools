/** Verify paused invalidation and compare optimized output to the saved pre-optimization bundle. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

mkdirSync('captures', { recursive: true });
const errors = [],
  report = {};
const files = {
  hydra: '../../GTA San Andreas/flight_recordings/flight_20260930_220316_220_m520_002.csv',
  rustler: '../../GTA San Andreas/flight_recordings/flight_20260930_013657_919_m476_003.csv',
};
async function capture(name, baseline) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 911 } });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (/validation error|device.*lost|invalid shader|error while parsing wgsl/i.test(m.text()))
        errors.push(m.text());
    });
    await page.route('**/local-recording/latest.csv', (r) =>
      r.fulfill({ body: readFileSync(files[name]), contentType: 'text/csv' }),
    );
    if (baseline)
      await page.route('**/assets/flightReplay-*.js', (r) =>
        r.fulfill({ body: readFileSync('captures/perf-baseline.js'), contentType: 'text/javascript' }),
      );
    await page.goto('http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&weather=10&hour=12');
    await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering' || globalThis.__flight?.error, null, {
      timeout: 90000,
    });
    assert.equal(await page.evaluate(() => globalThis.__flight.error), null);
    await page.locator('#scrub').evaluate(
      (e, s) => {
        e.value = String(s);
        e.dispatchEvent(new Event('input', { bubbles: true }));
      },
      name === 'hydra' ? 18.468 : 1,
    );
    await page.waitForTimeout(5000);
    await page.addStyleTag({ content: 'body > :not(#canvas):not(script) { visibility:hidden !important; }' });
    const shots = {};
    async function shot(label) {
      await page.waitForTimeout(700);
      shots[label] = PNG.sync.read(
        await page
          .locator('#canvas')
          .screenshot({ path: `captures/perf-visual-${name}-${baseline ? 'before' : 'after'}-${label}.png` }),
      );
      const renders = await page.evaluate(() => globalThis.__flight.renders);
      await page.waitForTimeout(600);
      const after = await page.evaluate(() => globalThis.__flight.renders);
      if (!baseline) assert.equal(after, renders, `${name}/${label}: stationary pause must submit no duplicate frames`);
    }
    await shot('chase');
    // Hidden controls still respond to DOM-driven test clicks; restore visibility while interacting.
    const click = (selector) => page.locator(selector).evaluate((e) => e.click());
    for (let i = 0; i < 3; i++) await click('#follow');
    await shot('cockpit');
    await click('#cockpitLook');
    await page.mouse.move(500, 450);
    await page.mouse.down();
    await page.mouse.move(600, 470, { steps: 10 });
    await page.mouse.up();
    await shot('look');
    await page.locator('#hourSlider').evaluate((e) => {
      e.value = '0';
      e.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await shot('night');
    if (!baseline) {
      const before = await page.evaluate(() => globalThis.__flight.renders);
      await click('#play');
      await page.waitForTimeout(600);
      await click('#play');
      assert((await page.evaluate(() => globalThis.__flight.renders)) > before + 2, 'Playback keeps rendering');
      await page.setViewportSize({ width: 1600, height: 900 });
      await page.waitForTimeout(400);
      assert((await page.locator('#canvas').evaluate((e) => e.width)) === 1600, 'Resize updates the retained frame');
      await page.locator('#scrub').evaluate((e) => {
        e.value = '0.5';
        e.dispatchEvent(new Event('input', { bubbles: true }));
      });
      assert.equal(
        await page.evaluate(() => globalThis.__flight.instrumentState.s),
        0.5,
        'Paused seek updates immediately',
      );
    }
    return shots;
  } finally {
    await browser.close();
  }
}
function compare(a, b) {
  let max = 0,
    changed = 0,
    total = 0;
  for (let at = 0; at < a.data.length; at += 4) {
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(a.data[at + c] - b.data[at + c]));
    max = Math.max(max, d);
    total += d;
    if (d > 0) changed++;
  }
  return { max, changed, mean: total / (a.width * a.height), fraction: changed / (a.width * a.height) };
}
for (const name of ['hydra', 'rustler']) {
  const before = await capture(name, true),
    after = await capture(name, false);
  report[name] = {};
  for (const label of Object.keys(before)) {
    const delta = compare(before[label], after[label]);
    report[name][label] = delta;
    console.log(name, label, delta);
    assert(delta.max <= 1 && delta.fraction < 0.01, 'Optimization must preserve the normal image within byte rounding');
  }
}
assert.deepEqual(errors, []);
writeFileSync('captures/perf-visual.json', JSON.stringify({ report, errors }, null, 2));
console.log('PASS: both aircraft day/night images, stationary pause, look, weather, resume, resize and seek');
