import { build } from 'esbuild';
/**
 * Export HUD canvas contract test (todo 22).
 *
 * The export renders the analysis gauges to a 2D canvas (`apps/web/src/flight/analysis-hud-canvas.ts`)
 * instead of the DOM HUD, so this asserts the contract on ENCODED PIXELS, not on a screenshot:
 *
 *   (a) the canvas backing size is exactly 1920x1080 regardless of display DPR;
 *   (b) value parity with the headless `analysis-metrics` values for the same sampled time (and with the
 *       DOM HUD, the information the export must not lose);
 *   (c) on a composited frame the HUD pixels fall inside the declared bounds and every byte outside those
 *       bounds is identical to the no-HUD render (byte compare);
 *   (d) deterministic layout across a simulated DPR-2 run (byte-identical render, identical bounds).
 *
 * Also asserts the adversarial cases: a stale canvas is re-sized AND redrawn when the frame size changes,
 * and a missing metric renders an em-dash instead of crashing (`--drop-metric <id>`).
 *
 * Runs a FRESH throwaway Chrome profile over CDP (never a reused profile) and needs no server: the module
 * is bundled here with esbuild and injected into `about:blank`, because Canvas 2D does not exist in Node.
 *
 *   node scripts/test-export-hud.mjs
 *   node scripts/test-export-hud.mjs --drop-metric altitude
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const REPO_ROOT = resolve(process.cwd(), '..', '..');
const EVIDENCE = join(REPO_ROOT, '.omo', 'evidence');
const EVIDENCE_PNG = join(EVIDENCE, 'task-22-flight-analysis-remediation-and-worktree-cleanup.png');
const EVIDENCE_TXT = join(EVIDENCE, 'task-22-flight-analysis-remediation-and-worktree-cleanup.txt');
const GAUGE_IDS = [
  'attitude',
  'groundSpeed',
  'altitude',
  'climbRate',
  'heading',
  'throttle',
  'health',
  'gForce',
  'angularRate',
];
const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
];

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const dropIndex = process.argv.indexOf('--drop-metric');
const dropMetric = dropIndex >= 0 ? process.argv[dropIndex + 1] : null;
if (dropIndex >= 0 && (dropMetric === undefined || !GAUGE_IDS.includes(dropMetric))) {
  console.error(`usage: node scripts/test-export-hud.mjs [--drop-metric <${GAUGE_IDS.join('|')}>]`);
  process.exit(2);
}

// ---------------------------------------------------------------------------------------------------
// Bundle the module + the headless sampler for the browser (Canvas 2D needs a real browser)
// ---------------------------------------------------------------------------------------------------

const ENTRY = `
import { AnalysisHud } from './apps/web/src/flight/analysis-hud.ts';
import { AnalysisHudCanvas, EXPORT_HUD_BOUNDS, EXPORT_HUD_FRAME_HEIGHT, EXPORT_HUD_FRAME_WIDTH, gaugeTexts } from './apps/web/src/flight/analysis-hud-canvas.ts';
import { analyzeTrack, sampleAnalysis } from './apps/web/src/flight/analysis-metrics.ts';

export { AnalysisHud, AnalysisHudCanvas, EXPORT_HUD_BOUNDS, EXPORT_HUD_FRAME_HEIGHT, EXPORT_HUD_FRAME_WIDTH, gaugeTexts, analyzeTrack, sampleAnalysis };
`;

async function bundleHarness() {
  const result = await build({
    bundle: true,
    format: 'iife',
    globalName: '__exportHudHarness',
    logLevel: 'silent',
    platform: 'browser',
    stdin: { contents: ENTRY, loader: 'ts', resolveDir: process.cwd(), sourcefile: 'export-hud-test-entry.ts' },
    target: 'es2020',
    write: false,
  });

  return result.outputFiles[0].text;
}

// ---------------------------------------------------------------------------------------------------
// Browser lifecycle (fresh profile, close only the browser this script started)
// ---------------------------------------------------------------------------------------------------

let chromeChild = null;
process.on('exit', () => {
  if (chromeChild) {
    try {
      spawnSync('taskkill', ['/PID', String(chromeChild.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // already gone
    }
  }
});

const freePort = () =>
  new Promise((done, fail) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });

async function launchChrome() {
  const chrome = CHROME_PATHS.find((path) => existsSync(path));
  assert(chrome, 'Chrome not found (looked in Program Files and LOCALAPPDATA)');
  const profile = join(tmpdir(), `opensa-export-hud-${Date.now()}`); // fresh throwaway profile, never reused
  const port = await freePort();
  chromeChild = spawn(
    chrome,
    [
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,800',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(500);
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {
      // Chrome is not listening yet
    }
  }
  throw new Error('could not connect to Chrome over CDP');
}

// ---------------------------------------------------------------------------------------------------
// The in-page contract assertions
// ---------------------------------------------------------------------------------------------------

async function main() {
  mkdirSync(EVIDENCE, { recursive: true });
  const bundleText = await bundleHarness();
  console.log(
    `bundle: ${bundleText.length} bytes of app code (analysis-hud-canvas + DOM HUD oracle + analysis-metrics)`,
  );

  const browser = await launchChrome();
  const context = browser.contexts()[0];
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(`[pageerror] ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      pageErrors.push(`[console.error] ${message.text()}`);
    }
  });
  await page.goto('about:blank');
  await page.addScriptTag({ content: bundleText });
  const harnessReady = await page.evaluate(() => typeof globalThis.__exportHudHarness === 'object');
  assert(harnessReady, 'the esbuild harness did not load in the page');

  try {
    await page.evaluate((id) => {
      globalThis.__exportHudDropMetric = id;
    }, dropMetric);
    const summary = await page.evaluate(runContractCheck);
    console.log(
      `(a) backing ${summary.backing.width}x${summary.backing.height}, colorSpace=${summary.contextAttributes.colorSpace}, alpha=${summary.contextAttributes.alpha}`,
    );
    console.log(
      `(b) value parity: 9/9 gauges match the DOM HUD and analysis-metrics at s=${summary.time}; repeatDiff=${summary.determinism.repeatDiff}, otherDiff=${summary.determinism.otherDiff}`,
    );
    console.log(
      `(c) composite: changedPixels=${summary.composite.changedPixels} (${summary.composite.changedBytes} bytes) bbox=${summary.composite.minX},${summary.composite.minY}..${summary.composite.maxX},${summary.composite.maxY} bounds=${JSON.stringify(summary.bounds)}; outsideChanged=${summary.composite.outsideChanged}; bytesOutsideBounds all identical=${summary.composite.bytesOutsideBounds}`,
    );
    console.log(
      `    blend samples=${summary.composite.blendSamples}, mismatches=${summary.composite.blendMismatch}, alphaBroken=${summary.composite.alphaBroken}`,
    );
    console.log(
      `    stale resize: smallDiff=${summary.stale.resizedSmallDiff}, restoredDiff=${summary.stale.restoredDiff}`,
    );
    console.log(
      `    malformed: altitude value='${summary.malformed.altitude.value}' (diff ${summary.malformed.altitude.droppedDiff} bytes)` +
        (summary.malformed.focused
          ? `, focused ${summary.malformed.focused.id} value='${summary.malformed.focused.value}'`
          : ''),
    );

    // Node-side re-assertion of the summary (a page-side silent failure cannot report PASS).
    assert(summary.backing.width === 1920 && summary.backing.height === 1080, 'summary backing size is not 1920x1080');
    assert(
      summary.gauges.length === 9 && summary.gauges.every((row) => row.id && row.label),
      'summary does not carry 9 gauges',
    );
    assert(
      summary.composite.changedPixels > 0 && summary.composite.outsideChanged === 0,
      'summary reports HUD pixels outside bounds',
    );
    assert(summary.composite.blendMismatch === 0, 'summary reports blend mismatches');
    assert(
      summary.determinism.repeatDiff === 0 && summary.determinism.otherDiff > 0,
      'summary reports broken determinism',
    );
    assert(summary.malformed.altitude.value === '—', 'altitude em-dash not observed');

    // (d) DPR-2 simulated run over CDP: identical bytes, identical backing size.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      deviceScaleFactor: 2,
      height: 600,
      mobile: false,
      width: 800,
    });
    const dpr = await page.evaluate(runDprCheck, 2);
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    console.log(
      `(d) DPR-2: devicePixelRatio=${dpr.dpr}, backing ${dpr.width}x${dpr.height}, differingBytes vs DPR-1=${dpr.differingBytes}`,
    );
    assert(dpr.dpr === 2, 'DPR-2 simulation did not apply');
    assert(dpr.width === 1920 && dpr.height === 1080, 'DPR-2 changed the backing size');
    assert(dpr.differingBytes === 0, `DPR-2 render differs from DPR-1 by ${dpr.differingBytes} bytes`);

    assert(pageErrors.length === 0, `page reported errors:\n${pageErrors.join('\n')}`);

    // Evidence: the composited HUD frame + the assertion/byte counts.
    const imageDataUrl = summary.imageDataUrl;
    assert(imageDataUrl.startsWith('data:image/png;base64,'), 'frame did not encode as PNG');
    writeFileSync(EVIDENCE_PNG, Buffer.from(imageDataUrl.slice('data:image/png;base64,'.length), 'base64'));
    const changedFiles = spawnSync('git', ['status', '--porcelain'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).stdout.trim();
    const lines = [
      'task 22 - canvas HUD mirror for export (resolution + compositing contract)',
      `date: ${new Date().toISOString()}`,
      `command: node scripts/test-export-hud.mjs${dropMetric ? ` --drop-metric ${dropMetric}` : ''}`,
      `node: ${process.version}`,
      '',
      '(a) backing size == encoded frame size',
      `  canvas backing: ${summary.backing.width}x${summary.backing.height} (contract 1920x1080)`,
      `  context attributes: colorSpace=${summary.contextAttributes.colorSpace} alpha=${summary.contextAttributes.alpha}`,
      `  panel bounds: ${JSON.stringify(summary.bounds)}`,
      '',
      `(b) value parity with analysis-metrics at s=${summary.time}`,
      ...summary.gauges.map((row) => `  ${row.id}: ${row.label} | ${row.value} | ${row.sub}`),
      '  DOM HUD vs canvas mirror: identical strings for all 9 gauges',
      `  repeat same sample: differingBytes=${summary.determinism.repeatDiff}`,
      `  different sample: differingBytes=${summary.determinism.otherDiff}`,
      '',
      '(c) composited frame (HUD over deterministic background)',
      `  total frame bytes: ${summary.composite.totalBytes}`,
      `  changed pixels: ${summary.composite.changedPixels} (${summary.composite.changedBytes} bytes)`,
      `  changed bbox: ${summary.composite.minX},${summary.composite.minY}..${summary.composite.maxX},${summary.composite.maxY} (inside declared bounds)`,
      `  changed pixels outside declared bounds: ${summary.composite.outsideChanged}`,
      `  non-HUD bytes compared outside bounds: ${summary.composite.bytesOutsideBounds} - all identical to the no-HUD render`,
      `  premultiplied source-over blend: samples=${summary.composite.blendSamples} mismatches=${summary.composite.blendMismatch} (>1 tolerance)`,
      `  composited alpha preserved (255): broken=${summary.composite.alphaBroken}`,
      '',
      '(d) simulated DPR-2 run (CDP Emulation.setDeviceMetricsOverride deviceScaleFactor=2)',
      `  devicePixelRatio=${dpr.dpr}, backing ${dpr.width}x${dpr.height}`,
      `  differingBytes vs DPR-1: ${dpr.differingBytes}`,
      `  identical bounds: ${JSON.stringify(dpr.bounds) === JSON.stringify(summary.bounds)}`,
      '',
      'adversarial',
      `  stale state: after setFrameSize(1280,720) redraw diff vs fresh render=${summary.stale.resizedSmallDiff}; after setFrameSize(1920,1080) diff vs original=${summary.stale.restoredDiff}`,
      `  malformed input: altitude missing -> value='${summary.malformed.altitude.value}' (canvas diff ${summary.malformed.altitude.droppedDiff} bytes; NaN identical=${summary.malformed.altitude.nanDiff === 0}; backing unchanged)`,
      summary.malformed.focused
        ? `  --drop-metric ${summary.malformed.focused.id} -> value='${summary.malformed.focused.value}' (canvas diff ${summary.malformed.focused.droppedDiff} bytes; NaN identical=${summary.malformed.focused.nanDiff === 0})`
        : '  --drop-metric: not requested (altitude em-dash still asserted)',
      `  page errors: ${pageErrors.length}`,
      '',
      'changed files in this worktree at run time (git status --porcelain):',
      ...changedFiles.split(/\r?\n/).map((line) => `  ${line}`),
      '',
      'PASS',
    ];
    writeFileSync(EVIDENCE_TXT, `${lines.join('\n')}\n`);
    console.log(`evidence: ${EVIDENCE_PNG}`);
    console.log(`evidence: ${EVIDENCE_TXT}`);
  } finally {
    await browser.close().catch(() => {});
    if (chromeChild) {
      spawnSync('taskkill', ['/PID', String(chromeChild.pid), '/T', '/F'], { stdio: 'ignore' });
      chromeChild = null;
    }
  }
}

/**
 * All DPR-1 assertions run here. Returns a machine-readable summary; every assertion throws on failure, so
 * a green return means each named check actually held. The Node side re-asserts the summary fields so a
 * silently-failed check cannot report PASS.
 */
function runContractCheck() {
  const H = globalThis.__exportHudHarness;
  const assertPage = (condition, message) => {
    if (!condition) {
      throw new Error(message);
    }
  };
  const readPixels = (canvas) => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  const byteDiff = (a, b) => {
    if (a.length !== b.length) {
      return -1;
    }
    let differing = 0;
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) {
        differing += 1;
      }
    }

    return differing;
  };

  // A synthetic track, so this test needs no game recording: `analyzeTrack`/`sampleAnalysis` are the same
  // headless path the replay feeds the DOM HUD and the export feeds this mirror.
  const rows = [];
  for (let index = 0; index < 5; index += 1) {
    const s = index * 0.5;
    const heading = 20 + index * 30;
    const half = (heading * Math.PI) / 180 / 2;
    rows.push({
      brake: 0,
      colors: [0, 0, 0, 0],
      forward: [Math.sin(half), Math.cos(half), 0],
      gameHour: 12,
      gameMinute: 0,
      gameSecond: 0,
      gear: 1,
      heading,
      health: 1000 - index * 40,
      keyA: 0,
      keyD: 0,
      keyDown: 0,
      keyE: 0,
      keyQ: 0,
      keyUp: 0,
      model: 520,
      nodes: [null, null, null, null, null, null, null, null, null],
      nodeStatus: 0,
      nozzleRotation: 0,
      nozzleRotationPrevious: 0,
      orientation: [0, 0, Math.sin(half), Math.cos(half)],
      pos: [index * 8 + index * index, index * 14, 150 + index * 7],
      propNodes: [null, null, null, null],
      right: [Math.cos(half), -Math.sin(half), 0],
      s,
      smokeActive: false,
      steer: 0,
      throttle: 0.25 + index * 0.12,
      timeMs: s * 1000,
      up: [0, 0, 1],
      velocity: [0, 0, 0],
      weatherForced: 0,
      weatherNew: 0,
      weatherOld: 0,
    });
  }
  const track = {
    axesNote: '',
    duration: rows[rows.length - 1].s,
    endReason: 'unknown',
    events: [],
    hasRealNodes: false,
    model: 520,
    name: 'synthetic-parity.csv',
    rows,
    version: 9,
  };
  const analysis = H.analyzeTrack(track);
  const TIME = 1.234;
  const metrics = H.sampleAnalysis(analysis, TIME);
  assertPage(metrics !== null, 'sampleAnalysis returned null for the synthetic track');
  assertPage(
    Number.isFinite(metrics.groundSpeed) && Number.isFinite(metrics.gForce) && Number.isFinite(metrics.angularRate),
    'sampled metrics are not finite',
  );
  const context = { model: 520, playing: true, trackName: 'synthetic-parity.csv' };

  // (b) VALUE PARITY: same time, DOM HUD vs canvas mirror, then mirror vs raw headless values.
  const dom = new H.AnalysisHud();
  dom.update(metrics, context);
  const domRows = [...dom.element.querySelectorAll('.analysis-gauge')].map((gauge) => ({
    id: gauge.dataset.gauge,
    label: gauge.querySelector('.analysis-gauge__label').textContent,
    sub: gauge.querySelector('.analysis-gauge__sub').textContent,
    value: gauge.querySelector('.analysis-gauge__value').textContent,
  }));
  assertPage(domRows.length === 9, `DOM HUD has ${domRows.length} gauges, expected 9`);

  const hud = new H.AnalysisHudCanvas();
  hud.render(metrics, context);
  const canvasRows = hud.readGaugeTexts().map(({ id, label, sub, value }) => ({ id, label, sub, value }));
  assertPage(
    JSON.stringify(canvasRows) === JSON.stringify(domRows),
    `canvas mirror text differs from the DOM HUD:\ncanvas=${JSON.stringify(canvasRows)}\ndom=${JSON.stringify(domRows)}`,
  );

  const byId = new Map(canvasRows.map((row) => [row.id, row]));
  const expectValue = (id, value, sub) => {
    assertPage(byId.get(id).value === value, `${id}: canvas '${byId.get(id).value}' != metrics-derived '${value}'`);
    if (sub !== undefined) {
      assertPage(byId.get(id).sub === sub, `${id}: canvas sub '${byId.get(id).sub}' != metrics-derived '${sub}'`);
    }
  };
  expectValue('altitude', `${metrics.altitude.toFixed(1)} m`);
  expectValue('groundSpeed', `${metrics.groundSpeed.toFixed(1)} m/s`, `${(metrics.groundSpeed * 3.6).toFixed(0)} km/h`);
  expectValue('heading', `${metrics.heading.toFixed(0)}°`);
  expectValue('throttle', `${(metrics.throttle * 100).toFixed(0)}%`);
  expectValue('health', `${metrics.health.toFixed(0)}`, ' / 1000');
  expectValue('gForce', `${metrics.gForce.toFixed(2)} g`);
  expectValue('angularRate', `${metrics.angularRate.toFixed(1)} °/s`);
  expectValue('climbRate', `${metrics.climbRate >= 0 ? '+' : ''}${metrics.climbRate.toFixed(1)} m/s`);

  // (a) RESOLUTION CONTRACT: backing size and context attributes.
  assertPage(
    hud.width === H.EXPORT_HUD_FRAME_WIDTH && hud.height === H.EXPORT_HUD_FRAME_HEIGHT,
    `backing size ${hud.width}x${hud.height}, expected 1920x1080`,
  );
  assertPage(
    H.EXPORT_HUD_FRAME_WIDTH === 1920 && H.EXPORT_HUD_FRAME_HEIGHT === 1080,
    'frame constants are not the 1920x1080 contract',
  );
  const attrs = hud.contextAttributes();
  assertPage(attrs.colorSpace === 'srgb', `colorSpace '${attrs.colorSpace}', expected srgb`);
  assertPage(attrs.alpha === true, 'context alpha must be on (HUD is composited over the frame)');
  const bounds = hud.bounds;
  assertPage(
    bounds.x === H.EXPORT_HUD_BOUNDS.x &&
      bounds.y === H.EXPORT_HUD_BOUNDS.y &&
      bounds.width === H.EXPORT_HUD_BOUNDS.width &&
      bounds.height === H.EXPORT_HUD_BOUNDS.height,
    `bounds ${JSON.stringify(bounds)} differ from EXPORT_HUD_BOUNDS ${JSON.stringify(H.EXPORT_HUD_BOUNDS)}`,
  );
  assertPage(
    bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= hud.width && bounds.y + bounds.height <= hud.height,
    'panel bounds leave the frame',
  );

  // Determinism: a different sample must paint differently; the same sample must be byte-identical.
  const pixelsA = readPixels(hud.canvas);
  const otherMetrics = H.sampleAnalysis(analysis, 0.4);
  hud.render(otherMetrics, context);
  const otherDiff = byteDiff(pixelsA, readPixels(hud.canvas));
  assertPage(otherDiff > 0, 'two different samples rendered identical pixels');
  hud.render(metrics, context);
  const repeatDiff = byteDiff(pixelsA, readPixels(hud.canvas));
  assertPage(repeatDiff === 0, `the same sample rendered twice differs by ${repeatDiff} bytes`);

  // STALE STATE: setFrameSize must re-size AND redraw (byte-equal to a fresh render at that size), then
  // return to the contract size with the original bytes.
  hud.setFrameSize(1280, 720);
  assertPage(hud.width === 1280 && hud.height === 720, `resize produced ${hud.width}x${hud.height}`);
  const resizedSmall = readPixels(hud.canvas);
  const freshSmall = new H.AnalysisHudCanvas({ height: 720, width: 1280 });
  freshSmall.render(metrics, context);
  const resizedSmallDiff = byteDiff(resizedSmall, readPixels(freshSmall.canvas));
  assertPage(
    resizedSmallDiff === 0,
    `redraw after resize differs from a fresh 1280x720 render by ${resizedSmallDiff} bytes`,
  );
  hud.setFrameSize(1920, 1080);
  const restoredDiff = byteDiff(readPixels(hud.canvas), pixelsA);
  assertPage(restoredDiff === 0, `resize back to 1920x1080 differs from the original render by ${restoredDiff} bytes`);

  // (c) COMPOSITING: draw the HUD over a deterministic frame; assert every changed byte is inside the
  // declared bounds and every byte outside them is identical to the no-HUD frame.
  const WIDTH = 1920;
  const HEIGHT = 1080;
  const frame = document.createElement('canvas');
  frame.width = WIDTH;
  frame.height = HEIGHT;
  const frameCtx = frame.getContext('2d', { alpha: true, colorSpace: 'srgb' });
  const background = frameCtx.createImageData(WIDTH, HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const index = (y * WIDTH + x) * 4;
      background.data[index] = (x * 7 + y * 13) & 0xff;
      background.data[index + 1] = (x * 5 - y * 3) & 0xff;
      background.data[index + 2] = (x ^ y) & 0xff;
      background.data[index + 3] = 255;
    }
  }
  frameCtx.putImageData(background, 0, 0);
  const base = frameCtx.getImageData(0, 0, WIDTH, HEIGHT).data;
  hud.render(metrics, context);
  const hudPixels = readPixels(hud.canvas);
  hud.composite(frameCtx);
  const composed = frameCtx.getImageData(0, 0, WIDTH, HEIGHT).data;

  const withinBounds = (x, y) =>
    x >= bounds.x && y >= bounds.y && x < bounds.x + bounds.width && y < bounds.y + bounds.height;
  const insidePixels =
    (Math.floor(bounds.x + bounds.width) - Math.ceil(bounds.x)) *
    (Math.floor(bounds.y + bounds.height) - Math.ceil(bounds.y));
  const bytesOutsideBounds = (WIDTH * HEIGHT - insidePixels) * 4;
  let changedPixels = 0;
  let changedBytes = 0;
  let outsideChanged = 0;
  let alphaBroken = 0;
  let blendSamples = 0;
  let blendMismatch = 0;
  let minX = WIDTH;
  let minY = HEIGHT;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const index = (y * WIDTH + x) * 4;
      const different =
        composed[index] !== base[index] ||
        composed[index + 1] !== base[index + 1] ||
        composed[index + 2] !== base[index + 2] ||
        composed[index + 3] !== base[index + 3];
      if (!different) {
        continue;
      }
      changedPixels += 1;
      for (let channel = 0; channel < 4; channel += 1) {
        if (composed[index + channel] !== base[index + channel]) {
          changedBytes += 1;
        }
      }
      if (!withinBounds(x, y)) {
        outsideChanged += 1;
      }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (composed[index + 3] !== 255) {
        alphaBroken += 1;
      }
      // Premultiplied source-over: out = src * a + dst * (1 - a); canvas stores premultiplied internally.
      const alpha = hudPixels[index + 3] / 255;
      if (alpha > 0 && blendSamples < 20000) {
        blendSamples += 1;
        for (let channel = 0; channel < 3; channel += 1) {
          const expected = Math.round(hudPixels[index + channel] * alpha + base[index + channel] * (1 - alpha));
          if (Math.abs(expected - composed[index + channel]) > 1) {
            blendMismatch += 1;
          }
        }
      }
    }
  }
  assertPage(changedPixels > 2000, `the HUD painted only ${changedPixels} pixels`);
  assertPage(outsideChanged === 0, `${outsideChanged} changed pixels are outside the declared HUD bounds`);
  assertPage(
    minX >= bounds.x && minY >= bounds.y && maxX < bounds.x + bounds.width && maxY < bounds.y + bounds.height,
    `changed-pixel bbox ${minX},${minY}..${maxX},${maxY} exceeds bounds ${JSON.stringify(bounds)}`,
  );
  assertPage(alphaBroken === 0, `${alphaBroken} composited pixels lost opacity`);
  assertPage(blendMismatch === 0, `source-over blend mismatch on ${blendMismatch} of ${blendSamples} sampled pixels`);

  // MALFORMED INPUT: a dropped or NaN metric renders an em-dash and never crashes. `--drop-metric` names
  // the gauge the QA scenario focuses on; altitude is always checked.
  const checkMissing = (id) => {
    const dropped = { ...metrics };
    delete dropped[id];
    const droppedRows = H.gaugeTexts(dropped);
    const droppedRow = droppedRows.find((row) => row.id === id);
    assertPage(droppedRow.value === '—', `missing ${id}: expected em-dash, got '${droppedRow.value}'`);
    hud.render(dropped, context);
    assertPage(hud.width === 1920 && hud.height === 1080, `missing ${id} changed the backing size`);
    const droppedPixels = readPixels(hud.canvas);
    const droppedDiff = byteDiff(droppedPixels, pixelsA);
    assertPage(droppedDiff > 0, `missing ${id} did not change the HUD`);
    const nan = { ...metrics, [id]: Number.NaN };
    assertPage(H.gaugeTexts(nan).find((row) => row.id === id).value === '—', `NaN ${id} must render an em-dash too`);
    hud.render(nan, context);
    const nanDiff = byteDiff(readPixels(hud.canvas), droppedPixels);
    assertPage(nanDiff === 0, `NaN ${id} drew differently from the missing ${id}`);

    return { droppedDiff, id, nanDiff, value: droppedRow.value };
  };
  const altitudeMissing = checkMissing('altitude');
  const focusedMissing = globalThis.__exportHudDropMetric ? checkMissing(globalThis.__exportHudDropMetric) : null;
  hud.render(metrics, context);
  assertPage(
    byteDiff(readPixels(hud.canvas), pixelsA) === 0,
    'the HUD did not recover after the missing-metric renders',
  );

  // Hand-off for the DPR-2 run (same page, after the CDP emulation override).
  globalThis.__exportHudTestState = { assert: assertPage, context, metrics, pixelsA };

  return {
    backing: { height: hud.height, width: hud.width },
    bounds,
    composite: {
      alphaBroken,
      blendMismatch,
      blendSamples,
      bytesOutsideBounds,
      changedBytes,
      changedPixels,
      maxX,
      maxY,
      minX,
      minY,
      outsideChanged,
      totalBytes: WIDTH * HEIGHT * 4,
    },
    contextAttributes: { alpha: attrs.alpha, colorSpace: attrs.colorSpace },
    determinism: { otherDiff, repeatDiff },
    gauges: canvasRows,
    imageDataUrl: frame.toDataURL('image/png'),
    malformed: { altitude: altitudeMissing, focused: focusedMissing },
    stale: { resizedSmallDiff, restoredDiff },
    time: TIME,
  };
}

// ---------------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------------

/** DPR-2 run: the same sample must render identical bytes and keep the 1920x1080 backing store. */
function runDprCheck(dpr) {
  const state = globalThis.__exportHudTestState;
  const assertPage = state.assert;
  assertPage(window.devicePixelRatio === dpr, `DPR simulation expected ${dpr}, got ${window.devicePixelRatio}`);
  const hud = new globalThis.__exportHudHarness.AnalysisHudCanvas();
  hud.render(state.metrics, state.context);
  assertPage(
    hud.width === 1920 && hud.height === 1080,
    `DPR-${dpr} backing ${hud.width}x${hud.height}, expected 1920x1080`,
  );
  const pixels = hud.canvas.getContext('2d').getImageData(0, 0, 1920, 1080).data;
  let differingBytes = 0;
  for (let index = 0; index < pixels.length; index += 1) {
    if (pixels[index] !== state.pixelsA[index]) {
      differingBytes += 1;
    }
  }
  assertPage(differingBytes === 0, `DPR-${dpr} render differs from DPR-1 by ${differingBytes} bytes`);

  return { bounds: hud.bounds, differingBytes, dpr: window.devicePixelRatio, height: hud.height, width: hud.width };
}

main().then(
  () => {
    console.log('PASS: export HUD canvas contract verified');
    process.exitCode = 0;
  },
  (error) => {
    console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
