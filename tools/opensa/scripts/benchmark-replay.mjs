/** Interleave before/after on one GPU; measured submit-to-completion latency, not driver timestamps. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
const pages = [],
  errors = [],
  report = {};
try {
  for (const baseline of [true, false]) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 911 } });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (/validation error|device.*lost|invalid shader|error while parsing wgsl/i.test(m.text()))
        errors.push(m.text());
    });
    await page.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (fn) => (globalThis.__suspendReplayFrames ? 0 : raf(fn));
    });
    await page.route('**/assets/flightReplay-*.js', async (r) => {
      const response = await r.fetch();
      let body = baseline ? readFileSync('captures/perf-baseline.js', 'utf8') : await response.text();
      const hook = 'this.statsValue.residencyBytes=this.resources.totalBytes(),this.statsValue';
      assert(body.includes(hook));
      body = body.replace(
        hook,
        'this.statsValue.residencyBytes=this.resources.totalBytes(),globalThis.__profileEngine=this,this.statsValue',
      );
      await r.fulfill({ response, body });
    });
    await page.goto('http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&weather=10&hour=12');
    await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering' || globalThis.__flight?.error, null, {
      timeout: 90000,
    });
    assert.equal(await page.evaluate(() => globalThis.__flight.error), null);
    await page.locator('#scrub').evaluate((e) => {
      e.value = '18.468';
      e.dispatchEvent(new Event('input', { bubbles: true }));
    });
    for (let i = 0; i < 3; i++) await page.locator('#follow').click();
    await page.waitForTimeout(5000);
    await page.evaluate(() => {
      globalThis.__suspendReplayFrames = true;
    });
    await page.waitForTimeout(100);
    pages.push(page);
  }
  for (const [label, hour] of [
    ['day', 12],
    ['night', 0],
  ]) {
    report[label] = { before: [], after: [] };
    for (const page of pages)
      await page.locator('#hourSlider').evaluate((e, h) => {
        e.value = String(h);
        e.dispatchEvent(new Event('input', { bubbles: true }));
      }, hour);
    for (const index of [0, 1, 1, 0, 0, 1]) {
      const samples = await pages[index].evaluate(async () => {
        const engine = globalThis.__profileEngine,
          result = [];
        await engine.device.queue.onSubmittedWorkDone();
        for (let i = 0; i < 80; i++) {
          const start = performance.now();
          engine.frame(globalThis.__flight.cameraState);
          await engine.device.queue.onSubmittedWorkDone();
          if (i >= 20) result.push(performance.now() - start);
        }
        result.sort((a, b) => a - b);
        return { median: result[30], p95: result[57] };
      });
      report[label][index ? 'after' : 'before'].push(samples);
      console.log(label, index ? 'after' : 'before', samples);
    }
  }
  assert.deepEqual(errors, []);
  writeFileSync('captures/perf-paired.json', JSON.stringify({ report, errors }, null, 2));
} finally {
  await browser.close();
}
