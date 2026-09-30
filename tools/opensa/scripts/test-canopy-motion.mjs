/** GPU regression: surface marks travel with the aircraft, while turning changes their projection.
 * A test-only response rewrite isolates the actual surface marks from the moving scenery.
 * No production file, recording or texture is modified. Requires a locally baked Hydra recording.
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { chromium } from 'playwright';

const recording = process.argv[2];
const reflectionMode = process.argv[3] === 'reflection';
const prefix = reflectionMode ? 'canopy-reflection-motion' : 'canopy-motion';
assert(recording, 'Pass a Hydra CSV');
const csv = readFileSync(recording, 'utf8');
let shift = 0;
const outDir = join(process.cwd(), 'captures');
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const failures = [];
page.on('pageerror', (error) => failures.push(error.message));
page.on('console', (message) => {
  if (
    /validation error|device.*lost|invalid shader|error while parsing wgsl|Invalid CommandBuffer|usage .*doesn't include/i.test(
      message.text(),
    )
  )
    failures.push(message.text());
});
await page.route('**/local-recording/latest.csv', (route) => {
  const translated = csv
    .split(/\r?\n/)
    .map((line) => {
      if (!/^\d{4}-/.test(line)) return line;
      const fields = line.split(',');
      // v9: timestamp, model, health, x, y, z. Shift only world position, leaving orientation unchanged.
      fields[3] = String(Number(fields[3]) + shift);
      fields[4] = String(Number(fields[4]) + shift);
      return fields.join(',');
    })
    .join('\n');
  return route.fulfill({ body: translated, contentType: 'text/csv' });
});
await page.route('**/assets/flightReplay-*.js', async (route) => {
  const response = await route.fetch();
  const source = await response.text();
  const output = 'return vec4f(mix(combinedColor, fogColorFor(viewDir, fog) * combinedAlpha, fog), combinedAlpha);';
  assert(source.includes(output), 'Canopy diagnostic hook no longer matches');
  // Only change the final output. Surface evaluation, local transforms and face gating remain production.
  await route.fulfill({
    response,
    // Blue tags the glass; red carries the isolated marks. This excludes cockpit rails/panel after a turn.
    body: source.replace(
      output,
      reflectionMode
        ? 'return vec4f(reflection.a * 4.0 + dot(reflection.rgb, vec3f(0.333333)) * reflection.a * 20.0, 0.0, 1.0, 1.0);'
        : 'return vec4f(dot(wear, vec3f(0.333333)) * 30.0, 0.0, 1.0, 1.0);',
    ),
  });
});
async function capture(label) {
  const path = join(outDir, `${prefix}-${label}.png`);
  const bytes = await page.locator('#canvas').screenshot({ path });
  return PNG.sync.read(bytes);
}
function difference(a, b) {
  let total = 0;
  let count = 0;
  const signal = (data, at) => (data[at + 1] < 4 && data[at + 2] > 150 ? data[at] : 0);
  for (let at = 0; at < a.data.length; at += 4) {
    const delta = Math.abs(signal(a.data, at) - signal(b.data, at));
    total += delta;
    if (delta > 4) count++;
  }
  return { mean: total / (a.width * a.height), changed: count };
}
try {
  const shots = [];
  for (const [label, offset] of [
    ['base', 0],
    ['translated', 12.5],
    ['returned', 0],
  ]) {
    shift = offset;
    await page.goto('http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&weather=10&hour=12');
    await page.waitForFunction(
      () => globalThis.__flight?.phase === 'rendering' && globalThis.__flight?.aircraft?.includes('hydra'),
      null,
      { timeout: 90000 },
    );
    await page.locator('#scrub').evaluate((slider) => {
      slider.value = '0';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    for (let i = 0; i < 3; i++) await page.locator('#follow').click();
    await page.waitForFunction(() => globalThis.__flight?.cameraMode === 'cockpit');
    await page.locator('#cockpitLook').click();
    await page.waitForTimeout(2000);
    await page.addStyleTag({ content: 'body > :not(#canvas):not(script) { display: none !important; }' });
    const shot = await capture(label);
    shots.push(shot);
    if (label === 'base') {
      await page.waitForTimeout(500);
      const pausedDifference = difference(shot, await capture('paused'));
      assert(pausedDifference.mean < 0.5, `Paused glass drifts: ${JSON.stringify(pausedDifference)}`);
    }
  }
  const translatedDifference = difference(shots[0], shots[1]);
  const returnedDifference = difference(shots[0], shots[2]);
  assert(
    translatedDifference.mean < 0.5,
    `Surface marks slide with world position: ${JSON.stringify(translatedDifference)}`,
  );
  assert(
    returnedDifference.mean < 0.5,
    `Same pose must reproduce the same surface: ${JSON.stringify(returnedDifference)}`,
  );
  await page.mouse.move(500, 450);
  await page.mouse.down();
  await page.mouse.move(550, 425, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const turnedDifference = difference(shots[2], await capture('turned'));
  assert(
    turnedDifference.changed > 50,
    `Turning does not change the surface projection: ${JSON.stringify(turnedDifference)}`,
  );
  assert.deepEqual(failures, []);
  const beforeMove = await capture('before-eye-move');
  await page.keyboard.down('w');
  await page.waitForTimeout(500);
  await page.keyboard.up('w');
  await page.waitForTimeout(500);
  const eyeDifference = difference(beforeMove, await capture('eye-moved'));
  if (reflectionMode) assert(eyeDifference.changed > 50, 'Moving the pilot eye does not change near-field reflections');
  const report = { translatedDifference, returnedDifference, turnedDifference, eyeDifference };
  writeFileSync(join(outDir, `${prefix}.json`), JSON.stringify(report, null, 2));
  console.log('PASS: aircraft-local surface, pause stability, repeatable return, camera turn', report);
} finally {
  await browser.close();
}
