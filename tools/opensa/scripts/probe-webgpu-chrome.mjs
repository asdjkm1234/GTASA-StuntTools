/**
 * Launches the INSTALLED Chrome with a throwaway profile for each flag set, opens the WebGPU diagnostic
 * page, and prints the report the page POSTs back to the local server. This is how "the renderer cannot get
 * an adapter" is told apart from "this flag set fixes it" without asking anyone to read chrome://gpu.
 *
 * Requires the local server (with the /webgpu-report route) running on PORT (default 4199).
 *   node scripts/probe-webgpu-chrome.mjs [port]
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = Number(process.argv[2] ?? 4199);
const url = `http://127.0.0.1:${port}/opensa/webgpu-check.html`;
const reportPath = join(process.cwd(), '..', '..', 'web-replay', 'webgpu-report.json');
const chromeCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
];
const chrome = chromeCandidates.find((path) => existsSync(path));
if (!chrome) {
  throw new Error('Chrome not found');
}

const sets = [
  ['baseline', []],
  ['unsafe-webgpu', ['--enable-unsafe-webgpu']],
  ['ignore-blocklist', ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist']],
  ['no-sandbox', ['--enable-unsafe-webgpu', '--disable-gpu-sandbox']],
  ['bug-workarounds-off', ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--disable-gpu-driver-bug-workarounds']],
  ['swiftshader', ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--use-webgpu-adapter=swiftshader']],
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (const [name, flags] of sets) {
  rmSync(reportPath, { force: true });
  const profile = join(tmpdir(), `chrome-probe-${Date.now()}`);
  const child = spawn(chrome, [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', ...flags, url], {
    detached: false,
    stdio: 'ignore',
  });
  let report = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    await sleep(500);
    if (!existsSync(reportPath)) continue;
    try {
      report = JSON.parse(readFileSync(reportPath, 'utf8'));
      break;
    } catch { /* still being written */ }
  }
  const summary = report
    ? { gpu: report.navigatorGpu, attempts: (report.attempts ?? []).map((entry) => `${entry.name}=${entry.adapter ? 'OK' : entry.error ?? 'null'}`), success: report.success }
    : 'no report (page did not reach the server)';
  console.log(`${name.padEnd(22)} ${JSON.stringify(summary)}`);
  try { child.kill(); } catch { /* ignore */ }
  await sleep(1200);
}
