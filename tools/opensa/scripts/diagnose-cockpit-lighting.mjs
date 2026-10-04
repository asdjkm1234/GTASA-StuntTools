import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';

const tag = process.argv[2] ?? 'cockpit-lighting';
const recording = process.argv[3];
const seconds = Number(process.argv[4] ?? 18.468);
mkdirSync('captures', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 911 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (/validation error|device.*lost|invalid shader|error while parsing wgsl/i.test(m.text())) errors.push(m.text());
});
if (recording)
  await page.route('**/local-recording/latest.csv', (r) =>
    r.fulfill({ body: readFileSync(recording), contentType: 'text/csv' }),
  );
let mode = 'normal';
await page.route('**/assets/flightReplay-*.js', async (route) => {
  const response = await route.fetch();
  let body = await response.text();
  assert(body.includes('let amount = neoReflAmount(dot(shadingNormal, toEye), coefficient) * (isPaint + isChrome);'));
  assert(
    body.includes('let specular = rigidSpecular(in, shadingNormal, in.reflect.z * frame.params4.z) + in.poolSpec;'),
  );
  assert(body.includes('let reflection = canopyReflection(in, frontFacing);'));
  if (mode === 'no-env')
    body = body.replace(
      'let amount = neoReflAmount(dot(shadingNormal, toEye), coefficient) * (isPaint + isChrome);',
      'let amount = 0.0;',
    );
  if (mode === 'no-spec')
    body = body.replace(
      'let specular = rigidSpecular(in, shadingNormal, in.reflect.z * frame.params4.z) + in.poolSpec;',
      'let specular = vec3f(0.0);',
    );
  if (mode === 'no-canopy')
    body = body.replace('let reflection = canopyReflection(in, frontFacing);', 'let reflection = vec4f(0.0);');
  await route.fulfill({ response, body });
});
try {
  const shots = {};
  for (mode of process.argv.includes('--single') ? ['normal'] : ['normal', 'no-env', 'no-spec', 'no-canopy']) {
    await page.goto('http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&weather=10&hour=12');
    await page.waitForFunction(
      () => globalThis.__flight?.phase === 'rendering' && globalThis.__flight?.aircraft,
      null,
      { timeout: 90000 },
    );
    await page.locator('#scrub').evaluate((e, s) => {
      e.value = String(s);
      e.dispatchEvent(new Event('input', { bubbles: true }));
    }, seconds);
    for (let i = 0; i < 3; i++) await page.locator('#follow').click();
    await page.locator('#cockpitLook').click();
    await page.waitForTimeout(2500);
    shots[mode] = PNG.sync.read(await page.screenshot({ path: `captures/${tag}-${mode}.png` }));
    console.log(
      mode,
      await page.evaluate(() => ({
        aircraft: globalThis.__flight.aircraft,
        s: globalThis.__flight.instrumentState?.s,
        camera: globalThis.__flight.cameraState,
      })),
    );
    if (mode === 'normal') {
      await page.mouse.move(500, 450);
      await page.mouse.down();
      await page.mouse.move(500, 510, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `captures/${tag}-look-down.png` });
    }
  }
  if (!recording && shots['no-env']) {
    let maximum = 0;
    for (let y = 740; y < 780; y++)
      for (let x = 490; x < 650; x++) {
        const at = (y * shots.normal.width + x) * 4;
        for (let c = 0; c < 3; c++)
          maximum = Math.max(maximum, Math.abs(shots.normal.data[at + c] - shots['no-env'].data[at + c]));
      }
    console.log('Hydra left lining environment contribution, max /255:', maximum);
    writeFileSync(`captures/${tag}-comparison.json`, JSON.stringify({ liningEnvironmentMax: maximum, errors }));
    if (process.argv.includes('--verify')) assert(maximum <= 1, 'Cockpit lining must not reflect the sky');
  }
  writeFileSync(`captures/${tag}-errors.json`, JSON.stringify(errors));
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await browser.close();
}
