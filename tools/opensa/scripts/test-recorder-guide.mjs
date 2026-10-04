import { unzipSync } from 'fflate';
/** Real recorder download and modal input checks in fresh ordinary headed Chrome. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = mkdtempSync(path.join(tmpdir(), 'gtasa-recorder-guide-'));
const probe = createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['local-server.mjs'], {
  cwd: path.join(project, 'web-replay'),
  env: { ...process.env, GAME_ROOT: path.join(output, 'no-game'), NO_OPEN: '1', PORT: String(port) },
  stdio: ['ignore', 'ignore', 'pipe'],
  windowsHide: true,
});
server.stderr.on('data', (data) => process.stderr.write(data));
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin + '/opensa/flight-replay.html')).ok) break;
    } catch {
      // The temporary server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ channel: 'chrome', headless: false });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { height: 900, width: 1600 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (/validation error|device.*lost|invalid commandbuffer/i.test(m.text())) errors.push(m.text());
  });
  await page.goto(origin + '/opensa/flight-replay.html?hour=12&weather=10');
  await page.locator('#audioToggle').click();
  assert.equal(await page.locator('#audioToggle').textContent(), '音频：关');
  await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering' || globalThis.__flight?.error, null, {
    timeout: 120000,
  });
  assert.equal(await page.evaluate(() => globalThis.__flight.error), null);
  assert.equal(await page.evaluate(() => globalThis.__flight.audioWebMuted), true, 'Mute survives initialization without a CSV');
  await page.locator('#audioToggle').click();
  await page.click('#mapCachePause');
  await page.waitForTimeout(2000);
  const camera = () =>
    page.evaluate(() => ({
      camera: globalThis.__flight.cameraState,
      mode: globalThis.__flight.cameraMode,
      play: document.querySelector('#play').textContent,
    }));
  const initial = await camera();
  const guide = page.locator('#recorderGuide');
  await page.click('#recorderGuideOpen');
  assert.equal(await guide.evaluate((d) => d.open && d.matches(':modal')), true);
  await page.locator('#recorderDownload').waitFor({ state: 'visible' });
  await page.keyboard.press('p');
  await page.keyboard.press('v');
  await page.keyboard.down('w');
  await page.waitForTimeout(300);
  await page.keyboard.up('w');
  assert.deepEqual(await camera(), initial, 'Modal keys preserve camera and playback');
  await page.screenshot({ path: path.join(output, 'recorder-guide.png') });
  const pending = page.waitForEvent('download');
  await page.click('#recorderDownload');
  const download = await pending;
  assert.equal(download.suggestedFilename(), 'GTASA-FlightRecorder-v13.zip');
  const zipPath = path.join(output, download.suggestedFilename());
  await download.saveAs(zipPath);
  const manifest = await (await fetch(origin + '/opensa/downloads/recorder-package.json')).json();
  const zip = readFileSync(zipPath);
  assert.equal(createHash('sha256').update(zip).digest('hex'), manifest.sha256);
  const entries = unzipSync(zip);
  assert.deepEqual(Object.keys(entries).sort(), ['FlightRecorder.asi', '安装说明.txt'].sort());
  for (const file of ['FlightRecorder.asi']) {
    const binary = Buffer.from(entries[file]);
    assert.deepEqual(binary, readFileSync(path.join(project, 'recorder/build', file)));
    assert.equal(binary.readUInt16LE(binary.readUInt32LE(0x3c) + 4), 0x14c);
  }
  assert.equal(manifest.version, 13);
  assert.ok(Buffer.from(entries['FlightRecorder.asi']).includes(Buffer.from('version=13')));
  assert.ok(!Buffer.from(entries['FlightRecorder.asi']).includes(Buffer.from('GameAudioCapture.exe')));
  await page.keyboard.press('Escape');
  assert.equal(await guide.evaluate((d) => d.open), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'recorderGuideOpen');
  await page.keyboard.down('w');
  await page.waitForTimeout(150);
  await page.keyboard.up('w');
  assert.notDeepEqual((await camera()).camera.eye, initial.camera.eye, 'Camera input resumes');
  await page.click('#recorderGuideOpen');
  await page.getByRole('button', { name: '关闭安装指南' }).click();
  assert.equal(await guide.evaluate((d) => d.open), false);
  await page.setViewportSize({ height: 700, width: 390 });
  await page.click('#recorderGuideOpen');
  assert.equal(await guide.evaluate((d) => d.scrollWidth > d.clientWidth), false, 'No horizontal overflow');
  await page.getByText('怎样更新或卸载？', { exact: true }).click();
  await page.screenshot({ path: path.join(output, 'recorder-guide-small.png') });
  await page.getByRole('button', { name: '明白了，返回回放' }).click();
  assert.equal(await guide.evaluate((d) => d.open), false);
  // Import the actual v13 C++ writer output and verify aircraft/instruments/synthesis.
  await page.setViewportSize({ height: 900, width: 1600 });
  await page.setInputFiles('#picker', path.join(project, 'tools/opensa/captures/recorder-v13-damage-keys.csv'));
  await page.waitForFunction(
    () =>
      globalThis.__flight.cameraMode === 'chase-mid' &&
      globalThis.__flight.aircraft.includes('hydra') &&
      globalThis.__flight.instrumentState?.throttle === 1,
  );
  await page.waitForFunction(
    () => globalThis.__flight.audioWebState === 'ready' || globalThis.__flight.audioWebSamples > 0,
  );
  assert.equal(await page.locator('#audioSource, #audioMixer, #audioMixerToggle').count(), 0);
  assert.equal(await page.locator('#audioStatus, #right, #readout').count(), 0);
  assert.equal(await page.getByRole('button', { exact: true, name: '原始数据' }).count(), 0);
  assert.equal(await page.locator('#picker').getAttribute('accept'), '.csv,text/csv');
  await page.screenshot({ path: path.join(output, 'recorder-v13-replay.png') });
  // Lengthen capture times for mute/play checks; the original C++ fixture lasts only 0.12 seconds.
  const lines = readFileSync(path.join(project, 'tools/opensa/captures/recorder-v13-damage-keys.csv'), 'utf8').split(/\r?\n/);
  const header = lines.find((line) => line.startsWith('local_timestamp,'));
  const timeColumn = header.split(',').indexOf('capture_elapsed_s');
  assert.ok(timeColumn >= 0);
  const longFixture = lines.filter((line) => !line.startsWith('# event,')).map((line) => {
    if (!line || line.startsWith('#') || line === header) return line;
    const cells = line.split(',');
    cells[timeColumn] = String(Number(cells[timeColumn]) * 1000);
    return cells.join(',');
  }).join('\n');
  await page.setInputFiles('#picker', { name: 'v13-synth-controls.csv', mimeType: 'text/csv', buffer: Buffer.from(longFixture) });
  await page.waitForFunction(() => Number(document.querySelector('#scrub').max) >= 10);
  await page.locator('#play').click();
  await page.waitForFunction(() => globalThis.__flight.audioWebPlaying);
  await page.locator('#audioToggle').click();
  await page.waitForFunction(() => globalThis.__flight.audioWebMuted);
  await page.locator('#audioToggle').click();
  await page.waitForFunction(() => !globalThis.__flight.audioWebMuted);
  await page.locator('#play').click();
  await page.screenshot({ path: path.join(output, 'synth-only-controls.png') });
  assert.deepEqual(errors, []);
  await page.route('**/downloads/recorder-package.json', (route) =>
    route.fulfill({ body: 'not packaged', status: 404 }),
  );
  await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined }));
  await page.reload();
  await page.locator('#renderError').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#insecureContextHelp').isVisible(), false);
  await page.click('#recorderGuideOpen');
  await page.waitForFunction(() => document.querySelector('#recorderDownloadStatus').textContent.includes('暂未提供'));
  assert.equal(await page.locator('#recorderDownload').isVisible(), false);
  assert.equal(await guide.evaluate((d) => d.open), true);
  await page.keyboard.press('Escape');
  assert.equal(await guide.evaluate((d) => d.open), false);
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: false });
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined });
  });
  await page.reload();
  await page.locator('#renderError').waitFor({ state: 'visible' });
  assert.match(await page.locator('#renderErrorMessage').textContent(), /公网 HTTP/);
  assert.equal(await page.evaluate(() => globalThis.__flight.phase), 'insecure-context');
  assert.equal(await page.locator('#insecureContextHelp').isVisible(), true);
  assert.equal(await page.locator('#insecureContextOrigin').textContent(), origin);
  assert.match(await page.locator('#insecureContextHelp').textContent(), /chrome:\/\/flags\//);
  assert.match(await page.locator('#insecureContextHelp').textContent(), /恢复 Disabled/);
  assert.deepEqual(errors, [], 'HTTP without randomUUID shows a useful error instead of crashing');
  await page.screenshot({ path: path.join(output, 'insecure-http.png') });
  await page.setViewportSize({ width: 390, height: 700 });
  const errorBounds = await page.locator('#renderError').boundingBox();
  assert.ok(errorBounds.x >= 0 && errorBounds.y >= 0);
  assert.ok(errorBounds.x + errorBounds.width <= 390 && errorBounds.y + errorBounds.height <= 700);
  await page.locator('#retryRenderer').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'insecure-http-small.png') });
  const report = {
    cameraIsolation: true,
    downloadedBytes: zip.length,
    errors,
    files: Object.keys(entries),
    keyboardRestored: true,
    insecureHttpExplained: true,
    output,
    result: 'PASS',
    sha256: manifest.sha256,
    smallViewport: true,
    unavailableRenderer: true,
    synthOnlyCsvReplay: true,
  };
  writeFileSync(path.join(output, 'recorder-guide-check.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  server.kill();
}
