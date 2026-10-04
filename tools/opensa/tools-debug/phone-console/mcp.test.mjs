import { describe, expect, it, vi } from 'vitest';

import { LEGACY_VERSIONS, MODERN_VERSION, SUPPORTED_VERSIONS } from './mcp-protocol.mjs';
import { handleRpc, toolList } from './mcp.mjs';

/** A request in the modern era: the revision rides `_meta` and there is no handshake at all. */
const modern = (request, version = MODERN_VERSION) => ({
  ...request,
  params: { ...request.params, _meta: { 'io.modelcontextprotocol/protocolVersion': version } },
});

/** A fake panel: records what was asked of it, answers what the test set up. */
function panelStub(answers = {}) {
  const calls = [];

  return {
    calls,
    panel: (method, path, body) => {
      calls.push(`${method} ${path}`);

      return Promise.resolve(answers[path] ?? { ok: true, sent: body ?? null });
    },
  };
}

const deps = (over = {}) => ({ env: {}, exec: () => Promise.resolve({ code: 0 }), ...panelStub(), ...over });

/** The text a tool answered with, parsed when it is JSON. */
function text(result) {
  const raw = result.result.content[0].text;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

describe('phone MCP server', () => {
  describe('negative cases', () => {
    it('answers a method it does not know with a JSON-RPC error, never a tool result', async () => {
      const answer = await handleRpc({ id: 1, jsonrpc: '2.0', method: 'resources/list' }, deps());

      expect(answer.error.code).toBe(-32601);
      expect(answer.result).toBeUndefined();
    });

    it('says which end is silent when no map is attached, rather than hanging', async () => {
      // The panel answers this one itself — "no map is attached" and "the map never answered" are different
      // problems and an agent must not have to guess between them.
      const stub = panelStub({
        '/api/map/command': { error: 'no map is attached — open the console with &agent=1', ok: false },
      });
      const answer = await handleRpc(
        { id: 10, jsonrpc: '2.0', method: 'tools/call', params: { arguments: {}, name: 'map_snapshot' } },
        deps(stub),
      );

      expect(text(answer).ok).toBe(false);
      expect(text(answer).error).toContain('agent=1');
    });

    it('reports a tool failure as a RESULT the agent can read, not as a protocol error', async () => {
      // The distinction is the whole difference between "this request made no sense" and "the thing you
      // asked for went wrong" — an agent can act on the second and can only give up on the first.
      const answer = await handleRpc(
        { id: 2, jsonrpc: '2.0', method: 'tools/call', params: { arguments: {}, name: 'phone_nonsense' } },
        deps(),
      );

      expect(answer.result.isError).toBe(true);
      expect(answer.result.content[0].text).toContain("unknown tool 'phone_nonsense'");
    });

    it('refuses a revision it does not speak by NAMING the ones it does', async () => {
      // A modern client can act on this: it retries with a version from the list. Answering -32601, or
      // answering in a revision the client did not ask for, leaves it nothing to do.
      const answer = await handleRpc(modern({ id: 20, jsonrpc: '2.0', method: 'tools/list' }, '1900-01-01'), deps());

      expect(answer.error.code).toBe(-32_022);
      expect(answer.error.data.supported).toEqual(SUPPORTED_VERSIONS);
      expect(answer.result).toBeUndefined();
    });

    it('does not offer the shell tool unless it was turned on', () => {
      expect(toolList({}).map((tool) => tool.name)).not.toContain('phone_exec');
      expect(toolList({ PANEL_MCP_EXEC: '' }).map((tool) => tool.name)).not.toContain('phone_exec');
    });

    it('refuses to run a shell command when the tool is off, even called by name', async () => {
      const exec = vi.fn();
      const answer = await handleRpc(
        {
          id: 3,
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { arguments: { command: 'echo nope' }, name: 'phone_exec' },
        },
        deps({ exec }),
      );

      expect(exec).not.toHaveBeenCalled();
      expect(answer.result.isError).toBe(true);
      expect(answer.result.content[0].text).toContain('PANEL_MCP_EXEC=1');
    });

    it('answers a NOTIFICATION with nothing at all — an id-less request has no reply', async () => {
      expect(await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, deps())).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('handshakes with the protocol version and a tools capability', async () => {
      const answer = await handleRpc({ id: 1, jsonrpc: '2.0', method: 'initialize', params: {} }, deps());

      expect(answer.result.protocolVersion).toBe(LEGACY_VERSIONS[0]);
      expect(answer.result.capabilities.tools).toBeDefined();
      expect(answer.result.serverInfo.name).toBe('opensa-phone');
    });

    it('handshakes in the CLIENT’s revision rather than pinning its own', async () => {
      // Measured 2026-08-28: a client asking for 2025-06-18 was answered 2024-11-05 and dropped back to it,
      // losing structuredContent, tool titles and annotations that both ends support.
      const answer = await handleRpc(
        { id: 1, jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2025-06-18' } },
        deps(),
      );

      expect(answer.result.protocolVersion).toBe('2025-06-18');
    });

    it('hands the agent the operating rules at the handshake, not one refusal at a time', async () => {
      const answer = await handleRpc({ id: 1, jsonrpc: '2.0', method: 'initialize', params: {} }, deps());

      expect(answer.result.instructions).toContain('phone_state FIRST');
      expect(answer.result.instructions).toContain('&agent=1');
    });

    it('answers server/discover, which a modern client probes stdio with', async () => {
      const answer = await handleRpc(modern({ id: 11, jsonrpc: '2.0', method: 'server/discover' }), deps());

      expect(answer.result.supportedVersions).toEqual(SUPPORTED_VERSIONS);
      expect(answer.result.capabilities).toEqual({ tools: {} });
      expect(answer.result.resultType).toBe('complete');
    });

    it('marks a modern result complete, and leaves a legacy one alone', async () => {
      const asModern = await handleRpc(modern({ id: 12, jsonrpc: '2.0', method: 'tools/list' }), deps());
      const asLegacy = await handleRpc({ id: 13, jsonrpc: '2.0', method: 'tools/list' }, deps());

      expect(asModern.result.resultType).toBe('complete');
      expect(asLegacy.result.resultType).toBeUndefined();
    });

    it('lists the panel tools, and every one of them declares a schema', async () => {
      const answer = await handleRpc({ id: 2, jsonrpc: '2.0', method: 'tools/list' }, deps());
      const tools = answer.result.tools;

      expect(tools.map((tool) => tool.name)).toEqual([
        'phone_state',
        'phone_jobs',
        'phone_run',
        'phone_log',
        'phone_stop',
        'map_state',
        'map_open',
        'map_release',
        'map_snapshot',
        'map_screenshot',
        'map_goto',
        'map_mode',
        'map_board',
        'phone_commit',
      ]);
      expect(tools.every((tool) => tool.inputSchema.type === 'object' && tool.description.length > 20)).toBe(true);
    });

    it('states every tool’s behaviour rather than letting the client assume the worst', async () => {
      // An unannotated tool is read as destructive and open-world. That is right for a convert and wrong
      // for the nine that only read, which is the difference between a client asking a person every time
      // and asking once.
      const answer = await handleRpc({ id: 14, jsonrpc: '2.0', method: 'tools/list' }, deps());
      const tools = answer.result.tools;
      const named = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

      expect(tools.every((tool) => typeof tool.title === 'string' && tool.title.length > 0)).toBe(true);
      expect(tools.every((tool) => typeof tool.annotations?.readOnlyHint === 'boolean')).toBe(true);
      expect(named.phone_state.annotations.readOnlyHint).toBe(true);
      expect(named.phone_run.annotations).toMatchObject({ destructiveHint: true, readOnlyHint: false });
      expect(named.phone_commit.annotations.openWorldHint).toBe(true);
    });

    it('closes the schema of a tool that takes nothing, and enumerates the ones that take a word', async () => {
      const answer = await handleRpc({ id: 15, jsonrpc: '2.0', method: 'tools/list' }, deps());
      const named = Object.fromEntries(answer.result.tools.map((tool) => [tool.name, tool]));

      expect(named.phone_state.inputSchema.additionalProperties).toBe(false);
      expect(named.map_mode.inputSchema.properties.mode.enum).toEqual(['live', 'flat']);
      expect(named.map_goto.inputSchema.properties.projection.enum).toEqual(['perspective', 'ortho']);
      expect(named.map_goto.inputSchema.properties.at.minItems).toBe(2);
    });

    it('offers the shell tool once the operator turned it on', () => {
      expect(toolList({ PANEL_MCP_EXEC: '1' }).map((tool) => tool.name)).toContain('phone_exec');
    });

    it('starts a job through the panel rather than running anything itself', async () => {
      // The load-bearing property: ONE JobRunner on the phone. A second one is two converts over one folder.
      const stub = panelStub();
      await handleRpc(
        {
          id: 3,
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { arguments: { env: { DISTRICT: 'los-santos-centre' }, id: 'map3d' }, name: 'phone_run' },
        },
        deps(stub),
      );

      expect(stub.calls).toEqual(['POST /api/job/map3d']);
    });

    it('opens the console through the panel, carrying the pak and district it was asked for', async () => {
      const stub = panelStub();
      const answer = await handleRpc(
        {
          id: 6,
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            arguments: { district: 'los-santos-centre', out: './build/phone-1916', view: 'field' },
            name: 'map_open',
          },
        },
        deps(stub),
      );

      expect(stub.calls).toEqual(['POST /api/map/open']);
      expect(text(answer).sent).toEqual({
        district: 'los-santos-centre',
        out: './build/phone-1916',
        view: 'field',
      });
    });

    it('reads the log the PAGE shows, tail-first', async () => {
      const stub = panelStub({ '/api/log/tail?tail=5': { job: { running: false }, lines: ['a', 'b'] } });
      const answer = await handleRpc(
        { id: 4, jsonrpc: '2.0', method: 'tools/call', params: { arguments: { lines: 5 }, name: 'phone_log' } },
        deps(stub),
      );

      expect(stub.calls).toEqual(['GET /api/log/tail?tail=5']);
      expect(text(answer).lines).toEqual(['a', 'b']);
    });

    it('commits exactly what the panel says is pending — never a path it made up', async () => {
      const stub = panelStub({ '/api/state': { pending: ['docs/benchmarks/opensa-engine/2026-08-28-x.json'] } });
      const answer = await handleRpc(
        {
          id: 5,
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { arguments: { message: 'the field run' }, name: 'phone_commit' },
        },
        deps(stub),
      );

      expect(stub.calls).toEqual(['GET /api/state', 'POST /api/commit']);
      expect(text(answer).sent).toEqual({
        paths: ['docs/benchmarks/opensa-engine/2026-08-28-x.json'],
        push: true,
        subject: 'the field run',
      });
    });

    it('reads the map through the panel bus, never by talking to the page itself', async () => {
      // The page is on the phone and this server may not be; the panel is the one thing both can reach.
      const stub = panelStub({ '/api/map/command': { ok: true, value: { readout: { fps: 41 } } } });
      const answer = await handleRpc(
        { id: 7, jsonrpc: '2.0', method: 'tools/call', params: { arguments: {}, name: 'map_snapshot' } },
        deps(stub),
      );

      expect(stub.calls).toEqual(['POST /api/map/command']);
      expect(text(answer).value.readout.fps).toBe(41);
    });

    it('answers with the data AND the text, so a client does not re-parse what the model already read', async () => {
      const stub = panelStub({ '/api/map/command': { ok: true, value: { readout: { fps: 41 } } } });
      const answer = await handleRpc(
        { id: 16, jsonrpc: '2.0', method: 'tools/call', params: { arguments: {}, name: 'map_snapshot' } },
        deps(stub),
      );

      expect(answer.result.structuredContent).toEqual({ ok: true, value: { readout: { fps: 41 } } });
      expect(JSON.parse(answer.result.content[0].text)).toEqual(answer.result.structuredContent);
    });

    it('hands a screenshot back as an IMAGE, so the map is seen rather than described', async () => {
      const png = 'data:image/png;base64,iVBORw0KGgo=';
      const stub = panelStub({ '/api/map/command': { ok: true, value: { image: png } } });
      const answer = await handleRpc(
        { id: 8, jsonrpc: '2.0', method: 'tools/call', params: { arguments: {}, name: 'map_screenshot' } },
        deps(stub),
      );

      expect(answer.result.content[0]).toEqual({ data: 'iVBORw0KGgo=', mimeType: 'image/png', type: 'image' });
    });

    it('passes a camera pose through as the map page expects it', async () => {
      const stub = panelStub();
      await handleRpc(
        {
          id: 9,
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { arguments: { at: [1481, -1770], height: 900 }, name: 'map_goto' },
        },
        deps(stub),
      );

      expect(stub.calls).toEqual(['POST /api/map/command']);
    });

    it('runs a shell command through the injected runner when it is enabled', async () => {
      const exec = vi.fn(() => Promise.resolve({ code: 0, stderr: '', stdout: 'ok' }));
      const answer = await handleRpc(
        {
          id: 6,
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { arguments: { command: 'npm test' }, name: 'phone_exec' },
        },
        deps({ env: { PANEL_MCP_EXEC: '1' }, exec }),
      );

      expect(exec).toHaveBeenCalledWith('npm test', 120_000);
      expect(text(answer)).toEqual({ code: 0, stderr: '', stdout: 'ok' });
    });
  });
});
