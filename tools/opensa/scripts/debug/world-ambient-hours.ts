/**
 * What the world ambient term is at every hour, and how much of it is OURS (plan 093's night control pass).
 *
 * 093 ships `ambientColor = max(lin(timecyc Amb) × ambient, ambientFloor × (1 − dn))`. The deliberate floor
 * is day-shaped and retires at night by construction, but "by construction" is a claim about arithmetic that
 * nobody had read back out. This prints the two terms side by side per hour so the claim is checkable
 * without booting anything, and so a night look-round knows what it is looking at.
 *
 * Read the FLOOR column: where it is 0 the frame is strict SA parity and anything dark on screen is
 * authored. Where it is not, the deviation is ours and the night verdict has to account for it.
 *
 * Usage: npx tsx scripts/debug/world-ambient-hours.ts [--floor 0.13]
 */
import type { Environment } from '@opensa/engine';

import {
  createEngineEnvironmentDriver,
  DEFAULT_ENGINE_ENV_CONFIG,
} from '@opensa/game/adapters/engine-environment-driver';

const floorArg = process.argv.indexOf('--floor');
const floor = floorArg > 0 ? Number(process.argv[floorArg + 1]) : 0.13;

const config = structuredClone(DEFAULT_ENGINE_ENV_CONFIG);
config.graphics.worldLight.ambientFloor = floor;

const environment = { ambientColor: [0, 0, 0], dn: 0, sunIndirect: 0 } as unknown as Environment;
const driver = createEngineEnvironmentDriver(environment, { config });

console.log(`ambientFloor = ${floor}\n`);
console.log('hour   dn     ambient R,G,B                 floor term   floor WINS?');
for (let hour = 0; hour < 24; hour += 1) {
  driver.apply(hour);
  const term = floor * (1 - environment.dn);
  const rgb = environment.ambientColor.map((c) => c.toFixed(4)).join(', ');
  const wins = environment.ambientColor.every((c) => Math.abs(c - term) < 1e-9);

  console.log(
    `${String(hour).padStart(2, '0')}:00  ${environment.dn.toFixed(3)}  ${rgb.padEnd(26)}  ${term.toFixed(4)}` +
      `       ${wins && term > 0 ? 'YES — ours' : 'no  — timecyc'}`,
  );
}
