/** Actual Fullscreen API in ordinary headed Chrome; preserve gauges, replay state and panel preferences. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

mkdirSync('captures', { recursive: true });
const errors = [],
  report = {};
const browser = await chromium.launch({ channel: 'chrome', headless: false });
try {
  const page = await browser.newPage({ viewport: null });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (/validation error|device.*lost|invalid shader|Invalid CommandBuffer/i.test(m.text())) errors.push(m.text());
  });
  await page.route('**/local-recording/latest.csv', (r) =>
    r.fulfill({
      body: readFileSync('../../GTA San Andreas/flight_recordings/flight_20260930_220316_220_m520_002.csv'),
      contentType: 'text/csv',
    }),
  );
  await page.goto('http://127.0.0.1:4173/opensa/flight-replay.html?local=latest&weather=10&hour=12');
  await page.waitForFunction(() => globalThis.__flight?.phase === 'rendering' || globalThis.__flight?.error, null, {
    timeout: 90000,
  });
  assert.equal(await page.evaluate(() => globalThis.__flight.error), null);
  await page.locator('#mapLoading').waitFor({ state: 'hidden', timeout: 120000 });
  await page.locator('#scrub').evaluate((e) => {
    e.value = '14.916';
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => Math.abs(globalThis.__flight.instrumentState?.s - 14.916) < 0.002);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  const snapshot = () =>
    page.evaluate(() => {
      const rect = (id) => {
        const r = document.getElementById(id).getBoundingClientRect();
        return { bottom: r.bottom, height: r.height, left: r.left, right: r.right, top: r.top, width: r.width };
      };
      return {
        canvas: [document.getElementById('canvas').width, document.getElementById('canvas').height],
        controls: rect('surface-feedback'),
        fullscreen: document.fullscreenElement === document.documentElement,
        height: innerHeight,
        immersive: document.body.classList.contains('replay-fullscreen'),
        instruments: rect('flight-instruments'),
        layout: globalThis.__flight.hudLayout,
        mode: globalThis.__flight.cameraMode,
        state: globalThis.__flight.instrumentState,
        transport: rect('transport'),
        width: innerWidth,
      };
    });
  report.before = await snapshot();
  assert(await page.locator('#flight-instruments').isVisible());
  await page.screenshot({ path: 'captures/replay-fullscreen-before.png' });
  await page.locator('#fullscreen').click();
  await page.waitForFunction(
    () =>
      document.fullscreenElement === document.documentElement && document.body.classList.contains('replay-fullscreen'),
  );
  await page.waitForFunction(
    () => Math.abs(globalThis.__flight.hudLayout.top + globalThis.__flight.hudLayout.height - (innerHeight - 16)) < 0.1,
  );
  report.fullscreen = await snapshot();
  for (const selector of ['#left', '#transport', '.chips'])
    assert.equal(await page.locator(selector).isVisible(), false, `${selector} hidden in fullscreen`);
  assert(await page.locator('#flight-instruments').isVisible());
  assert(await page.locator('#surface-feedback').isVisible());
  assert.deepEqual(report.fullscreen.state, report.before.state, 'Fullscreen preserves paused instrument readings');
  assert.equal(report.fullscreen.mode, report.before.mode, 'Fullscreen preserves camera mode');
  assert.equal(report.fullscreen.transport.height, 0);
  const gauges = report.fullscreen.instruments;
  assert(gauges.left >= 15 && gauges.right <= report.fullscreen.width - 15);
  assert(Math.abs(gauges.bottom - (report.fullscreen.height - 16)) < 0.1, 'Gauges use reclaimed control-bar space');
  await page.screenshot({ path: 'captures/replay-fullscreen-active.png' });
  // The browser's native Esc may not be delivered through CDP as a browser accelerator. An API exit
  // still exercises the exact fullscreenchange path used by Esc/window/browser exits.
  await page.keyboard.press('Escape');
  try {
    await page.waitForFunction(() => !document.fullscreenElement, null, { timeout: 1500 });
    report.exit = 'Escape';
  } catch {
    await page.evaluate(() => document.exitFullscreen());
    report.exit = 'Fullscreen API (CDP Esc did not reach the browser accelerator)';
  }
  await page.waitForFunction(() => !document.body.classList.contains('replay-fullscreen'));
  await page.waitForFunction(
    () =>
      globalThis.__flight.hudLayout.top + globalThis.__flight.hudLayout.height <
      document.getElementById('transport').getBoundingClientRect().top,
  );
  report.restored = await snapshot();
  for (const id of ['left', 'transport'])
    assert(await page.locator('#' + id).isVisible(), `${id} restored`);
  assert.deepEqual(report.restored.state, report.before.state);
  await page.screenshot({ path: 'captures/replay-fullscreen-restored.png' });
  // Starting fullscreen while playing must not pause or reset the take.
  await page.keyboard.press('p');
  await page.waitForFunction(() => document.getElementById('play').textContent === 'Ⅱ');
  const time = await page.evaluate(() => globalThis.__flight.instrumentState.s);
  await page.locator('#fullscreen').click();
  await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
  await page.waitForFunction((s) => globalThis.__flight.instrumentState.s > s + 0.25, time);
  assert.match(await page.locator('#mode').textContent(), /播放中/);
  await page.keyboard.press('p');
  await page.waitForFunction(() => document.getElementById('play').textContent === '▶');
  const pausedTime = await page.evaluate(() => globalThis.__flight.instrumentState.s);
  await page.waitForTimeout(300);
  assert.equal(
    await page.evaluate(() => globalThis.__flight.instrumentState.s),
    pausedTime,
    'P pauses fullscreen playback',
  );
  await page.keyboard.down('p');
  await page.keyboard.down('p'); // Playwright emits repeat=true for a held key.
  await page.waitForFunction((s) => globalThis.__flight.instrumentState.s > s + 0.25, pausedTime);
  assert.equal(await page.locator('#play').textContent(), 'Ⅱ', 'Holding P must not toggle repeatedly');
  await page.keyboard.up('p');
  await page.keyboard.press('p');
  await page.waitForFunction(() => document.getElementById('play').textContent === '▶');
  assert.equal(await page.locator('#transport').isVisible(), false);
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.body.classList.contains('replay-fullscreen'));
  // Button and key share one toggle; input/select focus and modified shortcuts must not start playback.
  await page.locator('#play').click();
  assert.equal(await page.locator('#play').textContent(), 'Ⅱ');
  await page.locator('#play').click();
  for (const selector of ['#scrub', '#speed']) {
    await page.locator(selector).focus();
    await page.keyboard.press('p');
    assert.equal(await page.locator('#play').textContent(), '▶', `${selector} protects focused input`);
    await page.locator(selector).evaluate((e) => e.blur());
  }
  for (const key of ['Control+p', 'Alt+p', 'Meta+p']) {
    // Dispatch to the page to avoid invoking Chrome's own print/menu shortcuts in the test browser.
    await page.evaluate(
      (key) =>
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            altKey: key.startsWith('Alt'),
            bubbles: true,
            code: 'KeyP',
            ctrlKey: key.startsWith('Control'),
            key: 'p',
            metaKey: key.startsWith('Meta'),
          }),
        ),
      key,
    );
    assert.equal(await page.locator('#play').textContent(), '▶', `${key} leaves playback paused`);
  }
  // A rejected request leaves the controls accessible, with a retryable nonfatal message.
  await page.evaluate(() => {
    document.documentElement.requestFullscreen = async () => {
      throw new Error('test denial');
    };
  });
  await page.locator('#fullscreen').click();
  await page.locator('#fullscreenStatus').waitFor({ state: 'visible' });
  assert.equal(
    await page.evaluate(() => !!document.fullscreenElement || document.body.classList.contains('replay-fullscreen')),
    false,
  );
  assert(await page.locator('#transport').isVisible());
  assert(await page.locator('#left').isVisible());
  assert(await page.locator('#fullscreen').isEnabled());
  assert.equal(await page.evaluate(() => globalThis.__flight.error), null);
  assert.deepEqual(errors, []);
  report.errors = errors;
  writeFileSync('captures/replay-fullscreen.json', JSON.stringify(report, null, 2));
  console.log(
    'PASS: real fullscreen, clean UI, gauges/layout, restoration, P playback/repeat/input guards, rejected request',
    JSON.stringify({
      before: [report.before.width, report.before.height],
      errors,
      exit: report.exit,
      fullscreen: [report.fullscreen.width, report.fullscreen.height],
    }),
  );
} finally {
  await browser.close();
}
