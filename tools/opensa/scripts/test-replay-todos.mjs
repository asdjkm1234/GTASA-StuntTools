/** Fresh ordinary headed Chrome: segmented follow, route autoplay and transport stability. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const probe = createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../web-replay');
const server = spawn(process.execPath, [path.join(root, 'local-server.mjs')], {
  cwd: root,
  env: { ...process.env, PORT: String(port), NO_OPEN: '1' },
  stdio: ['ignore', 'ignore', 'pipe'],
  windowsHide: true,
});
server.stderr.on('data', (bytes) => process.stderr.write(bytes));
process.once('exit', () => {
  if (!server.killed) server.kill();
});
const origin = `http://127.0.0.1:${port}`;
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(origin + '/opensa/flight-replay.html')).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 100));
}
const fixture = (model = 520, x = 1200, duration = 4) =>
  [
    '# synthetic,replay_todos',
    '# gtasa_flight_recorder,version=12',
    'local_timestamp,model,health,x,y,z,capture_elapsed_s,vx,vy,vz',
    ...[0, 1, 2, 3, 4].map((i) =>
      [`2026-10-04T00:00:0${i}.000`, model, 1000, x + i * 30, -800, 400, (i * duration) / 4, 30, 0, 0].join(','),
    ),
  ].join('\n');
mkdirSync('captures', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: false });
const errors = [],
  snapshots = {};
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    if (/validation error|device.*lost|invalid commandbuffer/i.test(msg.text())) errors.push(msg.text());
  });
  await page.route('**/local-recording/latest.csv', (route) =>
    route.fulfill({ body: fixture(), contentType: 'text/csv' }),
  );
  await page.goto(origin + '/opensa/flight-replay.html?local=latest&hour=12&weather=10');
  await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering', null, { timeout: 120000 });
  const seek = async (time) => {
    await page.locator('#scrub').evaluate((node, time) => {
      node.value = String(time);
      node.dispatchEvent(new Event('input', { bubbles: true }));
    }, time);
    await page.waitForTimeout(100);
  };
  const read = () =>
    page.evaluate(() => ({
      phase: globalThis.__flight.routeAutoplayPhase,
      progress: globalThis.__flight.routeAutoplayProgress,
      index: globalThis.__flight.activeTrackIndex,
      camera: globalThis.__flight.cameraState,
      time: Number(document.querySelector('#scrub').value),
      playing: document.querySelector('#play').textContent,
    }));
  await page.locator('#batchShots').click();
  await page.waitForFunction(() => !globalThis.__flight.flyActive);
  await page.locator('#scrub').evaluate((node) => {
    node.value = '0';
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#shotStartNow').click();
  await page.locator('#scrub').evaluate((node) => {
    node.value = '4';
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#shotEndNow').click();
  await page.locator('#shotGenerate').click();
  const follow = page.locator('.shot-card').filter({ hasText: '伴飞机位' });
  await follow.getByRole('button', { name: '启用分段伴飞机位' }).click();
  await follow.getByRole('button', { name: '将当前段等分' }).click();
  await follow.locator('[data-action="place"]').click();
  await page.keyboard.down('d');
  await page.waitForTimeout(300);
  await page.keyboard.up('d');
  await follow.locator('[data-action="save"]').click();
  await follow.getByRole('button', { name: '预览本段', exact: true }).click();
  await page.waitForTimeout(150);
  snapshots.segmentPreview = await read();
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#shotPlanSave').click();
  const download = await downloadEvent;
  await download.saveAs('captures/todos-shot-plan.json');
  const plan = JSON.parse(readFileSync('captures/todos-shot-plan.json', 'utf8'));
  assert.equal(plan.views.follow.segments.length, 2);
  assert.equal(plan.views.follow.segments[1].heading, 'aircraft');
  assert.equal(plan.views.follow.segments[1].transition, 1);
  assert.notDeepEqual(plan.views.follow.segments[0].offset, plan.views.follow.segments[1].offset);
  await page.screenshot({ path: 'captures/todos-follow-segments.png' });
  await follow.getByRole('button', { name: '恢复单段伴飞' }).click();
  await page.locator('#shotPlanFile').setInputFiles('captures/todos-shot-plan.json');
  await page.waitForFunction(
    () => document.querySelector('.shot-segments [data-field="segment"]')?.options.length === 2,
  );
  await page.locator('#shotClose').click();
  await page.locator('#resetView').click();

  const fixtures = [
    ['second.csv', fixture(476, 2100, 2)],
    ['third.csv', fixture(520, 1500, 2)],
  ];
  await page
    .locator('#picker')
    .setInputFiles(fixtures.map(([name, body]) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(body) })));
  await page.waitForFunction(() => document.querySelectorAll('.track').length === 3);
  await page.locator('.track-select').first().click();
  await page.locator('#routeAutoplay').check();
  await seek(3.7);
  await page.locator('#play').click();
  const states = [];
  const start = Date.now();
  while (Date.now() - start < 45000) {
    const value = await read();
    states.push({ ...value, now: Date.now() });
    if (value.index === 2 && value.time >= 2 && value.playing === '▶' && value.phase === 'idle') break;
    await page.waitForTimeout(40);
  }
  const last = states.at(-1);
  assert.equal(last.index, 2, JSON.stringify(last));
  assert.equal(last.time, 2);
  assert.equal(last.playing, '▶');
  for (const index of [0, 1]) {
    const waiting = states.find((s) => s.index === index && s.phase === 'waiting');
    const next = states.find((s) => s.index === index + 1);
    assert.ok(waiting && next, 'each natural ending waits then switches');
    assert.ok(next.now - waiting.now >= 1950, 'two-second real-time delay');
    const moving = states.filter((s) => s.index === index + 1 && s.phase === 'moving');
    assert.ok(moving.length >= 8, 'camera moves through intermediate frames');
    assert.ok(moving.at(-1).progress - moving[0].progress > 0.7);
    const total = Math.hypot(...moving.at(-1).camera.eye.map((v, k) => v - moving[0].camera.eye[k]));
    assert.ok(total > 100);
    for (let i = 1; i < moving.length; i++)
      assert.ok(
        Math.hypot(...moving[i].camera.eye.map((v, k) => v - moving[i - 1].camera.eye[k])) < total * 0.4,
        'no instantaneous teleport',
      );
  }
  snapshots.sequence = states;
  await page.screenshot({ path: 'captures/todos-autoplay-final.png' });
  await page.locator('.track-select').first().click();
  await seek(4);
  await page.waitForTimeout(2300);
  assert.equal((await read()).index, 0, 'seeking to end never arms autoplay');
  await seek(3.8);
  await page.locator('#play').click();
  await page.waitForFunction(() => globalThis.__flight.routeAutoplayPhase === 'waiting');
  await page.locator('#play').click();
  await page.waitForTimeout(2300);
  assert.equal((await read()).index, 0, 'pause cancels delayed switch');
  await seek(3.8);
  await page.locator('#play').click();
  await page.waitForFunction(
    () => globalThis.__flight.routeAutoplayPhase === 'moving' && globalThis.__flight.routeAutoplayProgress > 0.2,
  );
  await page.screenshot({ path: 'captures/todos-autoplay-moving.png' });
  await page.locator('#play').click();
  await page.waitForTimeout(150);
  const canceled = await read();
  assert.equal(canceled.phase, 'idle');
  assert.equal(canceled.playing, '▶');
  assert.equal(await page.evaluate(() => globalThis.__flight.cameraMode), 'free');
  await page.waitForTimeout(1600);
  assert.deepEqual((await read()).camera, canceled.camera, 'canceling keeps the current traveling camera pose');
  await page.locator('.track-select').first().click();
  await seek(3.8);
  await page.locator('#play').click();
  await page.waitForFunction(() => globalThis.__flight.routeAutoplayPhase === 'waiting');
  await page.keyboard.press('p');
  await page.waitForTimeout(2300);
  assert.equal((await read()).index, 0, 'keyboard pause cancels delayed switch');
  assert.equal(await page.evaluate(() => globalThis.__flight.cameraMode), 'free');
  await seek(3.8);
  await page.locator('#play').click();
  await page.waitForFunction(() => globalThis.__flight.routeAutoplayPhase === 'waiting');
  const freeDeparture = (await read()).camera;
  await page.waitForFunction(
    () => globalThis.__flight.activeTrackIndex === 1 && globalThis.__flight.routeAutoplayPhase === 'idle',
    null,
    { timeout: 30000 },
  );
  await page.locator('#play').click();
  const freeArrival = (await read()).camera;
  assert.ok(
    Math.abs(freeArrival.eye[0] - freeDeparture.eye[0] - 780) < 0.01,
    'free view preserves its relative route offset',
  );
  assert.ok(Math.abs(freeArrival.eye[1] - freeDeparture.eye[1]) < 0.01);
  assert.ok(Math.abs(freeArrival.eye[2] - freeDeparture.eye[2]) < 0.01);
  snapshots.freeTravel = { from: freeDeparture, to: freeArrival };
  await page.locator('#routeAutoplay').uncheck();

  await page
    .locator('#picker')
    .setInputFiles({ name: 'long.csv', mimeType: 'text/csv', buffer: Buffer.from(fixture(520, 1200, 6100)) });
  await page.waitForFunction(() => document.querySelectorAll('.track').length === 4);
  await page.locator('.track-select').last().click();
  const positions = [];
  for (const time of [0.111, 1.888, 9.999, 59.999, 60, 5999.999, 6000]) {
    await seek(time);
    positions.push(
      await page.locator('#clock').evaluate((node) => ({
        width: node.getBoundingClientRect().width,
        text: node.textContent,
        siblings: [...node.parentElement.children].map((n) => ({
          x: n.getBoundingClientRect().x,
          y: n.getBoundingClientRect().y,
        })),
      })),
    );
  }
  for (const item of positions) {
    assert.equal(item.width, positions[0].width);
    assert.deepEqual(item.siblings, positions[0].siblings);
  }
  snapshots.clock = positions;
  await page.screenshot({ path: 'captures/todos-clock.png' });
  assert.deepEqual(errors, []);
  writeFileSync('captures/todos-result.json', JSON.stringify({ snapshots, errors }, null, 2));
  console.log(
    JSON.stringify({
      segments: plan.views.follow.segments.length,
      routeStates: states.length,
      clockWidths: positions.map((p) => p.width),
      errors,
    }),
  );
} finally {
  await browser.close();
  const exit = new Promise((resolve) => server.once('exit', resolve));
  server.kill();
  await exit;
}
