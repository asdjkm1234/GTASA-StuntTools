/** Real full-map persistence in a test-owned ordinary headed Chrome profile. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../web-replay');
const prefix = path.join(tmpdir(), 'gtasa-map-cache-chrome-');
const profile = await fs.mkdtemp(prefix);
const output = path.resolve('captures');
await fs.mkdir(output, { recursive: true });
const probe = createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const server = spawn(process.execPath, [path.join(root, 'local-server.mjs')], {
  cwd: root, env: { ...process.env, PORT: String(port), NO_OPEN: '1', GAME_ROOT: path.join(tmpdir(), 'gtasa-no-game-cache-test') },
  stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
});
server.stderr.on('data', bytes => process.stderr.write(bytes));
const origin = `http://127.0.0.1:${port}`;
let context;
const errors = [], encodings = new Set(), phases = {};
const counts = { interrupted: [], resumed: [], cached: [] };
let current = 'interrupted';
async function openContext(interrupt = false, offline = false) {
  context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: false, viewport: { width: 1600, height: 900 } });
  const page = context.pages()[0] ?? await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/validation error|device.*lost|invalid commandbuffer/i.test(message.text())) errors.push(message.text()); });
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/map-pak/') && !url.pathname.endsWith('/cache-manifest.json')) counts[current].push(url.pathname);
  });
  page.on('response', response => {
    if (new URL(response.url()).pathname.startsWith('/map-pak/textures/')) {
      const encoding = response.headers()['content-encoding']; if (encoding) encodings.add(encoding);
    }
  });
  await page.route('**/local-recording/latest.csv', route => route.fulfill({ status: 404, body: 'No local recording' }));
  if (interrupt) await page.route('**/map-pak/aircraft/rustler.dff?*', route => route.abort('failed'));
  if (offline) await page.route('**/map-pak/**', route => route.abort('failed'));
  await page.goto(origin + '/opensa/flight-replay.html?hour=12&weather=10');
  await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering' || globalThis.__flight?.error, null, { timeout: 180000 });
  assert.equal(await page.evaluate(() => globalThis.__flight.error), null);
  return page;
}
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin + '/opensa/flight-replay.html')).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  let page = await openContext(true);
  await page.waitForFunction(() => globalThis.__flight.mapCache?.phase === 'interrupted', null, { timeout: 60000 });
  phases.interrupted = await page.evaluate(() => globalThis.__flight.mapCache);
  assert.ok(phases.interrupted.savedBytes > 200 * 1024 * 1024);
  console.log(JSON.stringify({ phase: 'interruption-and-partial-cache', savedFiles: phases.interrupted.savedFiles }));
  await context.close(); context = null;
  current = 'resumed';
  page = await openContext();
  assert.equal(counts.resumed.filter(name => name.includes('/textures/')).length, 0, 'Texture files survive browser close/reopen');
  await page.waitForFunction(() => globalThis.__flight.mapCache?.phase === 'ready' || globalThis.__flight.mapCache?.phase === 'limited' || globalThis.__flight?.error, null, { timeout: 300000 });
  phases.ready = await page.evaluate(() => globalThis.__flight.mapCache);
  assert.equal(phases.ready.phase, 'ready');
  assert.equal(phases.ready.savedFiles, phases.ready.files);
  console.log(JSON.stringify({ phase: 'full-map-saved', files: phases.ready.files, bytes: phases.ready.savedBytes }));
  await page.screenshot({ path: path.join(output, 'map-cache-ready.png') });
  await context.close(); context = null;
  current = 'cached';
  page = await openContext(false, true);
  assert.equal(counts.cached.length, 0, 'Offline map reads issue no asset HTTP requests');
  phases.cached = await page.evaluate(() => globalThis.__flight.mapCache);
  assert.equal(phases.cached.phase, 'ready');
  const fixture = [
    '# gtasa_flight_recorder,version=12',
    'local_timestamp,model,health,x,y,z,capture_elapsed_s,vx,vy,vz',
    ...[0, 1, 2, 3].map(i => `2026-10-04T00:00:0${i}.000,520,1000,${1093 + i * 80},-2036,400,${i},80,0,0`),
  ].join('\n');
  await page.locator('#picker').setInputFiles({ name: 'cache-flight.csv', mimeType: 'text/csv', buffer: Buffer.from(fixture) });
  await page.waitForFunction(() => globalThis.__flight.aircraft.includes('hydra') && globalThis.__flight.cameraMode === 'chase-mid', null, { timeout: 30000 });
  await page.waitForTimeout(2000);
  assert.equal(counts.cached.length, 0, 'Cached aircraft/audio/map replay needs no map HTTP requests');
  assert.equal(await page.evaluate(() => globalThis.__flight.error), null);
  await page.screenshot({ path: path.join(output, 'map-cache-offline-replay.png') });
  phases.storage = await page.evaluate(() => navigator.storage.estimate());
  await page.locator('#mapCacheClear').click();
  await page.waitForFunction(() => globalThis.__flight.mapCache.savedFiles === 0 && globalThis.__flight.mapCache.phase === 'paused');
  phases.cleared = await page.evaluate(() => globalThis.__flight.mapCache);
  assert.ok(encodings.has('br') || encodings.has('gzip'), 'The actual map transfer is compressed');
  assert.deepEqual(errors, []);
  const report = { result: 'PASS', phases, assetRequests: Object.fromEntries(Object.entries(counts).map(([key, values]) => [key, values.length])), encodings: [...encodings], errors };
  await fs.writeFile(path.join(output, 'map-cache-check.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await context?.close();
  server.kill();
  if (!path.resolve(profile).startsWith(path.resolve(prefix))) throw new Error('Unexpected browser profile path');
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
