/** Fixed camera attitude/time, translating through the map: celestial sky must be pixel-stable. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

mkdirSync('captures', { recursive: true });
const errors = [];
const report = {};
const before = process.argv.includes('--before');
const tag = before ? 'before' : 'fixed';
const browser = await chromium.launch({ channel: 'chrome', headless: false });
try {
  const page = await browser.newPage({ viewport: { height: 1080, width: 1920 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (/validation error|device.*lost|invalid shader|Invalid CommandBuffer/i.test(m.text())) errors.push(m.text());
  });
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (fn) => (globalThis.__suspendReplayFrames ? 0 : raf(fn));
  });
  await page.route('**/local-recording/latest.csv', (r) =>
    r.fulfill({
      body: readFileSync('../../GTA San Andreas/flight_recordings/flight_20260930_220316_220_m520_002.csv'),
      contentType: 'text/csv',
    }),
  );
  await page.route('**/assets/flightReplay-*.js', async (r) => {
    const response = await r.fetch();
    let body = await response.text();
    const hook = 'this.statsValue.residencyBytes=this.resources.totalBytes(),this.statsValue';
    assert(body.includes(hook));
    body = body.replace(
      hook,
      'this.statsValue.residencyBytes=this.resources.totalBytes(),globalThis.__skyEngine=this,this.statsValue',
    );
    if (before) {
      const fixed = 'let far = frame.invSkyViewProj * vec4f(in.ndc, 0.0, 1.0);\n  let dir = normalize(far.xyz);';
      assert(body.includes(fixed));
      body = body.replace(
        fixed,
        'let far = frame.invViewProj * vec4f(in.ndc, 1.0, 1.0);\n  let dir = normalize(far.xyz / far.w - frame.camera.xyz);',
      );
    }
    await r.fulfill({ body, response });
  });
  await page.goto('http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&weather=10&hour=12');
  await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering' || globalThis.__flight?.error, null, {
    timeout: 90000,
  });
  assert.equal(await page.evaluate(() => globalThis.__flight.error), null);
  await page.locator('#mapLoading').waitFor({ state: 'hidden', timeout: 120000 });
  await page.locator('#scrub').evaluate((e) => {
    e.value = '18.468';
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `captures/sky-motion-${tag}-flight-day.png` });
  await page.evaluate(() => {
    globalThis.__suspendReplayFrames = true;
  });
  await page.waitForTimeout(100);
  for (const [label, hour] of [
    ['sun', 12],
    ['moon', 0],
    ['stars', 0],
  ]) {
    await page.locator('#hourSlider').evaluate((e, h) => {
      e.value = String(h);
      e.dispatchEvent(new Event('input', { bubbles: true }));
    }, hour);
    if (label === 'moon') await page.screenshot({ path: `captures/sky-motion-${tag}-flight-night.png` });
    const result = await page.evaluate(async (label) => {
      const engine = globalThis.__skyEngine;
      const device = engine.device;
      const format = engine.engineDevice.presentationFormat;
      const width = 1920,
        bytesPerRow = width * 4,
        height = 1080;
      const surface = device.createTexture({
        format,
        size: [width, height],
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        viewFormats: [engine.engineDevice.colorFormat],
      });
      const buffer = device.createBuffer({
        size: bytesPerRow * height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      engine.renderTarget = surface;
      engine.probeCenter = null;
      const source =
        label === 'sun'
          ? engine.environment.sunDir
          : label === 'moon'
            ? engine.environment.moonDir
            : [0.25, 0.75, -0.5];
      // Binary-exact offsets keep camera attitude identical even after translating the eye.
      const direction = source.map((v) => Math.round(v * 1024) / 1024);
      const up = Math.abs(direction[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
      const camera = {
        ...globalThis.__flight.cameraState,
        aspect: width / height,
        far: 3000,
        fovYRad: Math.PI / 4,
        near: 0.03,
        up,
      };
      const poses = [
        [0, 1200, 0],
        [2900, 1200, -2700],
        [2900.125, 1200.25, -2700.5],
        [2900.25, 1200.5, -2701],
        [0, 1200, 0],
      ];
      const diffs = [];
      let first;
      for (const eye of poses) {
        camera.eye = eye;
        camera.target = eye.map((v, i) => v + direction[i]);
        engine.frame(camera);
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer({ texture: surface }, { buffer, bytesPerRow }, [width, height]);
        device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);
        const pixels = new Uint8Array(buffer.getMappedRange()).slice();
        buffer.unmap();
        if (format.startsWith('bgra')) {
          for (let i = 0; i < pixels.length; i += 4) [pixels[i], pixels[i + 2]] = [pixels[i + 2], pixels[i]];
        }
        if (!first) first = pixels;
        let changed = 0,
          max = 0,
          sum = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          let d = 0;
          for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(first[i + c] - pixels[i + c]));
          max = Math.max(max, d);
          sum += d;
          if (d) changed++;
        }
        diffs.push({ changed, eye, max, mean: sum / (width * height) });
      }
      engine.renderTarget = null;
      engine.frame(camera);
      await device.queue.onSubmittedWorkDone();
      buffer.destroy();
      surface.destroy();
      return { diffs, direction, pixels: Array.from(first) };
    }, label);
    const image = new PNG({ height: 1080, width: 1920 });
    image.data.set(result.pixels);
    writeFileSync(`captures/sky-motion-${tag}-${label}.png`, PNG.sync.write(image));
    delete result.pixels;
    report[label] = result;
    console.log(label, JSON.stringify(result));
    if (!before) for (const d of result.diffs) assert.equal(d.max, 0, `${label}: moving eye must not move the sky`);
    else
      assert(
        result.diffs.some((d) => d.max > 10),
        `${label}: old sky must reproduce the reported jitter`,
      );
  }
  assert.equal(await page.evaluate(() => globalThis.__flight.error), null);
  assert.deepEqual(errors, []);
  writeFileSync(`captures/sky-motion-${tag}.json`, JSON.stringify({ errors, report }, null, 2));
  console.log(
    before
      ? 'PASS: old sky jitter reproduced'
      : 'PASS: sun/moon/stars unchanged during translation, normal Chrome and GPU readback',
  );
} finally {
  await browser.close();
}
