# phone-console MCP — the round trip, and what the handshake costs

**Run 2026-08-28, from the agent's container to the phone**, over the tunnel the panel was actually serving
that day. The first measurement of the MCP channel itself (`tools-debug/phone-console`, plan 002): every
number the agent reads about this project now arrives through it, and nothing had ever timed it.

## Conditions

- **Phone:** MGA-LX3 / Termux, `npm run panel` up on `127.0.0.1:8787`, `mcp.mjs --http` behind it.
- **Tunnel:** **ngrok** (`https://<id>.ngrok-free.dev/mcp`). Plan 002's provider table recorded ngrok as
  _"not installed"_ on 2026-08-28 and `localhost.run` as the one that came up; by the time of this run
  ngrok was installed and serving, so the table's verdict is superseded for this phone — the ORDER it
  argues for is not, since it is about which port a carrier allows.
- **Caller:** the agent's container (a different network entirely), `fetch` from node 22, five samples per
  method, no other traffic on the tunnel.
- **Code:** the server as it stood BEFORE this session's protocol change (`serverInfo.version: 1`).
- **Not comparable** to anything else in this folder: this is a network round trip, not a build.

## Round trip, by method

| Method | p50 | min | max | Response bytes |
| --- | ---: | ---: | ---: | ---: |
| `server/discover` | **227 ms** | 219 | 265 | 93 (an error — see below) |
| `map_state` | **235 ms** | 232 | 281 | 119 |
| `tools/list` | **235 ms** | 230 | 492 | 3 496 |
| `initialize` | **444 ms** | 328 | 683 | 145 |
| `phone_state` | **1 378 ms** | 814 | 2 178 | 3 165 |

**The floor is the tunnel: ~230 ms**, and it does not move with the size of the answer — `map_state` at 119
bytes and `tools/list` at 3 496 cost the same. So payload size is not what an agent pays for here; the
number of CALLS is.

**`phone_state` costs six round trips' worth of wall-clock, and it is the tool everything is told to call
first.** The 1.4 s is not transport: it is the panel re-running all sixteen preflight probes — `node -v`,
the dependency staleness check, the game-file and pak stats, two `df`s, the git identity and credential
lookups — on every call. That is the right answer for a person tapping a page once, and the wrong shape for
an agent polling a build. **Not fixed here**: it is the panel's endpoint rather than the MCP layer's, and
splitting it wants its own step. Recorded so the next reader does not diagnose it as tunnel latency.

## What the protocol change costs, in bytes

Measured locally on the same code path (stdio, no network), before and after this session's change:

| Message | Before | After | Δ |
| --- | ---: | ---: | ---: |
| `initialize` result | 145 B | **1 651 B** | +1 506 (the `instructions` block) |
| `tools/list` result | 3 496 B | **5 567 B** | +2 071 (titles, annotations, closed schemas, enums) |

**~3.6 KB, once per session, ≈ 900 tokens.** That is the honest price of the two additions, and it is paid
against: an agent that reads the operating order before its first call rather than after its first refusal,
and a client that can tell the nine reading tools from the three that change something. At 230 ms per call,
one avoided round trip pays for the tool list; one avoided convert pays for a year of them.

## What this run does NOT settle

- **The phone was serving the OLD server** when the round trips were taken, so the `-32022`/`server/discover`
  paths above are the BEFORE state (`server/discover` → `unknown method`, 93 bytes). The after-state of the
  protocol is verified by tests and by a local end-to-end run, not over this tunnel — that needs the phone to
  restart `panel:tunnel` on the new code.
- **No map was attached** (`map_state` → `attached: false`), so nothing here touches `map_snapshot` or
  `map_screenshot`, which are the two calls whose cost is the PAGE's rather than the tunnel's.
