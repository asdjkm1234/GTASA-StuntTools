// Headless WARNING CATCHER: boots the game exactly like drive.js (same load path, quota override,
// disclaimer click), then just LIVES in the world for a while and collects every console warning/error,
// pageerror and WebGPU validation message — deduped with counts — into <out>.json + a screenshot.
// This is the fix-verify loop's tool: point it at a reported spot (?spawn=x,y,z&spawncar=...&cleo=1),
// optionally walk/press keys, and read the JSON instead of a human reading DevTools.
// Usage: NODE_PATH=$REPO/node_modules node warnings.js <appUrl> <outPrefix> <durationMs>
// Env: DPR=1 · DRAG=<dy> (pitch camera) · KEYS='KeyW:4000;Enter:600' (sequential holds, ms each)
//   TAGS='[spawncar],[cleo]' also records INFO lines carrying these substrings (the subsystem
//   diagnostics that are console.log, not warnings — a spawn that failed says so at info level).
//   FAIL_ON='error' exits 1 when any error was seen (CI gate); default always exits 0 (a report tool).
const { writeFileSync } = require('fs');
const { chromium } = require('playwright');

const APP_URL = process.argv[2];
const OUT = process.argv[3] ?? 'warnings';
const DURATION_MS = Number(process.argv[4] ?? 30000);
const MAX_DISTINCT = 500;
const TAGS = (process.env.TAGS ?? '[spawncar],[cleo],[stream],[osmspike]').split(',').filter(Boolean);

let page = null;

(async () => {
  const browser = await chromium.launch({
    args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--use-angle=metal'],
    headless: true,
  });
  const dpr = Number(process.env.DPR ?? 1);
  page = await browser.newPage({ deviceScaleFactor: dpr, viewport: { height: 900, width: 1440 } });

  /** text → { count, kind, firstAtMs } — identical lines collapse, the count says how hot they are. */
  const seen = new Map();
  const startedAt = Date.now();
  const record = (kind, text) => {
    const entry = seen.get(text);
    if (entry) {
      entry.count += 1;
      return;
    }
    if (seen.size >= MAX_DISTINCT) return; // the cap is reported in the verdict, never silent
    seen.set(text, { count: 1, firstAtMs: Date.now() - startedAt, kind });
    console.log(`${kind} ${text}`);
  };
  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') {
      record(type, msg.text());
    } else if (TAGS.some((tag) => msg.text().includes(tag))) {
      record('info', msg.text());
    }
  });
  page.on('pageerror', (err) => record('pageerror', err.message));

  console.log(`goto ${APP_URL}`);
  const origin = new URL(APP_URL).origin;
  const cdp = await page.context().newCDPSession(page);
  await cdp
    .send('Storage.overrideQuotaForOrigin', { origin, quotaSize: 8 * 1024 ** 3 })
    .catch((err) => console.log(`quota override failed (continuing): ${err.message}`));
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  const runButton = page.getByText('RUN SAN ANDREAS', { exact: false });
  await runButton
    .first()
    .waitFor({ state: 'visible', timeout: 30000 })
    .catch(() => console.log('run button never appeared'));
  if (await runButton.count()) {
    await runButton.first().click();
  }
  const okButton = page.getByText('OK', { exact: true });
  await okButton
    .first()
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(async () => {
      await okButton.first().click();
      console.log('disclaimer accepted');
    })
    .catch(() => {}); // no disclaimer (http-dir) — nothing to click
  console.log('game selected, waiting for canvas...');
  await page.waitForSelector('canvas', { timeout: 240000 });
  // The "Click to play" capture overlay eats every pointer event and pointer lock is moot headless —
  // remove it; key events reach the host's window listeners without it.
  await page.evaluate(() => document.querySelector('.sa-capture')?.remove());
  console.log(`canvas up, collecting for ${DURATION_MS} ms...`);

  const drag = Number(process.env.DRAG ?? 0);
  if (drag) {
    await page.mouse.move(720, 450);
    await page.mouse.down();
    await page.mouse.move(720, 450 + drag, { steps: 25 });
    await page.mouse.up();
    console.log(`dragged dy=${drag}`);
  }
  // KEYS='Wait:5000;KeyW:4000;Enter:600' — hold each in turn (walk somewhere, then hold Enter at a
  // door). 'Wait' holds nothing — use it to let a ?spawncar retry land before pressing keys at it.
  for (const spec of (process.env.KEYS ?? '').split(';').filter(Boolean)) {
    const [code, ms] = spec.split(':');
    if (code === 'Wait') {
      await page.waitForTimeout(Number(ms ?? 500));
      console.log(`waited ${ms} ms`);
      continue;
    }
    await page.keyboard.down(code);
    await page.waitForTimeout(Number(ms ?? 500));
    await page.keyboard.up(code);
    console.log(`held ${code} for ${ms} ms`);
  }

  const remaining = DURATION_MS - (Date.now() - startedAt);
  if (remaining > 0) await page.waitForTimeout(remaining);

  await page.screenshot({ path: `${OUT}.png` });
  const hud = await page
    .locator('#engine-hud')
    .textContent({ timeout: 2000 })
    .catch(() => null);
  const report = {
    capped: seen.size >= MAX_DISTINCT,
    distinct: seen.size,
    durationMs: Date.now() - startedAt,
    hud,
    url: APP_URL,
    warnings: [...seen.entries()].map(([text, entry]) => ({ text, ...entry })).sort((a, b) => b.count - a.count),
  };
  writeFileSync(`${OUT}.json`, JSON.stringify(report, null, 2));
  console.log(`report ${OUT}.json · screenshot ${OUT}.png`);
  console.log('--- top warnings ---');
  for (const entry of report.warnings.slice(0, 15)) {
    console.log(`${entry.count}× [${entry.kind}] ${entry.text.slice(0, 200)}`);
  }
  await browser.close();
  if (process.env.FAIL_ON === 'error' && report.warnings.some((w) => w.kind !== 'warning')) {
    process.exit(1);
  }
})().catch(async (err) => {
  console.error('warnings.js failed:', err);
  // A diagnosing tool must not die silently — leave the evidence it was built to collect.
  await page?.screenshot({ path: `${OUT}-failed.png` }).catch(() => {});
  process.exit(1);
});
