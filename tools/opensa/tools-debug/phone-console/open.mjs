/**
 * Open one of the panel's links in the phone's browser — the last tap in the measurement loop (plan 002).
 *
 * Everything else an agent needs is a tool call already: convert, serve, read the map, drive it, file the
 * capture, commit. The one step that still needed a person was the first one — a human tapping **THE FIELD
 * RUN** so a page exists to attach to. On a device that sleeps between messages that tap is not a small
 * thing: it is the difference between "the agent takes the measurement" and "the agent asks for it".
 *
 * It is a JOB rather than an MCP tool on purpose. `mcp.mjs` runs beside the tunnel and restarting it changes
 * the address every open session is holding; the job table is read by the panel, which restarts for free.
 * The tool surface does not have to grow for the phone to learn something new.
 *
 *   LINK=field DISTRICT=los-santos-centre node tools-debug/phone-console/open.mjs
 *
 * Refuses rather than opening something that cannot answer: an unknown link name, a port nothing is serving
 * (the console would load and 404 on the pak), and a phone with no `termux-open-url` — which is a missing
 * package with a name, not a mystery.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { consoleUrls, LINK_NAMES, portsFor } from './app/links.mjs';

const run = promisify(execFile);
const PANEL = process.env.PANEL_URL ?? `http://127.0.0.1:${Number(process.env.PANEL_PORT) || 8787}`;

/** Hand the URL to Android. `termux-open-url` is the Termux:API bridge, and its absence is a package name. */
async function openOnPhone(url) {
  try {
    await run('termux-open-url', [url]);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(
        'termux-open-url is not installed — `pkg install termux-api`, and the Termux:API app from ' +
          'F-Droid (the package alone does nothing without it). Until then the link above is a tap.',
        { cause: error },
      );
    }
    throw error;
  }
}

/** The panel's own state, which is where the ports, the served app and the district list already live. */
async function panelState() {
  let response;
  try {
    response = await fetch(`${PANEL}/api/state`);
  } catch (error) {
    throw new Error(`the panel is not answering at ${PANEL} — start it with \`npm run panel\``, { cause: error });
  }
  if (!response.ok) {
    throw new Error(`the panel answered ${response.status} — it is the one that knows the ports`);
  }

  return response.json();
}

const link = (process.env.LINK ?? 'field').trim();
if (!LINK_NAMES.includes(link)) {
  console.error(`unknown link '${link}' — one of: ${LINK_NAMES.join(', ')}`);
  process.exit(2);
}

try {
  const state = await panelState();
  const district = process.env.DISTRICT ?? state.districts?.[0] ?? '';
  const url = consoleUrls({ district, out: process.env.OUT, ports: state.ports, webapp: state.webapp })[link];

  // Which ports are UP is something the panel already measured for its own preflight; asking it again here
  // would be a second opinion on the same question.
  const serving = new Set((state.checks ?? []).filter((check) => check.serving === true).map((check) => check.id));
  const missing = portsFor(state).filter((port) => !serving.has(`port-${port}`));

  console.log(`opening ${link}: ${url}`);
  if (missing.length > 0) {
    throw new Error(`nothing is serving on ${missing.join(' and ')} — run the \`phone\` job first, then open this`);
  }
  await openOnPhone(url);
  console.log('opened — the page attaches itself once it boots (map_state says when).');
} catch (error) {
  // A message, never a stack: this runs as a panel job and what it prints is read on a phone screen.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
