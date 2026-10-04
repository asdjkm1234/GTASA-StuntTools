/** Test-owned ordinary headed Chrome, no GPU flags: world camera/FOV diagrams. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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
const fixture = [
  '# synthetic,shot_camera_diagram',
  '# gtasa_flight_recorder,version=12',
  'local_timestamp,model,health,x,y,z,capture_elapsed_s,vx,vy,vz',
  ...[0, 1, 2, 3, 4].map((i) =>
    [`2026-10-04T00:00:0${i}.000`, 520, 1000, 1200 + i * 80, -800 + i * 20, 400, i, 80, 20, 0].join(','),
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
    route.fulfill({ body: fixture, contentType: 'text/csv' }),
  );
  await page.goto(origin + '/opensa/flight-replay.html?local=latest&hour=12&weather=10');
  await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering', null, { timeout: 120000 });
  const seek = async (seconds) => {
    await page.locator('#scrub').evaluate((node, seconds) => {
      node.value = String(seconds);
      node.dispatchEvent(new Event('input', { bubbles: true }));
    }, seconds);
    await page.waitForTimeout(150);
  };
  const snapshot = () =>
    page.evaluate(() => ({
      camera: globalThis.__flight.shotDiagramCamera,
      kind: globalThis.__flight.shotDiagramKind,
      visible: globalThis.__flight.shotDiagramVisible,
      observer: globalThis.__flight.cameraState,
      seconds: Number(document.querySelector('#scrub').value),
    }));
  const savePlan = async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#shotPlanSave').click()]);
    return JSON.parse(readFileSync(await download.path(), 'utf8'));
  };
  await page.locator('#batchShots').click();
  await page.waitForFunction(() => !globalThis.__flight.flyActive);
  await page.locator('#shotGenerate').click();
  assert.equal(
    await page.locator('#shotPanel input[type="number"], #shotPanel details, #shotPanel .shot-parameters').count(),
    0,
  );
  for (const kind of ['fixed', 'tracking', 'follow', 'cockpit']) {
    const card = page.locator(`#shot-${kind}`);
    await card.locator('[data-action="place"]').click();
    await card.locator('[data-action="save"]').click();
    const plan = await savePlan();
    await card.locator('[data-action="diagram"]').click();
    await page.waitForFunction(
      (kind) => globalThis.__flight.shotDiagramVisible && globalThis.__flight.shotDiagramKind === kind,
      kind,
    );
    const first = await snapshot();
    assert.equal(first.camera.aspect, 16 / 9);
    assert.notDeepEqual(first.observer.eye, first.camera.eye);
    assert.deepEqual(await savePlan(), plan, 'outside inspection preserves saved shot and range');
    const image = await page.screenshot({ path: `captures/shot-diagram-${kind}.png` });
    assert.ok(image.length > 10000);
    snapshots[kind] = [first];
    await seek(3);
    snapshots[kind].push(await snapshot());
    if (kind === 'fixed') assert.deepEqual(snapshots[kind][0].camera, snapshots[kind][1].camera);
    else assert.notDeepEqual(snapshots[kind][0].camera.target, snapshots[kind][1].camera.target);
    await card.locator('[data-at="0.5"]').click();
    await page.waitForFunction(() => !globalThis.__flight.shotDiagramVisible);
    assert.equal(await page.locator('#shotCameraLabels').isVisible(), false);
    assert.equal(await card.locator('[data-action="stop"]').isVisible(), true);
    await card.locator('[data-action="stop"]').click();
    await page.waitForFunction(() => globalThis.__flight.shotDiagramVisible);
    const beforePreview = await snapshot();
    await card.locator('[data-at="play"]').click();
    await page.locator('#shotPreviewToolbar').waitFor();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `captures/shot-preview-exit-${kind}.png` });
    await page.locator('#shotPreviewExit').click();
    await page.waitForFunction(() => globalThis.__flight.shotDiagramVisible);
    assert.deepEqual(await snapshot(), beforePreview, 'floating exit restores camera and original clock');
    await card.locator('[data-at="play"]').click();
    await page.locator('#shotPreviewToolbar').waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => globalThis.__flight.shotDiagramVisible);
    assert.deepEqual(await snapshot(), beforePreview, 'Escape restores camera and original clock');
    assert.equal(await page.locator('#shotPreviewToolbar').isVisible(), false);
    await seek(0);
  }
  const follow = page.locator('#shot-follow');
  await page.locator('#scrub').evaluate((node) => {
    node.value = '0.8';
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#shotStartNow').click();
  await page.locator('#scrub').evaluate((node) => {
    node.value = '1.4';
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#shotEndNow').click();
  await follow.locator('[data-at="play"]').click();
  await page.waitForFunction(
    () => Number(document.querySelector('#scrub').value) >= 1.4 && document.querySelector('#play').textContent === '▶',
  );
  assert.equal(await page.locator('#shotPreviewToolbar').isVisible(), true, 'clip ending retains an accessible exit');
  await page.locator('#shotPreviewExit').click();
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
  await follow.getByRole('button', { name: '启用分段伴飞机位' }).click();
  await follow.getByRole('button', { name: '将当前段等分' }).click();
  await follow.locator('[data-action="place"]').click();
  await page.keyboard.down('d');
  await page.waitForTimeout(300);
  await page.keyboard.up('d');
  await follow.locator('[data-action="save"]').click();
  await follow.locator('[data-action="diagram"]').click();
  const beforeSegmentSelection = (await snapshot()).observer;
  await follow.locator('[data-field="segment"]').selectOption('0');
  await page.waitForFunction(
    () => globalThis.__flight.shotDiagramVisible && Number(document.querySelector('#scrub').value) === 1,
  );
  const one = await snapshot();
  assert.deepEqual(one.observer, beforeSegmentSelection, 'changing segment keeps the complete observer camera');
  await follow.locator('[data-at="play"]').click();
  await page.locator('#shotPreviewToolbar').waitFor();
  await follow.locator('[data-field="segment"]').selectOption('1');
  await page.waitForFunction(
    () => globalThis.__flight.shotDiagramVisible && Number(document.querySelector('#scrub').value) === 3.5,
  );
  assert.equal(
    await page.locator('#shotPreviewToolbar').isVisible(),
    false,
    'segment selection exits the previous preview',
  );
  const two = await snapshot();
  assert.deepEqual(
    two.observer,
    one.observer,
    'selection during preview returns to the saved observer without a new overview',
  );
  assert.equal(await page.locator('#play').textContent(), '▶');
  const offset = (s) => s.camera.eye.map((n, i) => n - s.camera.target[i]);
  assert.notDeepEqual(offset(one), offset(two), 'diagram follows per-segment angle');
  assert.equal(await page.locator('#shot-cockpit .shot-segments').count(), 0);
  for (const kind of ['fixed', 'tracking', 'follow']) {
    const card = page.locator('#shot-' + kind);
    if (kind !== 'follow') {
      await card.getByRole('button', { name: '启用分段' + (kind === 'fixed' ? '固定镜头' : '定点跟拍') }).click();
      const splitObserver = (await snapshot()).observer;
      await card.getByRole('button', { name: '将当前段等分' }).click();
      assert.deepEqual((await snapshot()).observer, splitObserver, 'initial splitting preserves the observer');
    }
    await card.locator('[data-field="segment"]').selectOption('1');
    const splitObserver = (await snapshot()).observer;
    await card.getByRole('button', { name: '将当前段等分' }).click();
    assert.deepEqual(
      (await snapshot()).observer,
      splitObserver,
      'splitting the selected segment preserves the observer',
    );
    for (const index of [0, 1, 2]) {
      const observerBeforeSelect = (await snapshot()).observer;
      await card.locator('[data-field="segment"]').selectOption(String(index));
      await page.waitForFunction(
        ({ kind, index }) =>
          globalThis.__flight.shotDiagramVisible &&
          globalThis.__flight.shotDiagramKind === kind &&
          globalThis.__flight.shotDiagramSegments.length === 3 &&
          globalThis.__flight.shotDiagramActiveSegment === index,
        { kind, index },
      );
      assert.deepEqual(
        (await snapshot()).observer,
        observerBeforeSelect,
        'all three exterior shot types preserve the observer on selection',
      );
      const before = await savePlan();
      await card.locator('[data-action="place"]').click();
      await page.keyboard.down(index % 2 ? 'd' : 'a');
      await page.waitForTimeout(220);
      await page.keyboard.up(index % 2 ? 'd' : 'a');
      const adjustedObserver = (await snapshot()).observer;
      await card.locator('[data-field="segment"]').selectOption(String((index + 1) % 3));
      assert.deepEqual(
        (await snapshot()).observer,
        adjustedObserver,
        'selecting another segment while adjusting never moves the camera',
      );
      await page.screenshot({ path: 'captures/shot-segment-preserved-' + kind + '.png' });
      await card.locator('[data-field="segment"]').selectOption(String(index));
      assert.deepEqual(
        (await snapshot()).observer,
        adjustedObserver,
        'returning to the edited segment preserves position, aim, FOV and focus',
      );
      await card.locator('[data-action="save"]').click();
      const after = await savePlan();
      assert.notDeepEqual(after.views[kind].segments[index], before.views[kind].segments[index]);
      for (const other of [0, 1, 2].filter((n) => n !== index))
        assert.deepEqual(
          after.views[kind].segments[other],
          before.views[kind].segments[other],
          'saving preserves every other camera',
        );
      await card.locator('[data-action="diagram"]').click();
      assert.notDeepEqual(
        (await snapshot()).observer,
        adjustedObserver,
        'the explicit diagram button still moves to the overview',
      );
      await page.waitForFunction(() => globalThis.__flight.shotDiagramVisible);
      const expected = await page.evaluate(() => globalThis.__flight.shotDiagramCamera);
      const points = await page.evaluate(() => globalThis.__flight.shotDiagramSegments);
      assert.equal(points.length, 3);
      assert.deepEqual(
        points.map((p) => [p.start, p.end]),
        [
          [0, 2],
          [2, 3],
          [3, 4],
        ],
      );
      await card.getByRole('button', { name: '预览本段', exact: true }).click();
      await page.waitForFunction(() => !globalThis.__flight.shotDiagramVisible);
      const preview = await page.evaluate(() => globalThis.__flight.cameraState);
      assert.deepEqual(preview.eye, expected.eye);
      assert.deepEqual(preview.target, expected.target);
      await page.locator('#shotPreviewExit').click();
    }
    await card.locator('[data-action="diagram"]').click();
    await page.screenshot({ path: 'captures/shot-segments-' + kind + '.png' });
    const plan = await savePlan();
    await page.locator('#shotPlanFile').setInputFiles({
      name: 'segmented.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(plan)),
    });
    await page.waitForFunction(() => document.querySelector('#shotRangeNote').textContent.includes('已恢复'));
    assert.deepEqual(await savePlan(), plan);
    // Deletion merges time ranges and releases stale diagram points; restoring drops all segment controls.
    await card.locator('[data-field="segment"]').selectOption('2');
    const deleteObserver = (await snapshot()).observer;
    await card.getByRole('button', { name: '删除当前段', exact: true }).click();
    assert.deepEqual((await snapshot()).observer, deleteObserver, 'deleting a segment preserves the observer');
    await page.waitForFunction(() => globalThis.__flight.shotDiagramSegments.length === 2);
    await card
      .getByRole('button', {
        name: kind === 'follow' ? '恢复单段伴飞' : '恢复单段' + (kind === 'fixed' ? '固定镜头' : '定点跟拍'),
        exact: true,
      })
      .click();
    await page.waitForFunction(() => globalThis.__flight.shotDiagramSegments.length === 0);
    await page.locator('#shotPlanFile').setInputFiles({
      name: 'segmented.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(plan)),
    });
    await page.waitForFunction(() => document.querySelector('#shotRangeNote').textContent.includes('已恢复'));
    await card.locator('[data-action="diagram"]').click();
    await page.waitForFunction(() => globalThis.__flight.shotDiagramSegments.length === 3);
  }
  await page.locator('#shotDiagramToggle').uncheck();
  await page.waitForFunction(() => !globalThis.__flight.shotDiagramVisible);
  await page.locator('#shotDiagramToggle').check();
  await page.waitForFunction(() => globalThis.__flight.shotDiagramVisible);
  await page.locator('#singleVideoExport').click();
  await page.locator('#clientExportProgress').waitFor();
  await page.waitForFunction(() => !globalThis.__flight.shotDiagramVisible);
  assert.equal(await page.locator('#shotCameraLabels').isVisible(), false);
  await page.locator('#clientExportProgress').waitFor({ state: 'detached', timeout: 180000 });
  await page.waitForFunction(() => globalThis.__flight.shotDiagramVisible);
  const [videoDownload] = await Promise.all([page.waitForEvent('download'), page.locator('#exportNote a').click()]);
  await videoDownload.saveAs('captures/shot-diagram-free-export.mp4');
  const decoded = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-v',
      'error',
      '-i',
      'captures/shot-diagram-free-export.mp4',
      '-frames:v',
      '1',
      'captures/shot-diagram-free-export-first.png',
    ],
    { windowsHide: true },
  );
  assert.equal(decoded.status, 0);
  await page.locator('#scrub').evaluate((node) => {
    node.value = '0.8';
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#shotStartNow').click();
  await page.locator('#scrub').evaluate((node) => {
    node.value = '1.4';
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#shotEndNow').click();
  await page.locator('#shotExport').click();
  await page.locator('#clientExportProgress').waitFor();
  await page.waitForFunction(() => !globalThis.__flight.shotDiagramVisible);
  assert.equal(await page.locator('#shotCameraLabels').isVisible(), false);
  await page.locator('#clientExportCancel').click();
  await page.locator('#clientExportProgress').waitFor({ state: 'detached', timeout: 30000 });
  await page.waitForFunction(() => globalThis.__flight.shotDiagramVisible);
  await page.locator('#shotClose').click();
  await page.waitForFunction(() => !globalThis.__flight.shotDiagramVisible);
  assert.deepEqual(errors, []);
  writeFileSync('captures/shot-diagram-result.json', JSON.stringify({ snapshots, errors }, null, 2));
  console.log(JSON.stringify({ kinds: Object.keys(snapshots), errors }));
} finally {
  await browser.close();
  const exit = new Promise((resolve) => server.once('exit', resolve));
  server.kill();
  await exit;
}
