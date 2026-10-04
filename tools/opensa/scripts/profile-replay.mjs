/** Fresh Chrome: frame submission rate and queue completion; Arc GPU timestamps may be invalid. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const tag = process.argv[2] ?? 'replay-profile';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 911 } });
const errors = [];
await page.addInitScript(() => {
  const original = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => (globalThis.__suspendReplayFrames ? 0 : original(callback));
});
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (/validation error|device.*lost|invalid shader|error while parsing wgsl/i.test(m.text())) {
    errors.push(m.text());
    console.error(m.text());
  }
});
await page.route('**/assets/flightReplay-*.js', async (route) => {
  const response = await route.fetch();
  let body = await response.text();
  const hook = 'this.statsValue.residencyBytes=this.resources.totalBytes(),this.statsValue';
  assert(body.includes(hook));
  body = body.replace(
    hook,
    'this.statsValue.residencyBytes=this.resources.totalBytes(),globalThis.__profileStats=this.statsValue,globalThis.__profileEngine=this,this.statsValue',
  );
  if (process.argv.includes('--no-reflection'))
    body = body.replace('let reflection = canopyReflection(in, frontFacing);', 'let reflection = vec4f(0.0);');
  await route.fulfill({ response, body });
});
mkdirSync('captures', { recursive: true });
const result = [];
async function sample(label) {
  const measured = await page.evaluate(async () => {
    const rows = [],
      start = performance.now(),
      renders = globalThis.__flight.renders;
    while (performance.now() - start < 5000) {
      rows.push({ ...globalThis.__profileStats });
      await new Promise((r) => setTimeout(r, 100));
    }
    const median = (key) => rows.map((r) => r[key]).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
    return {
      fps: ((globalThis.__flight.renders - renders) * 1000) / (performance.now() - start),
      gpuPassMs: median('gpuPassMs'),
      gpuPostMs: median('gpuPostMs'),
      gpuProbeMs: median('gpuProbeMs'),
      submitMs: median('submitMs'),
      draws: median('drawsRecorded'),
      triangles: median('trianglesRecorded'),
      uploads: globalThis.__flight.instrumentUploads,
      camera: globalThis.__flight.cameraState,
      gpu: globalThis.__flight.gpu,
    };
  });
  result.push({ label, ...measured });
  console.log(label, JSON.stringify(measured));
  await page.screenshot({ path: `captures/${tag}-${label}.png` });
}
try {
  await page.goto('http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&weather=10&hour=12');
  await page.waitForFunction(
    () => (globalThis.__flight?.phase === 'rendering' && globalThis.__profileEngine) || globalThis.__flight?.error,
    null,
    {
      timeout: 90000,
    },
  );
  assert(!(await page.evaluate(() => globalThis.__flight.error)), await page.evaluate(() => globalThis.__flight.error));
  await page.locator('#scrub').evaluate((e) => {
    e.value = '18.468';
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(5000);
  await sample('chase-paused');
  await page.locator('#play').click();
  await sample('chase-playing');
  await page.locator('#play').click();
  await page.locator('#scrub').evaluate((e) => {
    e.value = '18.468';
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  for (let i = 0; i < 3; i++) await page.locator('#follow').click();
  await page.waitForTimeout(1500);
  await sample('cockpit-paused');
  await page.locator('#play').click();
  await sample('cockpit-playing');
  await page.locator('#play').click();
  await page.locator('#scrub').evaluate((e) => {
    e.value = '18.468';
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const serial = await page.evaluate(async () => {
    globalThis.__suspendReplayFrames = true;
    await new Promise((r) => setTimeout(r, 100));
    const engine = globalThis.__profileEngine;
    await engine.device.queue.onSubmittedWorkDone();
    const samples = [];
    for (let i = 0; i < 50; i++) {
      const start = performance.now();
      engine.frame(globalThis.__flight.cameraState);
      await engine.device.queue.onSubmittedWorkDone();
      if (i >= 10) samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    return { medianMs: samples[20], p95Ms: samples[38] };
  });
  console.log('cockpit-serial', serial);
  assert.deepEqual(errors, []);
  writeFileSync(`captures/${tag}.json`, JSON.stringify({ result, serial, errors }, null, 2));
} finally {
  await browser.close();
}
