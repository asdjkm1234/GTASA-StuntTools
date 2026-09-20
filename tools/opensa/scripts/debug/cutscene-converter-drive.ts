import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { _electron } from 'playwright';

/**
 * Does the standalone app still work END TO END — the three pickers, the run, the status line, Exit?
 * The renderer has no test lane, so its defects have been reaching Windows: a run whose files landed on
 * disk while the window went black cost a whole field round (an effect returning a value React took for
 * its cleanup). This drives the built app the way a person does, with the folder dialogs stubbed.
 *
 *   npm run --workspace=@opensa/cutscene-converter build   # dist/ must be current
 *   npx tsx scripts/debug/cutscene-converter-drive.ts <game dir> <cars dir> <out dir> [shots dir]
 *
 * Prints each step's verdicts, the busy line, the finished line and the buttons; exit 1 on any failure.
 * `out` is written for real (~280 MB for two cars), so point it at a scratch folder.
 */
const [gameArg, carsArg, outArg, shotsArg] = process.argv.slice(2);

if (!gameArg || !carsArg || !outArg) {
  throw new Error('usage: cutscene-converter-drive.ts <game dir> <cars dir> <out dir> [shots dir]');
}

const APP_DIR = resolve(import.meta.dirname, '../../apps/cutscene-converter');
const picks = [resolve(gameArg), resolve(carsArg), resolve(outArg)];
const shots = shotsArg ? resolve(shotsArg) : undefined;

if (shots) {
  mkdirSync(shots, { recursive: true });
}

async function main(): Promise<void> {
  const app = await _electron.launch({ args: [APP_DIR], cwd: APP_DIR });

  // The pickers are native dialogs; stubbing them in the MAIN process is the only way to drive the wizard.
  await app.evaluate(({ dialog }, paths: string[]): void => {
    let index = 0;
    dialog.showOpenDialog = (): Promise<{ canceled: boolean; filePaths: string[] }> =>
      Promise.resolve({ canceled: false, filePaths: [paths[index++] ?? ''] });
  }, picks);

  const page = await app.firstWindow();
  page.on('pageerror', (error) => console.error(`[window error] ${error.stack ?? error.message}`));
  await page.waitForSelector('.cc-step');

  for (const step of [0, 1, 2]) {
    const section = page.locator('.cc-step').nth(step);
    await section.getByRole('button').click();
    // Wait on THIS section's own path line: a bare `.cc-verdict` matches the previous step's verdicts and
    // returns before this one has been judged, which reads as "Convert stayed disabled".
    await section.locator('.cc-step-path').waitFor({ timeout: 120_000 });
    console.log(`step ${step + 1}: ${(await section.locator('.cc-verdict-message').allInnerTexts()).join(' | ')}`);
  }

  const convert = page.getByRole('button', { name: /^Convert$/ });
  await convert.waitFor({ state: 'visible' });

  if (!(await convert.isEnabled({ timeout: 60_000 }))) {
    throw new Error('cutscene-converter-drive: Convert stayed disabled — read the verdicts above');
  }

  await convert.click();
  await page.waitForSelector('.cc-status-busy', { timeout: 10_000 });
  console.log(`busy: ${(await page.locator('.cc-status').innerText()).trim()}`);
  if (shots) {
    await page.screenshot({ path: `${shots}/busy.png` });
  }

  await page.waitForSelector('.cc-status-done, .cc-status-failed', { timeout: 600_000 });
  const status = (await page.locator('.cc-status').innerText()).trim();
  console.log(`finished: ${status}`);
  console.log(`buttons: ${(await page.getByRole('button').allInnerTexts()).join(', ')}`);
  console.log(`about: ${(await page.locator('.cc-about').innerText()).split('\n').join(' ').trim()}`);

  if (shots) {
    await page.screenshot({ path: `${shots}/done.png` });
  }

  const failed = (await page.locator('.cc-status-failed').count()) > 0;
  await app.close();

  if (failed) {
    process.exit(1);
  }

  console.log('cutscene-converter-drive: ok');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
