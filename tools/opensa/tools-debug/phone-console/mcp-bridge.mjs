/**
 * A stdio MCP server that forwards to the phone's HTTP one, so the address and the token are read at RUN
 * time rather than at config-parse time.
 *
 * `.mcp.json` used to name the tunnel address directly, as `"url": "${OPENSA_PHONE_URL}"`. That config is
 * parsed before anything runs and the variable is not expanded when it is unset, so a session started
 * without the tunnel up refuses the whole server with `INVALID_CONFIG: 'url' is not a valid URL` — and
 * `${VAR:-default}` did not help. Worse, the failure is at load: it takes a NEW session to clear, which is
 * exactly the cost the panel exists to remove.
 *
 * So the config points here instead, and this process decides:
 *
 * - `OPENSA_PHONE_URL` set  — every call is POSTed there with the bearer token, verbatim.
 * - unset                   — the server still starts and lists no tools, saying what to set.
 *
 * Either way a session always loads. The tools appear when the phone is reachable.
 *
 * It answers `initialize` and `server/discover` for itself in both states, out of `mcp-protocol.mjs`, so a
 * client learns what this server speaks whether or not there is a phone behind it — and, when there is not,
 * reads WHY in the handshake instead of one refused tool call at a time.
 */
import {
  discoverResult,
  negotiate,
  readLines,
  requestedVersion,
  SERVER_INFO,
  SUPPORTED_VERSIONS,
  unsupportedVersion,
} from './mcp-protocol.mjs';

const UNSET =
  'OPENSA_PHONE_URL is not set — run `npm run panel:tunnel` on the phone and paste the two values it ' +
  'prints (OPENSA_PHONE_URL, OPENSA_PHONE_TOKEN) into the Claude Code environment, then start a new session.';

/**
 * How long to wait on the phone before giving up on it.
 *
 * A tunnel that has died usually REFUSES, which is instant — but one whose far end went to sleep black-holes
 * the packets instead, and a `fetch` with no signal waits forever on it. That is the failure the caller
 * cannot tell from a slow convert, so it gets a deadline and a reason.
 */
const TIMEOUT_MS = Number(process.env.OPENSA_PHONE_TIMEOUT_MS) || 120_000;

/** Answer locally when there is no phone to ask; otherwise hand the message over unchanged. */
export async function bridgeRpc(request, { env, post }) {
  const { id, method } = request;
  const asked = requestedVersion(request);
  const modern = asked !== null;
  const reply = (result) =>
    id === undefined ? null : { id, jsonrpc: '2.0', result: modern ? { resultType: 'complete', ...result } : result };
  const fail = (message, code = -32_001) =>
    id === undefined ? null : { error: { code, message }, id, jsonrpc: '2.0' };
  const url = (env.OPENSA_PHONE_URL ?? '').trim();

  if (url === '') {
    if (modern && !SUPPORTED_VERSIONS.includes(asked)) {
      return id === undefined ? null : { error: unsupportedVersion(asked), id, jsonrpc: '2.0' };
    }
    if (method === 'server/discover') {
      return reply({ ...discoverResult({ tools: {} }), instructions: UNSET });
    }
    if (method === 'initialize') {
      return reply({
        capabilities: { tools: {} },
        instructions: UNSET,
        protocolVersion: negotiate(request.params?.protocolVersion),
        serverInfo: { ...SERVER_INFO, name: 'opensa-phone (offline)' },
      });
    }
    if (method === 'tools/list') {
      return reply({ tools: [] });
    }

    return method?.startsWith('notifications/') ? null : fail(UNSET);
  }

  try {
    return await post(url, (env.OPENSA_PHONE_TOKEN ?? '').trim(), request);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);

    return error?.plain === true
      ? fail(why)
      : fail(
          `the phone is not answering at ${url} (${why}) — the tunnel address changes on every restart, ` +
            'so re-run `npm run panel:tunnel` and paste the new one.',
        );
  }
}

/** POST one JSON-RPC message to the phone, with the token the tunnel printed. */
export async function postToPhone(url, token, request, timeoutMs = TIMEOUT_MS) {
  const response = await fetch(url, {
    body: JSON.stringify(request),
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
    },
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 401) {
    // A rejected token is its own answer: the address was right, so do not send the reader chasing the tunnel.
    throw Object.assign(
      new Error('the phone rejected the token — OPENSA_PHONE_TOKEN does not match the running panel'),
      {
        plain: true,
      },
    );
  }
  const text = await response.text();

  return text === '' ? null : JSON.parse(text);
}

/** Line-delimited JSON-RPC on stdin/stdout, the transport Claude Code speaks to a stdio server. */
function serveStdio() {
  const deps = { env: process.env, post: postToPhone };
  process.stdin.setEncoding('utf8');
  process.stdin.on(
    'data',
    readLines(
      (one) => bridgeRpc(one, deps),
      (answer) => process.stdout.write(`${JSON.stringify(answer)}\n`),
    ),
  );
}

if (process.argv[1] && process.argv[1].endsWith('mcp-bridge.mjs')) {
  serveStdio();
}
