/** Ordinary headed Chrome: directional FX artwork follows projected velocity, including axial views. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

mkdirSync('captures', { recursive: true });
const before = process.argv.includes('--before');
const tag = before ? 'before' : 'fixed';
const errors = [];
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
      'this.statsValue.residencyBytes=this.resources.totalBytes(),globalThis.__jetEngine=this,this.statsValue',
    );
    if (before) {
      const guard = 'if (system.force.w < 0.0) {';
      assert(body.includes(guard));
      body = body.replace(guard, 'if (false) {');
    }
    await r.fulfill({ body, response });
  });
  const eye = [890.413, 27.408, -2368.146],
    target = [883.413, 21.408, -2394.146];
  const view = {
    mode: 'free',
    pitch: Math.atan2(target[1] - eye[1], Math.hypot(target[0] - eye[0], target[2] - eye[2])),
    position: eye,
    yaw: Math.atan2(target[0] - eye[0], -(target[2] - eye[2])),
  };
  const query = new URLSearchParams({
    exportView: JSON.stringify(view),
    hour: '0',
    local: 'latest',
    videoExport: '1',
    weather: '10',
  });
  await page.goto('http://127.0.0.1:4173/opensa/flight-replay.html?' + query);
  await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering' || globalThis.__flight?.error, null, {
    timeout: 90000,
  });
  assert.equal(await page.evaluate(() => globalThis.__flight.error), null);
  await page.evaluate(() => globalThis.__flightVideoExport.ready());
  await page.evaluate(() => globalThis.__flightVideoExport.renderFrame(14.916));
  await page.locator('#mapLoading').waitFor({ state: 'hidden', timeout: 120000 });
  const raw = await page.evaluate(async () => Array.from(await globalThis.__flightVideoExport.renderFrame(14.916)));
  const flight = new PNG({ height: 1080, width: 1920 });
  flight.data.set(raw);
  writeFileSync(`captures/jet-direction-${tag}-flight.png`, PNG.sync.write(flight));
  await page.screenshot({ path: `captures/jet-direction-${tag}-headed.png` });
  await page.evaluate(() => {
    globalThis.__suspendReplayFrames = true;
  });
  await page.waitForTimeout(100);
  const result = await page.evaluate(async () => {
    const engine = globalThis.__jetEngine,
      device = engine.device,
      lane = engine.dynamicParticles;
    const width = 512,
      bytesPerRow = width * 4,
      format = engine.engineDevice.presentationFormat,
      height = 512;
    const surface = device.createTexture({
      format,
      size: [width, height],
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      viewFormats: [engine.engineDevice.colorFormat],
    });
    const buffer = device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    engine.renderTarget = surface;
    engine.probeCenter = null;
    engine.particleClock = 100;
    // A diagnostic marker puts most opacity near V=0. Its measured screen centroid identifies the tip,
    // independent of the owner's original flame artwork or camera/background brightness.
    const tex = lane.texture,
      pixels = new Uint8Array(tex.width * tex.height * 4);
    for (let y = 0; y < tex.height; y++)
      for (let x = 0; x < tex.width; x++) {
        const u = (x + 0.5) / tex.width,
          v = (y + 0.5) / tex.height;
        if (Math.hypot(u - 0.5, v - 0.18) < 0.085 || (Math.abs(u - 0.5) < 0.012 && v > 0.18 && v < 0.8))
          pixels.set([255, 255, 255, 255], (y * tex.width + x) * 4);
      }
    device.queue.writeTexture({ origin: [0, 0, 0], texture: tex }, pixels, { bytesPerRow: tex.width * 4 }, [
      tex.width,
      tex.height,
    ]);
    const record = new Float32Array([0, 0, 0, -1, 6, 6, 6, 300, 0, 0.7, 1, 1, 0, 0.7, 1, 1, 0, 0.7, 1, 1]);
    device.queue.writeBuffer(lane.systems, 0, record);
    const camera = {
      ...globalThis.__flight.cameraState,
      aspect: 1,
      eye: [0, 1200, 20],
      far: 3000,
      fovYRad: Math.PI / 4,
      near: 0.03,
      target: [0, 1200, 0],
      up: [0, 1, 0],
    };
    const read = async () => {
      engine.frame(camera);
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer({ texture: surface }, { buffer, bytesPerRow }, [width, height]);
      device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const data = new Uint8Array(buffer.getMappedRange()).slice();
      buffer.unmap();
      if (format.startsWith('bgra'))
        for (let i = 0; i < data.length; i += 4) [data[i], data[i + 2]] = [data[i + 2], data[i]];
      return data;
    };
    const images = {},
      rows = [];
    for (const [label, velocity, rolled] of [
      ['right', [1, 0, 0]],
      ['left', [-1, 0, 0]],
      ['up', [0, 1, 0]],
      ['down', [0, -1, 0]],
      ['rolled-right', [1, 0, 0], true],
      ['axial', [0, 0, 1]],
      ['zero', [0, 0, 0]],
    ]) {
      camera.up = rolled ? [1, 0, 0] : [0, 1, 0];
      engine.clearParticles();
      const off = await read();
      engine.spawnParticleAt(100, 0, 0, 1200, 0, ...velocity, 1, 1);
      const on = await read();
      let count = 0,
        weight = 0,
        xsum = 0,
        ysum = 0;
      for (let y = 180; y < 332; y++)
        for (let x = 180; x < 332; x++) {
          const i = (y * width + x) * 4,
            gain = Math.max(0, on[i + 2] - off[i + 2]);
          if (gain > 3) {
            weight += gain;
            xsum += (x - 255.5) * gain;
            ysum += (255.5 - y) * gain;
            count++;
          }
        }
      rows.push({ count, label, x: xsum / weight, y: ysum / weight });
      images[label] = Array.from(on);
    }
    engine.renderTarget = null;
    buffer.destroy();
    surface.destroy();
    return { images, rows };
  });
  for (const [label, pixels] of Object.entries(result.images)) {
    const png = new PNG({ height: 512, width: 512 });
    png.data.set(pixels);
    writeFileSync(`captures/jet-direction-${tag}-${label}.png`, PNG.sync.write(png));
  }
  console.log(result.rows);
  for (const row of result.rows)
    assert(row.count > 40 && Number.isFinite(row.x + row.y), `${row.label}: finite visible billboard`);
  if (before) {
    const [right, left] = result.rows;
    assert(
      Math.abs(right.x - left.x) < 0.1 && Math.abs(right.y - left.y) < 0.1,
      'reproduce artwork ignoring opposite jets',
    );
  } else {
    const [right, left, up, down, rolled] = result.rows;
    assert(right.x > 20 && Math.abs(right.y) < 2, 'tip follows right exhaust');
    assert(left.x < -20 && Math.abs(left.y) < 2, 'tip follows left exhaust');
    assert(up.y > 20 && Math.abs(up.x) < 2, 'tip follows up exhaust');
    assert(down.y < -20 && Math.abs(down.x) < 2, 'tip follows down exhaust');
    assert(rolled.y > 20 && Math.abs(rolled.x) < 2, 'tip follows exhaust with a rolled camera');
  }
  assert.deepEqual(errors, []);
  writeFileSync(`captures/jet-direction-${tag}.json`, JSON.stringify({ errors, rows: result.rows }, null, 2));
  console.log(
    before
      ? 'PASS: original sprite direction bug reproduced'
      : 'PASS: exhaust artwork direction and axial fallback, ordinary headed Chrome',
  );
} finally {
  await browser.close();
}
