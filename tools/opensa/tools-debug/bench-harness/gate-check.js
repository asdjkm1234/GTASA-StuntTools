// WebGPU boot-gate verification (plan 074/10): two modes over the REAL load path (http-dir loader, no fake
// picker).
//   canvas <url>  — boot to canvas, then report which context type the game canvas holds
//   sorry  <url>  — launch WITHOUT WebGPU and expect the sorry screen instead of the menu
// Usage: NODE_PATH=$REPO/node_modules node gate-check.js <mode> <appUrl> <outPrefix>
//   canvas mode's appUrl MUST carry ?loader=http-dir&src=<serve-static build URL>.
const { chromium } = require('playwright');

const MODE = process.argv[2];
const APP_URL = process.argv[3];
const OUT = process.argv[4] ?? 'gate';

(async () => {
  const args =
    MODE === 'sorry'
      ? ['--disable-features=WebGPU']
      : ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--use-angle=metal'];
  const browser = await chromium.launch({ args, headless: true });
  const page = await browser.newPage({ viewport: { height: 900, width: 1440 } });
  page.on('pageerror', (err) => console.log(`pageerror ${err.message}`));

  console.log(`mode=${MODE} goto ${APP_URL}`);
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });

  if (MODE === 'sorry') {
    const gpu = await page.evaluate(() => ({
      hasNavigatorGpu: 'gpu' in navigator && !!navigator.gpu,
    }));
    console.log(`navigator.gpu present: ${gpu.hasNavigatorGpu}`);
    try {
      await page.getByText('does not support', { exact: false }).waitFor({ timeout: 15000 });
      console.log('SORRY SCREEN: visible');
    } catch {
      console.log('SORRY SCREEN: NOT FOUND — dumping visible text');
      console.log(await page.evaluate(() => document.body.innerText.slice(0, 500)));
    }
    const menuVisible = await page.getByText('RUN SAN ANDREAS', { exact: false }).count();
    console.log(`menu visible: ${menuVisible > 0}`);
  } else {
    // http-dir loads straight from ?src — click the game and wait; no "Choose game folder" step.
    const runButton = page.getByText('RUN SAN ANDREAS', { exact: false });
    if (await runButton.count()) await runButton.first().click();
    console.log('game selected, waiting for canvas...');
    await page.waitForSelector('canvas', { timeout: 240000 });
    await page.waitForTimeout(15000); // let the world settle so the shot shows geometry
    // WebGPU is the only context the app can boot on since 074/13 phase 5 deleted the three path.
    const webgpu = await page.evaluate(() => {
      const canvas = document.querySelector('.sa-game canvas') ?? document.querySelector('canvas');
      try {
        return !!canvas.getContext('webgpu');
      } catch {
        return false;
      }
    });
    console.log(`canvas context: webgpu=${webgpu}`);
  }

  await page.screenshot({ path: `${OUT}.png` });
  console.log(`screenshot ${OUT}.png`);
  await browser.close();
})().catch((err) => {
  console.error('gate-check failed:', err);
  process.exit(1);
});
