/**
 * The MCP protocol layer, shared by the phone's server (`mcp.mjs`) and the bridge that forwards to it
 * (`mcp-bridge.mjs`) — versions, negotiation, discovery, and a line framing that cannot be killed by a
 * malformed byte.
 *
 * It is its own file because both ends need the same answers and neither owns them. The bridge has to speak
 * for the phone while the phone is unreachable; the phone has to speak for itself. A second copy of the
 * version list in the bridge is a second thing to forget.
 *
 * **The protocol moved and this server did not.** It pinned `2024-11-05` in its `initialize` reply whatever
 * the client asked for (measured 2026-08-28: a client asking for `2025-06-18` was answered `2024-11-05`),
 * and it answered `server/discover` — which every server **MUST** implement since `2026-07-28` — with
 * `unknown method`. Neither broke Claude Code, because a client that supports both eras falls back; both
 * cost features, and a modern-only client fails outright.
 *
 * So this file makes the server **dual-era**, which is what the spec asks a server in this position to be:
 *
 * - a client that opens with `initialize` gets the legacy handshake, answered in ITS revision when we speak
 *   one (`negotiate`), or in our newest when we do not;
 * - a client that sends `server/discover`, or any request carrying a modern `_meta` version, is served
 *   statelessly — there is no session here to keep, since every tool call is a fresh HTTP hop to the panel.
 *
 * @see https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning
 */

/** The modern, stateless revision: no handshake, the version rides every request's `_meta`. */
export const MODERN_VERSION = '2026-07-28';

/** Handshake-based revisions this server answers `initialize` in, newest first. */
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

/** Everything `server/discover` reports, newest first. */
export const SUPPORTED_VERSIONS = [MODERN_VERSION, ...LEGACY_VERSIONS];

/** Who is answering. Reported for display and logging only — never trusted for anything. */
export const SERVER_INFO = {
  description: 'the phone-console panel, as tools',
  name: 'opensa-phone',
  version: '2',
};

/** Where a request declares its revision, in the modern era. */
const VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';

/** Where a discovery result names the server. */
const SERVER_INFO_KEY = 'io.modelcontextprotocol/serverInfo';

/**
 * What an agent needs to know before it calls anything, handed over at `initialize` and at `server/discover`
 * rather than discovered one refusal at a time.
 *
 * These are the rules that are not visible in a tool signature: the order to read in, that a run is minutes
 * long and returns immediately, that a missing map is a person's problem rather than a retryable error.
 */
export const INSTRUCTIONS = `These tools drive ONE Android phone running Termux, through the panel on it. Nothing here runs a
command directly — every call goes to that panel, and if it is down every tool says so instead of starting
anything.

1. Call phone_state FIRST. Its verdict gates the rest, and the check that fails names what to do. It also
   carries the pak on disk and the recipe it was built from: two measurements are comparable only when that
   recipe matches.
2. One job at a time. phone_run returns the moment a job STARTS, never when it finishes — a convert is ten
   minutes to an hour on this device. Follow it with phone_log, and do not poll faster than the log grows.
   A refusal while another job runs is the phone protecting one build folder from two writers, not a
   transient error to retry.
3. Call map_state before any other map_ tool. The page answers only when it was opened with &agent=1 (the
   panel's own links carry it, and so does map_open). When nothing is attached, map_open puts the console
   on the phone's screen and waits for it — no other call can clear that refusal, and a person tapping a
   link is no longer the only way.
4. Measurements file themselves: the console posts its own capture to the panel, and phone_commit commits
   and pushes exactly what git reports pending under docs/benchmarks. It never invents a path, and it never
   files code.
5. A tool that fails answers with isError and a readable reason — read it and act on it. A JSON-RPC error
   means the request itself made no sense, and retrying it unchanged will not help.`;

/** `server/discover`: supported versions, capabilities and identity in one request. */
export function discoverResult(capabilities) {
  return {
    _meta: { [SERVER_INFO_KEY]: SERVER_INFO },
    capabilities,
    instructions: INSTRUCTIONS,
    resultType: 'complete',
    supportedVersions: SUPPORTED_VERSIONS,
  };
}

/**
 * The revision to answer an `initialize` handshake in: the client's own when we speak it, our newest
 * otherwise. Echoing matters — a client told `2024-11-05` drops back to it, and loses `structuredContent`,
 * tool titles and annotations that it and this server both support.
 */
export function negotiate(requested) {
  return LEGACY_VERSIONS.includes(requested) ? requested : LEGACY_VERSIONS[0];
}

/** A parse failure, addressed to nobody in particular — an unparseable message has no id to answer. */
export function parseFailure(error) {
  return {
    error: { code: -32_700, message: `parse error: ${error instanceof Error ? error.message : String(error)}` },
    id: null,
    jsonrpc: '2.0',
  };
}

/**
 * Line-delimited JSON-RPC on stdin, and the reason this is a function rather than four lines inline.
 *
 * The previous framing called `JSON.parse` in the socket's own data handler, so **one malformed line killed
 * the process** — verified 2026-08-28 on both the server and the bridge, and on the HTTP transport a
 * truncated body did the same. On stdio that takes every tool in the session with it and costs a NEW
 * session to get back, which is exactly the class of cost this panel exists to remove. A tunnel that
 * half-closes a connection produces that byte for free.
 *
 * So a line that will not parse is answered with `-32700` and the reader carries on to the next one.
 */
export function readLines(handle, write) {
  let buffer = '';

  return (chunk) => {
    buffer += chunk;
    let cut = buffer.indexOf('\n');
    while (cut >= 0) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (line !== '') {
        void answerLine(line, handle, write);
      }
      cut = buffer.indexOf('\n');
    }
  };
}

/** The revision a request declares, or null when it is a legacy one that declares none. */
export function requestedVersion(request) {
  const asked = request?.params?._meta?.[VERSION_KEY];

  return typeof asked === 'string' ? asked : null;
}

/**
 * One incoming payload → what to send back, or null when there is nothing to send.
 *
 * Handles a JSON-RPC BATCH (an array), which the revisions this server speaks allow and the previous
 * version answered with silence — an array reached `handleRpc` as one request, matched no method, and was
 * dropped because an array has no `id`, leaving the client waiting for a reply that was never coming.
 */
export async function respond(payload, handle) {
  if (!Array.isArray(payload)) {
    return handle(payload);
  }
  if (payload.length === 0) {
    return { error: { code: -32_600, message: 'empty batch' }, id: null, jsonrpc: '2.0' };
  }
  const answers = (await Promise.all(payload.map((one) => handle(one)))).filter((answer) => answer !== null);

  return answers.length === 0 ? null : answers;
}

/** The error a modern client can act on: it names what we do speak, so the client retries rather than dies. */
export function unsupportedVersion(requested) {
  return {
    code: -32_022,
    data: { requested, supported: SUPPORTED_VERSIONS },
    message: 'Unsupported protocol version',
  };
}

async function answerLine(line, handle, write) {
  let payload;
  try {
    payload = JSON.parse(line);
  } catch (error) {
    return write(parseFailure(error));
  }
  try {
    const answer = await respond(payload, handle);
    if (answer !== null) {
      write(answer);
    }
  } catch (error) {
    // The handler is not supposed to throw. If it does, the client still gets an answer rather than silence.
    write({
      error: { code: -32_603, message: error instanceof Error ? error.message : String(error) },
      id: payload?.id ?? null,
      jsonrpc: '2.0',
    });
  }
}
