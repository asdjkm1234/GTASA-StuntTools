/**
 * Headless smoke test for the flight-replay page. Boots it in Chromium (WebGPU via SwiftShader when the
 * machine has no GPU), waits for the world to load, then reports boot errors, the status line and a
 * screenshot. Run the local server first (PORT=4199), then:
 *
 *   node scripts/smoke-flight.mjs http://127.0.0.1:4199/opensa/flight-replay.html?local=latest
 */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:4199/opensa/flight-replay.html?local=latest';
const waitMs = Number(process.argv[3] ?? 45000);

const browser = await chromium.launch({
  channel: 'chromium',
  args: [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-angle=swiftshader',
    '--use-webgpu-adapter=swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgpu-developer-features',
    '--disable-gpu-sandbox',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (message) => logs.push(`[${message.type()}] ${message.text()}`));
page.on('pageerror', (error) => logs.push(`[pageerror] ${error.message}`));
page.on('requestfailed', (request) => logs.push(`[requestfailed] ${request.url()} ${request.failure()?.errorText}`));
page.on('response', (response) => {
  if (response.status() >= 400) {
    logs.push(`[http ${response.status()}] ${response.url()}`);
  }
});

await page.goto(url, { waitUntil: 'load' });
const hasGpu = await page.evaluate(() => 'gpu' in navigator);
console.log(`navigator.gpu = ${hasGpu}`);
await page.waitForTimeout(waitMs);

const status = await page.textContent('#status').catch(() => '(no status)');
const mode = await page.textContent('#mode').catch(() => '');
console.log(`status: ${status}`);
console.log(`mode: ${mode}`);
console.log('--- console ---');
console.log(logs.slice(-60).join('\n'));
await page.screenshot({ path: 'smoke-flight.png' });
await browser.close();
process.exit(logs.some((line) => line.startsWith('[pageerror]')) ? 1 : 0);
