import { describe, expect, it, vi } from 'vitest';

import { bridgeRpc, postToPhone } from './mcp-bridge.mjs';
import { LEGACY_VERSIONS, SUPPORTED_VERSIONS } from './mcp-protocol.mjs';

const failing = () => {
  throw new Error('connect ECONNREFUSED');
};

describe('bridgeRpc', () => {
  describe('negative cases', () => {
    it('answers a tool call with what to set when the address is missing', async () => {
      const answer = await bridgeRpc({ id: 3, jsonrpc: '2.0', method: 'tools/call' }, { env: {}, post: failing });

      expect(answer.error.code).toBe(-32_001);
      expect(answer.error.message).toContain('panel:tunnel');
    });

    it('treats a blank address as unset', async () => {
      const answer = await bridgeRpc(
        { id: 4, jsonrpc: '2.0', method: 'tools/list' },
        { env: { OPENSA_PHONE_URL: '  ' }, post: failing },
      );

      expect(answer.result.tools).toEqual([]);
    });

    it('still initializes without a phone, so the session loads', async () => {
      const answer = await bridgeRpc({ id: 1, jsonrpc: '2.0', method: 'initialize' }, { env: {}, post: failing });

      expect(answer.result.protocolVersion).toBe(LEGACY_VERSIONS[0]);
    });

    it('says what to set in the HANDSHAKE, not only when a tool is called', async () => {
      // An empty tool list with no reason attached is a server that looks broken. The reason belongs where
      // a client reads it before it tries anything.
      const answer = await bridgeRpc({ id: 1, jsonrpc: '2.0', method: 'initialize' }, { env: {}, post: failing });

      expect(answer.result.instructions).toContain('OPENSA_PHONE_URL');
      expect(answer.result.serverInfo.name).toContain('offline');
    });

    it('answers a modern probe without a phone, rather than looking like a legacy server', async () => {
      const answer = await bridgeRpc(
        {
          id: 2,
          jsonrpc: '2.0',
          method: 'server/discover',
          params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } },
        },
        { env: {}, post: failing },
      );

      expect(answer.result.supportedVersions).toEqual(SUPPORTED_VERSIONS);
      expect(answer.result.instructions).toContain('panel:tunnel');
    });

    it('names the stale tunnel when the phone does not answer', async () => {
      const answer = await bridgeRpc(
        { id: 5, jsonrpc: '2.0', method: 'tools/list' },
        { env: { OPENSA_PHONE_URL: 'https://gone.example/mcp' }, post: failing },
      );

      expect(answer.error.message).toContain('https://gone.example/mcp');
      expect(answer.error.message).toContain('ECONNREFUSED');
    });

    it('reports a rejected token as itself, not as a stale address', async () => {
      const answer = await bridgeRpc(
        { id: 6, jsonrpc: '2.0', method: 'tools/list' },
        {
          env: { OPENSA_PHONE_URL: 'https://phone.example/mcp' },
          post: () => {
            throw Object.assign(new Error('the phone rejected the token'), { plain: true });
          },
        },
      );

      expect(answer.error.message).toBe('the phone rejected the token');
    });

    it('says nothing back to a notification it cannot forward', async () => {
      const answer = await bridgeRpc(
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { env: {}, post: failing },
      );

      expect(answer).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('gives up on a phone that never answers, instead of waiting forever', async () => {
      // A dead tunnel usually refuses, which is instant. One whose far end slept black-holes the packets,
      // and a fetch with no signal hangs there until the client's own patience runs out.
      const fetchSpy = vi.fn(() => Promise.resolve({ status: 200, text: () => Promise.resolve('') }));
      vi.stubGlobal('fetch', fetchSpy);
      await postToPhone('https://phone.example/mcp', 'abc', { id: 1, jsonrpc: '2.0', method: 'ping' }, 5000);
      vi.unstubAllGlobals();

      expect(fetchSpy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
      expect(fetchSpy.mock.calls[0][1].headers.authorization).toBe('Bearer abc');
    });

    it('forwards the message unchanged, with the token', async () => {
      const seen = [];
      const answer = await bridgeRpc(
        { id: 7, jsonrpc: '2.0', method: 'tools/call', params: { name: 'map_state' } },
        {
          env: { OPENSA_PHONE_TOKEN: ' abc ', OPENSA_PHONE_URL: 'https://phone.example/mcp' },
          post: (url, token, request) => {
            seen.push([url, token, request]);

            return Promise.resolve({ id: 7, jsonrpc: '2.0', result: { ok: true } });
          },
        },
      );

      expect(seen).toEqual([
        [
          'https://phone.example/mcp',
          'abc',
          { id: 7, jsonrpc: '2.0', method: 'tools/call', params: { name: 'map_state' } },
        ],
      ]);
      expect(answer.result).toEqual({ ok: true });
    });
  });
});
