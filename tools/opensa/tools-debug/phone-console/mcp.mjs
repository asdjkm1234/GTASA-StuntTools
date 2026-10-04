/**
 * The phone as a TOOL: MCP over the panel (plan 002 beside this file).
 *
 * The loop this replaces is the expensive one. An agent writes code in a container, the phone runs it, and
 * everything in between — did the convert start, what did preflight refuse, what did the capture say — is a
 * person reading a screen and typing it back. Every round trip costs a message and loses the detail nobody
 * thought to copy.
 *
 * So the panel's own capabilities become MCP tools. **It is a CLIENT of the running panel, never a second
 * copy of it**, and that is the load-bearing decision: `JobRunner` allows one job at a time, and two runners
 * on one phone is two converts fighting over the same folder. If the panel is not up, every tool here says
 * so instead of starting anything.
 *
 * **What it can do is exactly what the panel's buttons can do**, and that is deliberate. The jobs are an
 * allowlist (`jobs.mjs`), not a shell: `pull`, `setup`, the three converts, the share build, the tile bake's
 * link, the capture inbox and `commit & push`. An `exec` tool exists for the case the allowlist cannot cover
 * and is **off unless `PANEL_MCP_EXEC=1`** — a remote shell on somebody's phone is a thing they turn on
 * deliberately, never a default that arrives with an update.
 *
 * Two transports, one handler:
 *
 * - **stdio** (default) — for a Claude running ON the phone. Nothing is exposed to any network.
 * - **`--http [--port N]`** — JSON-RPC over POST, for a Claude that is somewhere else. It binds `127.0.0.1`
 *   like the panel, so reaching it from off-device is a tunnel the operator sets up on purpose, and it
 *   REQUIRES a bearer token (`PANEL_MCP_TOKEN`, or one generated and printed at startup). A tunnel plus no
 *   token is a shell on the open internet.
 *
 *   node tools-debug/phone-console/mcp.mjs            # stdio
 *   node tools-debug/phone-console/mcp.mjs --http     # POST http://127.0.0.1:8788/mcp
 *
 * The version negotiation, the discovery answer and the framing that survives a malformed byte live in
 * `mcp-protocol.mjs`, because the bridge needs the same answers and neither end owns them.
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { promisify } from 'node:util';

import {
  discoverResult,
  INSTRUCTIONS,
  negotiate,
  parseFailure,
  readLines,
  requestedVersion,
  respond,
  SERVER_INFO,
  SUPPORTED_VERSIONS,
  unsupportedVersion,
} from './mcp-protocol.mjs';

const run = promisify(execFile);

/** Where the panel is. Same default as the panel's own, so neither has to be configured in the usual case. */
const PANEL = process.env.PANEL_URL ?? `http://127.0.0.1:${Number(process.env.PANEL_PORT) || 8787}`;

/** What this server offers. Tools and nothing else — no resources, no prompts, no sampling. */
const CAPABILITIES = { tools: {} };

/** The largest POST body the HTTP transport will assemble, so a runaway request cannot eat the phone's RAM. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/**
 * The behaviour hints, named once. A client uses them to decide what to confirm with a person and what to
 * cache, and a model uses them to decide what is safe to try — so they are stated rather than defaulted:
 * an unannotated tool is assumed DESTRUCTIVE and open-world, which is wrong for nine of these twelve.
 */
const READS = { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: true };
const STEERS = { destructiveHint: false, idempotentHint: true, openWorldHint: false, readOnlyHint: false };
const BUILDS = { destructiveHint: true, idempotentHint: false, openWorldHint: false, readOnlyHint: false };

/** A tool that takes nothing. Stated as a closed schema, so a client rejects invented arguments here. */
const NO_ARGS = { additionalProperties: false, type: 'object' };

/**
 * The tools, and their whole surface. Every one of them is something the panel's page can already do — the
 * point is that an agent can do it without a person relaying the screen.
 */
export const TOOLS = [
  {
    annotations: READS,
    description:
      'What the phone is: preflight checks and their verdict, the pak on disk and what it was built from, ' +
      'the running job, the ports, and the captures waiting to be committed. Read this before anything else.',
    inputSchema: NO_ARGS,
    name: 'phone_state',
    title: 'The phone, and whether it is ready',
  },
  {
    annotations: READS,
    description:
      'The jobs this phone can run, with the knobs each accepts. An allowlist, not a shell: ' +
      'converts, the setup/pull rituals, the shareable build.',
    inputSchema: NO_ARGS,
    name: 'phone_jobs',
    title: 'What this phone may run',
  },
  {
    annotations: BUILDS,
    description:
      'Start one job. Refuses while another is running — a phone runs one convert at a time. ' +
      'Returns immediately, when the job STARTS rather than when it finishes: a convert is ten minutes to ' +
      'an hour on this device. Watch it with phone_log.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        env: {
          description: 'Knobs the job accepts (DISTRICT, OUT, TEXTURES, MODELS). Anything else is dropped and named.',
          type: 'object',
        },
        id: { description: 'Job id — see phone_jobs.', type: 'string' },
      },
      required: ['id'],
      type: 'object',
    },
    name: 'phone_run',
    title: 'Start a job',
  },
  {
    annotations: READS,
    description: 'The tail of the job log — what the running (or last) job printed. Survives the panel being killed.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        lines: { description: 'How many lines from the end (default 80).', minimum: 1, type: 'number' },
      },
      type: 'object',
    },
    name: 'phone_log',
    title: 'What the job is printing',
  },
  {
    annotations: { ...BUILDS, idempotentHint: true },
    description: 'Stop the running job.',
    inputSchema: NO_ARGS,
    name: 'phone_stop',
    title: 'Stop the running job',
  },
  {
    annotations: READS,
    description:
      'What the MAP page is doing right now: whether one is attached (opened with &agent=1), which mode it ' +
      'is drawing and what it last reported. Ask this before any other map_ tool.',
    inputSchema: NO_ARGS,
    name: 'map_state',
    title: 'Whether a map is attached',
  },
  {
    annotations: STEERS,
    description:
      'Open the console ON THE PHONE\'S SCREEN and wait until it reaches the panel. This is what clears "no ' +
      'map is attached" — every other map_ tool talks to a page that is already open. Answers when the ' +
      'page phones home, or says what it launched and why nothing arrived. A console already attached is ' +
      'left alone rather than covered with a second tab.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        district: { description: 'District the console starts on (see phone_state).', type: 'string' },
        out: { description: "Pak folder to read, default './build/phone'.", type: 'string' },
        view: {
          description:
            "Which of the panel's own links to open: the map itself, its inventory report, the declared " +
            'worst case (150 units), the flat 2D map, the tile bake, or the share build.',
          enum: ['map', 'inventory', 'field', 'flat', 'bake', 'share'],
          type: 'string',
        },
      },
      type: 'object',
    },
    name: 'map_open',
    title: 'Put the console on the screen',
  },
  {
    annotations: STEERS,
    description:
      'Say the run is over, to the PERSON holding the phone. Android freezes a tab that is not in front, so ' +
      'while these tools drive the console its owner has to leave the device alone — this is what tells ' +
      'them they can stop: the console shows it and the phone buzzes (Termux:API, when it is installed). ' +
      'Call it when the last measurement is taken, not when the conversation ends.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        note: {
          description: 'One line for the band and the notification — what was taken, or what is next.',
          type: 'string',
        },
      },
      type: 'object',
    },
    name: 'map_release',
    title: 'Give the phone back',
  },
  {
    annotations: READS,
    description:
      'Everything the map knows about itself in one answer: the ?inventory=1 report (fps p50/p95, draws, ' +
      'resident MB, per-pass spans, symbology counts, the time axis), the live readout, and the errors it ' +
      'has logged. This is the realtime benchmark, read without anybody copying it.',
    inputSchema: NO_ARGS,
    name: 'map_snapshot',
    title: 'The map’s own numbers',
  },
  {
    annotations: READS,
    description: 'A PNG of the map as it is on screen — the world and the symbology over it, composed by the page.',
    inputSchema: NO_ARGS,
    name: 'map_screenshot',
    title: 'A picture of the map',
  },
  {
    annotations: STEERS,
    description: 'Fly the map camera to a pose. The same flight a bookmark makes, so streaming follows it.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        at: {
          description: 'GTA ground point [x, y].',
          items: { type: 'number' },
          maxItems: 2,
          minItems: 2,
          type: 'array',
        },
        height: { description: 'Camera height in world units.', type: 'number' },
        pitch: { description: 'Radians; negative looks down.', type: 'number' },
        projection: { description: 'Which lens the camera uses.', enum: ['perspective', 'ortho'], type: 'string' },
        yaw: { description: 'Radians.', type: 'number' },
      },
      required: ['at'],
      type: 'object',
    },
    name: 'map_goto',
    title: 'Fly the camera',
  },
  {
    annotations: STEERS,
    description: 'Switch which surface draws the world (201/6-03): the live 3D render or the flat 2D map.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        mode: { description: 'Which surface draws.', enum: ['live', 'flat'], type: 'string' },
      },
      required: ['mode'],
      type: 'object',
    },
    name: 'map_mode',
    title: 'Switch display mode',
  },
  {
    annotations: READS,
    description: 'The board the operator has: units, calls, the selection.',
    inputSchema: NO_ARGS,
    name: 'map_board',
    title: 'The operator’s board',
  },
  {
    // Open-world on purpose: this one leaves the phone, and a client that asks before reaching a network
    // should ask here.
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true, readOnlyHint: false },
    description:
      'Commit and push what the map has filed under docs/benchmarks. The captures themselves arrive from ' +
      'the console itself (its readout posts them), so this is the second half of that round trip.',
    inputSchema: {
      additionalProperties: false,
      properties: {
        message: { description: 'Commit subject; a sensible one is derived when absent.', type: 'string' },
      },
      type: 'object',
    },
    name: 'phone_commit',
    title: 'File the captures',
  },
];

/** The `exec` tool, added only when the operator turned it on. */
const EXEC_TOOL = {
  annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true, readOnlyHint: false },
  description:
    'Run a shell command in the repository on the phone. Off unless PANEL_MCP_EXEC=1 — this is the one ' +
    'tool that is not an allowlist, and it exists for what the allowlist cannot cover.',
  inputSchema: {
    additionalProperties: false,
    properties: {
      command: { description: 'The command line to run, in the repo root.', type: 'string' },
      timeoutMs: { description: 'How long to wait before killing it (default 120000).', type: 'number' },
    },
    required: ['command'],
    type: 'object',
  },
  name: 'phone_exec',
  title: 'Run a command on the phone',
};

/**
 * One JSON-RPC request → its response, or null for a notification.
 *
 * Pure over `deps` so the whole protocol is testable without a panel, a phone or a socket: `panel` is how it
 * reaches the panel's HTTP API, `exec` how it runs a command when that is enabled.
 *
 * **Dual-era.** A client that opens with `initialize` is served the handshake, answered in its own revision
 * when we speak one; a client that sends `server/discover`, or declares a revision in `_meta`, is served
 * statelessly. Nothing here keeps session state to begin with — every tool call is a fresh hop to the panel.
 */
export async function handleRpc(request, deps) {
  const { id, method, params } = request;
  const asked = requestedVersion(request);
  const modern = asked !== null;
  const reply = (result) =>
    id === undefined ? null : { id, jsonrpc: '2.0', result: modern ? { resultType: 'complete', ...result } : result };
  const fail = (error) => (id === undefined ? null : { error, id, jsonrpc: '2.0' });

  if (modern && !SUPPORTED_VERSIONS.includes(asked)) {
    return fail(unsupportedVersion(asked));
  }
  if (method === 'server/discover') {
    return reply(discoverResult(CAPABILITIES));
  }
  if (method === 'initialize') {
    return reply({
      capabilities: CAPABILITIES,
      instructions: INSTRUCTIONS,
      protocolVersion: negotiate(params?.protocolVersion),
      serverInfo: SERVER_INFO,
    });
  }
  if (method?.startsWith('notifications/')) {
    return null;
  }
  if (method === 'ping') {
    return reply({});
  }
  if (method === 'tools/list') {
    return reply({ tools: toolList(deps.env) });
  }
  if (method !== 'tools/call') {
    return fail({ code: -32_601, message: `unknown method '${method}'` });
  }

  const name = params?.name;
  const args = params?.arguments ?? {};
  try {
    return reply(await callTool(name, args, deps));
  } catch (error) {
    // A tool failure is a RESULT, not a protocol error: the agent must be able to read what went wrong and
    // act on it, and a JSON-RPC error is the shape reserved for "this request made no sense".
    return reply({ content: [{ text: `${name} failed: ${message(error)}`, type: 'text' }], isError: true });
  }
}

/** Every tool this process offers, which depends on what the operator turned on. */
export function toolList(env = process.env) {
  return env.PANEL_MCP_EXEC === '1' ? [...TOOLS, EXEC_TOOL] : TOOLS;
}

async function callTool(name, args, deps) {
  const { exec, panel } = deps;
  switch (name) {
    case 'map_board':
      return content(await mapCall(panel, 'ops'));
    case 'map_goto':
      return content(await mapCall(panel, 'pose', { pose: args }));
    case 'map_mode':
      return content(await mapCall(panel, 'mode', { mode: args.mode }));
    case 'map_open':
      return content(
        await panel('POST', '/api/map/open', {
          district: args.district ?? '',
          out: args.out ?? './build/phone',
          view: args.view ?? 'map',
        }),
      );
    case 'map_release':
      return content(await panel('POST', '/api/map/release', { note: args.note ?? '' }));
    case 'map_screenshot': {
      const answer = await mapCall(panel, 'screenshot', {}, 30_000);
      const image = answer?.value?.image;
      if (typeof image !== 'string') {
        return content(answer);
      }

      // An IMAGE result, so the agent sees the map rather than a base64 string it cannot read.
      return { content: [{ data: image.slice(image.indexOf(',') + 1), mimeType: 'image/png', type: 'image' }] };
    }
    case 'map_snapshot':
      return content(await mapCall(panel, 'snapshot'));
    case 'map_state':
      return content(await panel('GET', '/api/map/state'));
    case 'phone_commit':
      return content(
        await panel('POST', '/api/commit', {
          paths: (await panel('GET', '/api/state')).pending ?? [],
          push: true,
          subject: args.message ?? 'a capture from the phone',
        }),
      );
    case 'phone_exec': {
      if (deps.env?.PANEL_MCP_EXEC !== '1') {
        throw new Error('phone_exec is off — start the server with PANEL_MCP_EXEC=1 to allow it');
      }

      return content(await exec(String(args.command), Number(args.timeoutMs) || 120_000));
    }
    case 'phone_jobs':
      return content(await panel('GET', '/api/jobs'));
    case 'phone_log': {
      const lines = Number(args.lines) || 80;
      const log = await panel('GET', `/api/log/tail?tail=${lines}`);

      return content(log);
    }
    case 'phone_run':
      return content(await panel('POST', `/api/job/${encodeURIComponent(String(args.id))}`, args.env ?? {}));
    case 'phone_state':
      return content(await panel('GET', '/api/state'));
    case 'phone_stop':
      return content(await panel('POST', '/api/stop', {}));
    default:
      throw new Error(`unknown tool '${name}'`);
  }
}

/**
 * Text back to the caller, in the one shape MCP wants — plus the same answer as `structuredContent` when it
 * is an object, so a client that can read data does not have to re-parse a string the model already saw.
 *
 * No `outputSchema` goes with it, deliberately: a schema makes conformance MANDATORY, and these shapes are
 * the panel's rather than this file's — a preflight check added on the phone would start failing validation
 * in an agent's client, which is a worse failure than having no schema at all.
 */
function content(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const structured = typeof value === 'object' && value !== null && !Array.isArray(value);

  return { content: [{ text, type: 'text' }], ...(structured ? { structuredContent: value } : {}) };
}

/** Run a command in the repo, capturing both streams — only reachable when `phone_exec` is on. */
async function execInRepo(command, timeoutMs) {
  try {
    const { stderr, stdout } = await run('bash', ['-lc', command], {
      cwd: new URL('../..', import.meta.url).pathname,
      maxBuffer: 8 * 1024 * 1024,
      timeout: timeoutMs,
    });

    return { code: 0, stderr, stdout };
  } catch (error) {
    return { code: error.code ?? 1, stderr: error.stderr ?? message(error), stdout: error.stdout ?? '' };
  }
}

/** Ask the attached map page for something, through the panel's bus. */
function mapCall(panel, kind, args = {}, timeoutMs = 20_000) {
  return panel('POST', '/api/map/command', { args, kind, timeoutMs });
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

/** Reach the panel, and say plainly when it is not there — every tool depends on it being up. */
async function panelFetch(method, path, body) {
  let response;
  try {
    response = await fetch(`${PANEL}${path}`, {
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
      method,
    });
  } catch (error) {
    throw new Error(`the panel is not answering at ${PANEL} — start it with \`npm run panel\``, { cause: error });
  }
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const DEPS = { env: process.env, exec: execInRepo, panel: panelFetch };

/**
 * JSON-RPC over POST, for a Claude that is not on this phone.
 *
 * Localhost-bound and token-gated, both for the same reason: what this serves is the phone's build system,
 * and the moment it is reachable it is reachable by whoever finds the URL.
 */
function serveHttp(port) {
  const token = process.env.PANEL_MCP_TOKEN ?? randomBytes(24).toString('hex');
  const send = (response, status, payload) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(payload === null ? '' : JSON.stringify(payload));
  };
  createServer((request, response) => {
    const authorized = request.headers.authorization === `Bearer ${token}`;
    if (!authorized) {
      return send(response, 401, { error: 'bearer token required' });
    }
    if (request.method !== 'POST') {
      return send(response, 405, { error: 'POST JSON-RPC to /mcp' });
    }
    let body = '';
    let refused = false;
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES && !refused) {
        // A body this size is not a tool call; assembling the rest of it is the phone's memory.
        refused = true;
        send(response, 413, parseFailure(new Error(`body over ${MAX_BODY_BYTES} bytes`)));
        request.destroy();
      }
    });
    request.on('end', () => {
      if (refused) {
        return;
      }
      let payload;
      try {
        payload = JSON.parse(body);
      } catch (error) {
        // A truncated body is what a phone tunnel produces when it half-closes a connection, and parsing it
        // in this handler used to take the whole server down with it.
        return send(response, 400, parseFailure(error));
      }
      void respond(payload, (one) => handleRpc(one, DEPS))
        .then((answer) => send(response, answer ? 200 : 202, answer))
        .catch((error) => send(response, 500, { error: message(error) }));
    });
  }).listen(port, '127.0.0.1', () => {
    process.stdout.write(`opensa phone MCP on http://127.0.0.1:${port}/mcp\n`);
    process.stdout.write(`token: ${token}\n`);
    process.stdout.write(`panel: ${PANEL}\n`);
  });
}

/** Line-delimited JSON-RPC on stdin/stdout — the transport a Claude on this phone speaks. */
function serveStdio() {
  process.stdin.setEncoding('utf8');
  process.stdin.on(
    'data',
    readLines(
      (one) => handleRpc(one, DEPS),
      (answer) => process.stdout.write(`${JSON.stringify(answer)}\n`),
    ),
  );
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  if (process.argv.includes('--http')) {
    const flag = process.argv.indexOf('--port');
    serveHttp(flag > 0 ? Number(process.argv[flag + 1]) : 8788);
  } else {
    serveStdio();
  }
}
