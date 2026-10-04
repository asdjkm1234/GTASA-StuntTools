/**
 * Probes the INSTALLED Chrome for a usable WebGPU adapter under several launch-flag sets, to tell
 * "Chrome cannot do WebGPU here at all" apart from "the wrong backend/blocklist".
 *
 *   node scripts/probe-webgpu.mjs
 */
import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = ['--enable-unsafe-webgpu'];
const CASES = [
  ['baseline', []],
  ['ignore-blocklist', ['--ignore-gpu-blocklist']],
  ['ignore-blocklist+driver-workarounds', ['--ignore-gpu-blocklist', '--disable-gpu-driver-bug-workarounds']],
  ['angle-d3d11', ['--ignore-gpu-blocklist', '--use-angle=d3d11']],
  ['angle-vulkan', ['--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan']],
  ['angle-gl', ['--ignore-gpu-blocklist', '--use-angle=gl']],
];

for (const [name, extra] of CASES) {
  let browser;
  try {
    browser = await chromium.launch({
      args: [...BASE, ...extra, '--no-first-run', '--no-default-browser-check'],
      channel: 'chrome',
      headless: false,
    });
    const page = await browser.newPage();
    const result = await page.evaluate(async () => {
      if (!navigator.gpu) return { gpu: false };
      const out = {};
      for (const options of [{}, { forceFallbackAdapter: true }]) {
        try {
          const adapter = await navigator.gpu.requestAdapter(options);
          out[options.forceFallbackAdapter ? 'fallback' : 'default'] = adapter
            ? `${adapter.info?.vendor ?? '?'} / ${adapter.info?.architecture ?? '?'} / ${adapter.info?.device ?? '?'}`
            : null;
        } catch (error) {
          out[options.forceFallbackAdapter ? 'fallback' : 'default'] = `throw: ${error.message}`;
        }
      }

      return out;
    });
    console.log(`${name.padEnd(38)} ${JSON.stringify(result)}`);
    await browser.close();
  } catch (error) {
    console.log(`${name.padEnd(38)} launch failed: ${error.message.split('\n')[0]}`);
    try { await browser?.close(); } catch { /* ignore */ }
  }
}
