import { describe, expect, it } from 'vitest';

import {
  discoverResult,
  LEGACY_VERSIONS,
  MODERN_VERSION,
  negotiate,
  readLines,
  requestedVersion,
  respond,
  SUPPORTED_VERSIONS,
  unsupportedVersion,
} from './mcp-protocol.mjs';

/** A reader wired to a list, so what came back can be asserted in order. */
function reader(handle) {
  const written = [];

  return { feed: readLines(handle, (answer) => written.push(answer)), written };
}

const echo = (request) =>
  Promise.resolve(request.id === undefined ? null : { id: request.id, jsonrpc: '2.0', result: {} });

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('the MCP protocol layer', () => {
  describe('negative cases', () => {
    it('answers an unparseable line and KEEPS READING — one bad byte used to kill the process', async () => {
      // Verified 2026-08-28 against the previous framing: `JSON.parse` in the socket handler threw, node
      // exited, and every tool in the session went with it until a NEW session was started.
      const { feed, written } = reader(echo);
      feed('not json\n{"id":2,"jsonrpc":"2.0","method":"ping"}\n');
      await flush();

      expect(written[0].error.code).toBe(-32_700);
      expect(written[0].id).toBeNull();
      expect(written[1].id).toBe(2);
    });

    it('answers an empty batch rather than dropping it', async () => {
      expect((await respond([], echo)).error.code).toBe(-32_600);
    });

    it('names what it does speak when a version is refused, so the client can retry', () => {
      const error = unsupportedVersion('1900-01-01');

      expect(error.code).toBe(-32_022);
      expect(error.data).toEqual({ requested: '1900-01-01', supported: SUPPORTED_VERSIONS });
    });

    it('falls back to its newest handshake revision when the client asks for one it does not speak', () => {
      expect(negotiate('1900-01-01')).toBe(LEGACY_VERSIONS[0]);
      expect(negotiate(undefined)).toBe(LEGACY_VERSIONS[0]);
    });

    it('reads no version out of a legacy request, which declares none', () => {
      expect(requestedVersion({ id: 1, method: 'tools/list' })).toBeNull();
      expect(requestedVersion({ params: { _meta: { 'io.modelcontextprotocol/protocolVersion': 7 } } })).toBeNull();
    });

    it('still answers when the handler itself throws, rather than going silent', async () => {
      const { feed, written } = reader(() => {
        throw new Error('the handler broke');
      });
      feed('{"id":9,"jsonrpc":"2.0","method":"ping"}\n');
      await flush();

      expect(written[0]).toEqual({
        error: { code: -32_603, message: 'the handler broke' },
        id: 9,
        jsonrpc: '2.0',
      });
    });
  });

  describe('positive cases', () => {
    it('answers the handshake in the CLIENT’s revision when it speaks it', () => {
      for (const version of LEGACY_VERSIONS) {
        expect(negotiate(version)).toBe(version);
      }
    });

    it('reads the revision a modern request declares in its _meta', () => {
      const request = { params: { _meta: { 'io.modelcontextprotocol/protocolVersion': MODERN_VERSION } } };

      expect(requestedVersion(request)).toBe(MODERN_VERSION);
    });

    it('discovers as one answer: the versions, the capabilities, the identity and the instructions', () => {
      const result = discoverResult({ tools: {} });

      expect(result.supportedVersions[0]).toBe(MODERN_VERSION);
      expect(result.supportedVersions).toContain('2024-11-05');
      expect(result.capabilities).toEqual({ tools: {} });
      expect(result._meta['io.modelcontextprotocol/serverInfo'].name).toBe('opensa-phone');
      expect(result.instructions).toContain('phone_state FIRST');
    });

    it('answers a batch as a batch, dropping the notifications inside it', async () => {
      const answer = await respond(
        [
          { id: 1, jsonrpc: '2.0', method: 'ping' },
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          { id: 2, jsonrpc: '2.0', method: 'ping' },
        ],
        echo,
      );

      expect(answer.map((one) => one.id)).toEqual([1, 2]);
    });

    it('says nothing at all when a batch is entirely notifications', async () => {
      expect(await respond([{ jsonrpc: '2.0', method: 'notifications/initialized' }], echo)).toBeNull();
    });

    it('reassembles a message split across chunks', async () => {
      const { feed, written } = reader(echo);
      feed('{"id":3,"jsonrpc":');
      feed('"2.0","method":"ping"}\n');
      await flush();

      expect(written[0].id).toBe(3);
    });
  });
});
