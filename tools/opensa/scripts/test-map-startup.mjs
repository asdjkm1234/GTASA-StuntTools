/** Isolate real Arc startup with ordinary Chrome flags and a fresh test-owned profile. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const mode = process.argv[2] ?? 'current';
assert(['current', 'baseline', 'uploads-only'].includes(mode));
mkdirSync('captures', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 911 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (/validation error|device.*lost|invalid shader|error while parsing wgsl/i.test(m.text())) errors.push(m.text());
  });
  if (mode === 'baseline')
    await page.route('**/assets/flightReplay-*.js', (r) =>
      r.fulfill({
        body: readFileSync('captures/perf-baseline.js'),
        contentType: 'text/javascript',
      }),
    );
  const bundleIndex = process.argv.indexOf('--bundle');
  if (bundleIndex >= 0)
    await page.route('**/assets/flightReplay-*.js', (r) =>
      r.fulfill({
        body: readFileSync(process.argv[bundleIndex + 1]),
        contentType: 'text/javascript',
      }),
    );
  await page.goto(
    mode === 'uploads-only'
      ? 'http://127.0.0.1:4173/opensa/webgpu-check.html'
      : 'http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&weather=10&hour=12',
  );
  let state;
  if (mode === 'uploads-only') {
    state = await page.evaluate(async () => {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error('No native adapter');
      const device = await adapter.requestDevice({ requiredFeatures: ['texture-compression-bc'] });
      let lost = null,
        done = 0,
        writes = 0,
        bytes = 0;
      device.lost.then((info) => {
        lost = { reason: info.reason, message: info.message };
      });
      const formats = [
        'bc1-rgba-unorm-srgb',
        'bc3-rgba-unorm-srgb',
        'bc7-rgba-unorm-srgb',
        'rgba8unorm-srgb',
        'bc2-rgba-unorm-srgb',
      ];
      const index = await (await fetch('/map-pak/index.json')).json();
      const textures = [];
      for (const entry of index.arrays) {
        const data = new Uint8Array(await (await fetch(`/map-pak/textures/${entry.ref}.ostex`)).arrayBuffer());
        const v = new DataView(data.buffer);
        const format = data[8],
          width = v.getUint16(12, true),
          height = v.getUint16(14, true),
          layers = v.getUint16(16, true),
          mips = data[18];
        const texture = device.createTexture({
          label: `array-${entry.ref}`,
          format: formats[format],
          mipLevelCount: mips,
          size: [width, height, layers],
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        textures.push({ data, texture, format, width, height, layers, mips });
      }
      for (const t of textures) {
        let offset = 20 + t.layers * 8,
          batchBytes = 0;
        for (let layer = 0; layer < t.layers; layer++)
          for (let mip = 0; mip < t.mips; mip++) {
            const w = Math.max(1, t.width >> mip),
              h = Math.max(1, t.height >> mip);
            const mw = t.format === 3 ? w : Math.max(4, w),
              mh = t.format === 3 ? h : Math.max(4, h);
            const rawRow = t.format === 3 ? mw * 4 : Math.ceil(mw / 4) * (t.format === 0 ? 8 : 16);
            const bpr = Math.ceil(rawRow / 256) * 256,
              rows = t.format === 3 ? mh : Math.ceil(mh / 4),
              size = bpr * rows;
            device.queue.writeTexture(
              { texture: t.texture, mipLevel: mip, origin: [0, 0, layer] },
              t.data.subarray(offset, offset + size),
              { bytesPerRow: bpr, rowsPerImage: rows },
              [mw, mh, 1],
            );
            offset += size;
            writes++;
            bytes += size;
            batchBytes += size;
            if (batchBytes >= 1024 * 1024) {
              await device.queue.onSubmittedWorkDone();
              batchBytes = 0;
            }
            if (lost) return { done, writes, bytes, lost };
          }
        await device.queue.onSubmittedWorkDone();
        done++;
        if (lost) return { done, writes, bytes, lost };
      }
      device.destroy();
      return { done, total: index.arrays.length, writes, bytes, lost };
    });
  } else {
    await page
      .waitForFunction(
        () => __flight?.error || (__flight?.phase === 'rendering' && document.querySelector('#mapLoading').hidden),
        null,
        { timeout: 90000 },
      )
      .catch(() => {});
    await page.waitForTimeout(2000);
    if (mode === 'current') {
      assert.equal(await page.evaluate(() => __flight.error), null);
      await page.locator('#play').click();
      await page.waitForTimeout(5000);
      await page.locator('#play').click();
      for (let i = 0; i < 3; i++) await page.locator('#follow').click();
      await page.locator('#hourSlider').evaluate((e) => {
        e.value = '0';
        e.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForTimeout(2000);
      assert.equal(await page.evaluate(() => __flight.error), null);
    }
    state = await page.evaluate(() => ({ ...__flight, loading: !document.querySelector('#mapLoading').hidden }));
  }
  await page.screenshot({ path: `captures/map-startup-${mode}.png` });
  writeFileSync(`captures/map-startup-${mode}.json`, JSON.stringify({ state, errors }, null, 2));
  console.log(JSON.stringify({ mode, state, errors }));
  if (mode === 'uploads-only') {
    assert.equal(state.lost, null);
    assert.equal(state.done, state.total);
  } else {
    assert.equal(state.error, null);
    assert.equal(state.loading, false);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
