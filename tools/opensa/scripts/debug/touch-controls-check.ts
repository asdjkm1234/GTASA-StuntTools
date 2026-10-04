/**
 * Do the on-screen controls actually reach the game? The check no unit test in this repo can make (plan 055).
 *
 * The overlay is React, the source is a plain class, and both have unit coverage — what has none is the WIRING
 * in `engine-canvas-host`: the source has to be in the combiner the systems read, AND its look/zoom have to be
 * drained into the host's camera input, because the camera here is host-owned and never reads an InputState.
 * Miss the first and nothing moves; miss the second and everything moves except the view. Both are silent.
 * That gap is how the whole overlay was lost for a release: the three-host that mounted it was deleted in the
 * engine migration (074/13) and nothing re-mounted it in the engine host.
 *
 * So this probe boots the REAL game in a touch-emulating context and drives the overlay by its own pixels,
 * reading the answers out of the dev perf HUD (`#engine-hud` — so run it against `npm run dev`, not a prod
 * build, where that readout does not exist).
 *
 *   npx tsx scripts/debug/touch-controls-check.ts <appUrl> [timeoutMs] [--shot <png>]
 *
 * Exit code 1 = a control does not reach the game.
 *
 * Example (dev on :5173, `npm run serve:static` on :3001). Spawn somewhere OPEN — the walk tests read the
 * direction the player actually travelled, and a wall in front of them is a failed check with a healthy cause:
 *   SRC=http://localhost:3001/build/original/opensa
 *   npx tsx scripts/debug/touch-controls-check.ts \
 *     "http://localhost:5173/?loader=http-dir&src=$SRC&hour=12&weather=0&spawn=342,-1803,4.8"
 */
import { angleDelta } from '@opensa/math';
import { chromium, type Page } from 'playwright';

const APP_URL = process.argv[2] ?? '';
const TIMEOUT_MS = Number(process.argv[3] ?? 240000);
const shotAt = process.argv.indexOf('--shot');
const SHOT = shotAt === -1 ? undefined : process.argv[shotAt + 1];

/** A landscape phone. `hasTouch` is what drives `navigator.maxTouchPoints`, which `isTouchDevice()` reads. */
const VIEWPORT = { height: 430, width: 932 };
/** How far a joystick knob is dragged from centre (px) — past the base radius, so it clamps to full deflection. */
const FULL_DEFLECTION = 90;
/** A forward push has to move the player at least this far (m) for the move stick to count as connected. */
const MIN_WALK = 3;
/**
 * A held look must turn the next walk by at least this much (deg). Deliberately far under the camera's real
 * rate (0.004 rad/px × 10 px/frame ≈ 140°/s): the turn is read AFTER the stick is released, and the moment the
 * player walks, auto-centering swings the camera back behind them — 1.2 s of full deflection measured 22°.
 * This is a connected/not-connected check, never a sensitivity measurement.
 */
const MIN_TURN = 10;
/** A held jump has to lift the player at least this high (m). */
const MIN_LIFT = 0.3;

/** The menu step the http-dir loader still goes through — the same click `bench-harness/drive.js` makes. */
async function enterGame(page: Page): Promise<void> {
  const runButton = page.getByText('RUN SAN ANDREAS', { exact: false });
  await runButton.first().waitFor({ state: 'visible', timeout: 30000 });
  await runButton.first().click();
  await page.waitForSelector('canvas', { timeout: TIMEOUT_MS });
  await page.waitForFunction(() => /GTA\s+-?\d/.test(document.getElementById('engine-hud')?.textContent ?? ''), null, {
    timeout: TIMEOUT_MS,
  });
  await page.waitForTimeout(8000); // streaming settles; the player lands instead of falling through the sample
}

/** Press a control's centre, drag by (dx, dy), hold, release. The joysticks and the buttons are all pointer-driven. */
async function hold(page: Page, selector: string, dx: number, dy: number, ms: number): Promise<void> {
  const box = await page.locator(selector).boundingBox();
  if (!box) {
    throw new Error(`no control on screen: ${selector}`);
  }
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  if (dx !== 0 || dy !== 0) {
    await page.mouse.move(cx + dx, cy + dy, { steps: 6 });
  }
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

/** GTA position off the dev perf HUD, or null while the world is still coming up. */
async function positionOf(page: Page): Promise<[number, number, number] | null> {
  const text = (await page.locator('#engine-hud').textContent()) ?? '';
  const match = /GTA\s+(-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)/.exec(text);

  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/**
 * Wait until the player is standing on something. Every measurement here needs it: a walk started in the air
 * drifts instead of travelling, and a jump pressed in the air does nothing at all — which is a FAILED run
 * with a perfectly healthy cause, since walking a ped forward on a beach can put them over an edge.
 */
async function waitGrounded(page: Page, ms = 6000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const text = (await page.locator('#engine-hud').textContent()) ?? '';
    if (/grounded 1/.test(text)) {
      return true;
    }
    await page.waitForTimeout(200);
  }

  return false;
}

/** Walk forward for a second and report where that took the player (planar) — the direction IS the answer. */
async function walkForward(page: Page): Promise<{ distance: number; heading: number }> {
  await waitGrounded(page);
  const from = await positionOf(page);
  await hold(page, '.sa-touch__move', 0, -FULL_DEFLECTION, 1200);
  await page.waitForTimeout(300); // let the ped come to rest, so the sample is travel and not momentum
  const to = await positionOf(page);
  if (!from || !to) {
    throw new Error('no position on the HUD — is this a dev build?');
  }
  const [dx, dy] = [to[0] - from[0], to[1] - from[1]];

  return { distance: Math.hypot(dx, dy), heading: Math.atan2(dy, dx) };
}

void (async (): Promise<void> => {
  if (!APP_URL) {
    throw new Error('usage: touch-controls-check.ts <appUrl> [timeoutMs] [--shot <png>]');
  }
  const browser = await chromium.launch({
    args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--use-angle=metal'],
    headless: true,
  });
  const page = await browser.newPage({ deviceScaleFactor: 2, hasTouch: true, viewport: VIEWPORT });
  page.on('pageerror', (error) => console.log(`pageerror ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      console.log(`console[error] ${message.text()}`);
    }
  });
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await enterGame(page);

  const failures: string[] = [];
  const mounted = {
    capture: await page.locator('.sa-capture').count(), // must be 0: a touch device has no pointer to capture
    jump: await page.getByRole('button', { name: 'Jump' }).count(),
    look: await page.locator('.sa-touch__look').count(),
    move: await page.locator('.sa-touch__move').count(),
  };
  console.log(`mounted ${JSON.stringify(mounted)}`);
  if (mounted.move !== 1 || mounted.look !== 1 || mounted.jump !== 1) {
    failures.push('the overlay did not mount on a touch device');
  }
  if (mounted.capture !== 0) {
    failures.push('the "Click to play" prompt is up on a touch device');
  }

  if (failures.length === 0) {
    const first = await walkForward(page);
    console.log(`move  ${first.distance.toFixed(1)} m, heading ${((first.heading * 180) / Math.PI).toFixed(0)}°`);
    if (first.distance < MIN_WALK) {
      failures.push(`the move stick walked ${first.distance.toFixed(1)} m (< ${MIN_WALK})`);
    }

    // Look is measured through walking, not pixels: the ped moves camera-relative, so a turned camera is a
    // turned walk. Two screenshots would differ whatever happened — the HUD reprints every frame.
    await hold(page, '.sa-touch__look', FULL_DEFLECTION, 0, 1200);
    const second = await walkForward(page);
    const turn = (Math.abs(angleDelta(first.heading, second.heading)) * 180) / Math.PI;
    console.log(`look  walk turned ${turn.toFixed(0)}°, then ${second.distance.toFixed(1)} m`);
    if (second.distance < MIN_WALK) {
      failures.push('the player stopped moving after the look (blocked? re-run somewhere open)');
    } else if (turn < MIN_TURN) {
      failures.push(`the look stick turned the walk by ${turn.toFixed(0)}° (< ${MIN_TURN})`);
    }

    const standing = await waitGrounded(page);
    const before = await positionOf(page);
    const jump = page.getByRole('button', { name: 'Jump' });
    const box = await jump.boundingBox();
    if (!box) {
      throw new Error('no Jump button on screen');
    }
    if (!standing) {
      failures.push('the player never came to rest on the ground — the jump could not be measured');
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    let peak = before?.[2] ?? 0;
    for (let sample = 0; sample < 10; sample += 1) {
      await page.waitForTimeout(60);
      peak = Math.max(peak, (await positionOf(page))?.[2] ?? peak);
    }
    await page.mouse.up();
    const lift = peak - (before?.[2] ?? 0);
    console.log(`jump  lifted ${lift.toFixed(2)} m`);
    if (lift < MIN_LIFT) {
      failures.push(`the Jump button lifted the player ${lift.toFixed(2)} m (< ${MIN_LIFT})`);
    }
  }

  if (SHOT) {
    await page.screenshot({ path: SHOT });
    console.log(`shot ${SHOT}`);
  }
  await browser.close();

  console.log(
    failures.length === 0 ? 'OK: every on-screen control reaches the game' : `FAILED: ${failures.join(' · ')}`,
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
})();
