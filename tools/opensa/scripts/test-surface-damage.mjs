/** Exercise SYNTHETIC v10 transitions over real local flight poses; never modifies game or recordings. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const root = '../../GTA San Andreas/flight_recordings/';
const sources = [
  ['hydra', 'flight_20260930_012855_010_m520_002.csv'],
  ['rustler', 'flight_20260930_013657_919_m476_003.csv'],
];
mkdirSync('captures', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (/validation error|device.*lost|Invalid CommandBuffer/i.test(m.text())) errors.push(m.text());
});
await page.route('**/local-recording/latest.csv', (r) =>
  r.fulfill({ body: readFileSync(root + sources[0][1]), contentType: 'text/csv' }),
);
const upload = async (name, text, model) => {
  const count = await page.locator('#tracks .track').count();
  await page.setInputFiles('#picker', { name, mimeType: 'text/csv', buffer: Buffer.from(text) });
  await page.waitForFunction((n) => document.querySelectorAll('#tracks .track').length > n, count);
  await page.locator('#tracks .track').last().click();
  await page.waitForFunction((name) => globalThis.__flight?.aircraft?.includes(name), model);
};
try {
  await page.goto('http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&weather=10&hour=12');
  await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering', null, { timeout: 90000 });
  for (const [model, filename] of sources) {
    const original = readFileSync(root + filename, 'utf8');
    const lines = original.trim().split(/\r?\n/);
    const header = lines.find((l) => l.startsWith('local_timestamp,'));
    const names = header.split(',');
    const at = names.indexOf('capture_elapsed_s');
    assert(at >= 0);
    const rows = lines.filter((l) => l && !l.startsWith('#') && l !== header).slice(0, 3);
    const damage = ['31,game_memory,80128,1,2,3,0,1', '31,game_memory,34304,2,1,0,2,0', '0,unknown,-1,-1,-1,-1,-1,-1'];
    const csv =
      '# gtasa_flight_recorder,version=10,sample_hz=25\n# synthetic damage test, not a measured game recording\n' +
      header +
      ',surface_damage_valid,surface_damage_source,plane_damage_raw,rudder_damage,elevator_l_damage,elevator_r_damage,aileron_l_damage,aileron_r_damage\n' +
      rows
        .map((row, i) => {
          const cells = row.split(',');
          cells[at] = String(i * 0.04);
          return cells.join(',') + ',' + damage[i];
        })
        .join('\n');
    await upload(`synthetic-v10-damage-${model}.csv`, csv, model);
    await page.waitForFunction(() => globalThis.__flight?.worldReady);
    await page.waitForTimeout(2500);
    for (const [time, expected] of [
      [0, [1, 2, 3, 0, 1]],
      [0.04, [2, 1, 0, 2, 0]],
      [0.08, Array(5).fill(null)],
    ]) {
      await page.evaluate((s) => {
        const scrub = document.getElementById('scrub');
        scrub.value = String(s);
        scrub.dispatchEvent(new Event('input', { bubbles: true }));
      }, time);
      await page.waitForFunction(
        ([seconds, states]) => Math.abs(globalThis.__flight.instrumentState?.s - seconds) < 0.001 &&
          JSON.stringify(globalThis.__flight.instrumentState?.damage) === JSON.stringify(states),
        [time, expected],
      );
      if (time === 0) {
        await page.screenshot({ path: `captures/synthetic-v10-damage-${model}.png` });
      }
    }
    await upload(`legacy-${model}.csv`, original, model);
    await page.waitForFunction(
      () => globalThis.__flight.instrumentState?.damage.every((state) => state === null),
    );
    console.log(`PASS ${model}: v10 five independent slots, discrete transitions, unknown and legacy fallback`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
