# phone-console

**The field-run panel for the phone the work is done on.** One page, served from Termux, that runs the
rituals `scripts/phone.sh` already knows, says why a run will not start before it is started, and files what
the run measures straight into `docs/benchmarks/`.

```bash
npm run panel          # → http://localhost:8787
```

Open that on the phone and add it to the home screen — it carries a manifest, so Android installs it as an
app and it opens full-screen. Nothing else has to be typed after that.

## Why it exists

The development machine is a phone ([termux.md](../../docs/development/termux.md)). Every number 201 still
owes is gated on a ritual typed into a terminal with no keyboard worth the name, and two things went wrong
there over and over: a run that did not start for a reason buried in a log, and a measurement that reached
the next session as a chat paste with its conditions missing — the case
[`docs/benchmarks/readme.md`](../../docs/benchmarks/readme.md) opens by warning about.

So the panel does exactly two jobs: **make a run one tap**, and **make its result a committed file**.

## What it is made of

| File                | What it does                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `server.mjs`        | the HTTP server: the page, the state endpoint, the log stream, the job routes, the capture inbox |
| `doctor.mjs`        | the preflight checks, as pure decisions over an injected probe                                   |
| `jobs.mjs`          | which commands may run, which env each accepts, and the one-at-a-time rule                       |
| `captures.mjs`      | the naming, the note stamping and the commit plan — pure, and the tested half                    |
| `capture-store.mjs` | the filesystem half: where a capture and a tile archive may land                                 |
| `app/`              | the page, its manifest, a pass-through service worker and the icon                               |

**Plain `.mjs`, no dependencies, no build step — deliberately.** This is the thing that must come up when the
tree is broken, since its first job is to report that `node_modules` is stale or `tsx` is missing. A panel
that needed either to boot could not say so. Same reasoning as [`bench-harness`](../bench-harness), which is
plain node scripts for the same class of reason.

## What it runs

Nothing of its own: `git pull --ff-only`, `npm run phone:setup`, `npm run phone` (with the knobs the page
offers — district, output folder, texture format, whether models are converted) and `scripts/district.ts`.
`scripts/phone.sh` is 369 lines of measured knowledge about this device, and a second copy of it inside a web
server would be a second thing to keep true.

**`Baked 3D city map` is the third convert** (201/6-01): `LODONLY=1`, which welds the cell LOD tier and skips
the HD one, into its own `-map3d` folder. It is a mode the operator picks rather than a frame that gave up —
the LODs are a simplified city already, and it is where the console's hardest budget (150 units with models)
is close to free. Its folder is separate for the same reason `Map only`'s is, below.

**`Map only` is the same ritual with the model half taken out**, because "just the ground" is the run that is
wanted most and the one nobody remembers how to ask for. It forces `MODELS=0` (no vehicles, no peds, no model
archives rewritten — the pak the map reads contains none of them) and `BAKE=0` (with no models there is
nothing to run physics, so the collision bake is work whose product this run cannot reach), and the page
cannot buy either back: the forced values are applied last, after the form.

It also converts into its **own** folder — the one in the field with `-map` appended, and the field follows
along so the links below open the right pak. That is not tidiness either: `phone.sh` checks an existing pak
against the recipe it was asked for and refuses when they differ, so a map-only run pointed at a full pak's
folder would serve nothing, and forcing a rebuild instead would throw the full pak away on every press.

**The log survives the kill, because the panel does not.** Every job line is appended to
`build/.phone/panel-jobs.log` as it is printed, unbuffered — the ring buffer lives in the panel's memory, and
on this device the thing that kills a convert kills the panel holding the record of it, so "where did it die"
used to be answerable only by watching it happen. A panel that comes up with nothing running replays the tail
of the previous session into the log pane, marked as such.

**A convert that Android killed is resumed, not restarted.** This device kills Termux with the screen on and
the app merely backgrounded, so a run dying part-way is the normal case here. `scripts/phone.sh` journals
every weld chunk and re-enters at the last finished one, and preflight says _"unfinished convert"_ when a
journal is sitting there without a pak — so the answer to "did I lose the forty minutes" is on screen before
it is asked. What to change on the phone so it stops happening is in
[termux.md](../../docs/development/termux.md).

**One job at a time**, and the refusal names what is running. Two converts at once on a phone is an OOM and
two paks welded into one folder.

## The runs the page opens

Every link is the ritual with its query already right, because a query typed on a phone is a query that does
not get typed:

| Link                        | What it opens                                                                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **The map**                 | the console on the pak that was just built                                                                                                                                                                                     |
| **Map + inventory capture** | the same, with the collector on                                                                                                                                                                                                |
| **THE FIELD RUN**           | the board at the count 201 declared — `units=150&calls=40&inventory=1` — which is what [2/03](../../docs/plans/201-dispatch-console/2-real-device-truth/readme.md) owes and what every number 5/02 and 5/04 owe is measured AT |
| **The engine alone**        | the field run's A/B partner — the same board and collector with `?overlay=0`, so the window prices the ENGINE rather than the symbology drawn over it (201/2). The pair is two links rather than one typed twice, because two halves typed by hand differ by something nobody wrote down                                  |
| **The flat 2D map**         | `mode=flat`, the no-WebGPU surface                                                                                                                                                                                             |
| **Bake the tile pyramid**   | `bake=tiles`, z0–z4                                                                                                                                                                                                            |
| **The shareable console**   | `Build it` runs `npm run build:share:dispatch`, and the link opens that ONE file on a real pak — the check a build log cannot make ([2/02](../../docs/plans/201-dispatch-console/2-real-device-truth/readme.md))               |

**An agent opens them too, since 2026-08-28** — `phone_run open` with `LINK=field` (or `map`, `inventory`, `engine`,
`flat`, `bake`, `share`). It was the last step in the measurement loop that still needed a person holding the
phone: everything after it was already a tool call, but a page has to EXIST before any of it. It is a JOB
rather than an MCP tool deliberately — the job table is read by the panel, which restarts for free, while
`mcp.mjs` runs beside the tunnel whose address every open session is holding, so a new tool costs a session.
It needs `pkg install termux-api` and the Termux:API app (the package alone does nothing), and says so by
name when they are missing. The addresses come from `app/links.mjs`, which this page reads too: two copies of
that rule is how an agent opens a URL that differs from the one on the screen beside it.

## The same panel, as an MCP server

```bash
npm run panel:mcp                       # stdio — a Claude running ON this phone
node tools-debug/phone-console/mcp.mjs --http --port 8788   # JSON-RPC over POST, token-gated
```

`mcp.mjs` exposes what the page's buttons expose — `phone_state`, `phone_jobs`, `phone_run`, `phone_log`,
`phone_stop`, `phone_commit` — so an agent can drive a measurement without a person relaying the screen.
**It is a client of the running panel**, not a second copy: one `JobRunner` on the phone, or two converts
fight over one folder. With the panel down, every tool says so rather than starting anything.

It also reaches the **map page itself** — `map_state`, `map_snapshot` (the whole `?inventory=1` report plus
the live readout and the errors), `map_screenshot` (a PNG, returned as an image), `map_goto`, `map_mode`,
`map_board`, and `map_release` when it is done with it. The page answers because the panel's links carry `&agent=1`; nothing else does, so a shared link
or a desk run never phones a panel. **No DevTools protocol and no `adb`**: the numbers are the ones the
console already computes and the picture is the one it already composes for a share link.

**`map_open` puts the console on the phone's screen**, which is the one thing every tool above could not do:
they all talk to a page somebody had already opened, so `"no map is attached"` stopped a field run until a
person tapped a link. It launches the panel's own URL through `termux-open-url` — any of the six links in
the table above, by name — and waits for the page to phone home, so a browser that started is reported as
a launch and only an attached console is reported as a map. A console already attached is left alone rather
than covered with a second tab. Without `termux-open-url` (`pkg install termux-tools`) it says so and hands
back the URL; the doctor warns for it rather than failing, because a thumb still works. **The links it opens
and the links the page hands out are built by one module** (`app/links.mjs`): two copies of that
arithmetic would open different paks, and the capture would name the one nobody was looking at.

**`map_release` gives the phone back.** The one tool here that talks to the OPERATOR rather than to the
agent, and it exists because of what this channel costs them: the console has to stay the foreground tab
while it is being driven, so a run is somebody sitting still holding their own device with no idea how long
for. It posts the release into the page — the band across the top of the console turns from _keep this tab in
front_ to _done, you can switch away_ — and buzzes the phone through Termux:API (`termux-vibrate -f`, so it
lands through silent mode) with a notification carrying whatever the agent said it was doing. The buzz is the
optional half: Termux:API is a separate add-on app, the doctor warns when it is absent, and the band still
says the run is over without it. Call it when the last measurement is taken, not when the conversation ends.

**It needs Termux allowed to display over other apps, and nothing reports that for you.** Android forbids a
background app from starting an activity, and `termux-open-url` exits 0 when the system discards one — so on
the phone run of 2026-08-28 three opens returned "launched, nobody arrived" while the screen never changed.
Granting it once makes the launch work; until then this tool is a URL somebody has to tap. The second half of
the same device fact: **the console has to stay the foreground tab** while it is being driven. Android freezes
a background tab, the page stops polling, the panel reports it detached after 15 s, and a command already
handed over is never answered.

`phone_exec` (a real shell) is **off unless `PANEL_MCP_EXEC=1`**, and the HTTP transport binds localhost and
requires a bearer token: reaching it from off-device is a tunnel somebody sets up on purpose, and a tunnel
with no token is a shell on the open internet. The design, the transports and what is verified where:
[docs/plans/002-mcp.md](docs/plans/002-mcp.md).

**It speaks both eras of the protocol** (`mcp-protocol.mjs`, 2026-08-28). A client that opens with
`initialize` is answered in ITS revision — `2025-11-25` through `2024-11-05` — rather than in the one this
server was written against; a client that sends `server/discover`, or declares a revision in a request's
`_meta`, is served statelessly, and one that names a revision we do not speak is refused with `-32022`
listing the ones we do, so it can retry instead of giving up. There is no session state on either side to
make that hard: every tool call is already a fresh hop to the panel.

**A malformed byte used to kill the server.** `JSON.parse` sat in the socket's data handler here, in the
bridge, and in the HTTP transport's `end` handler, so one bad line — which is what a tunnel produces when it
half-closes a connection mid-body — took the process down and every tool in the session with it, costing a
NEW session to get back. It now answers `-32700` and reads the next message. A JSON-RPC batch is answered as
a batch too; it used to be dropped in silence, because an array carries no `id`.

**What the tools ARE is now said out loud**, because compatibility only gets an agent connected. The rules
that are not visible in any signature — read `phone_state` first, one job at a time and `phone_run` returns
at the START, `map_state` before any `map_` tool and `map_open` when it answers that none is attached — ride the
handshake as `instructions`, including from the bridge when there is no phone at all. Every tool carries a
`title` and its behaviour annotations (an unannotated tool is read as destructive and open-world, which is
wrong for the nine that only read), the no-argument tools state a closed schema, `map_mode`/`map_goto`
enumerate the words they take, and every JSON answer rides as `structuredContent` beside its text.

**Restart `panel:tunnel` after pulling this** — a running server keeps serving the code it started with, so
the tunnel hands out the old handshake until it is restarted. What the channel costs, measured through the
phone's own tunnel: [the round trip](../../docs/benchmarks/tools/2026-08-28-phone-mcp-round-trip.md).

### Wiring it to a Claude that is not on this phone

```bash
npm run panel                # session 1 — the panel itself
npm run panel:tunnel         # session 2 — the MCP server + a tunnel, and the two values to paste
```

`panel:tunnel` starts both and prints one block: the public URL (with `/mcp` already on it) and the token.
**The token is made once and kept** in `build/.phone/mcp-token`, so a restart re-pastes one value rather than
two. The address can be made to stop moving as well — see the three findings below.

**Five providers, tried in order, because the network gets a vote.** 2026-08-28 on this phone, cloudflared's
own pre-check failed both ways — `UDP Connectivity … QUIC connection failed` and `TCP Connectivity … HTTP/2
is blocked` — while `api.cloudflare.com:443` passed. The carrier allows 443 and blocks **7844**, which is the
only port cloudflared reaches its edge on, in either protocol; no config setting gets around that. So the
order is by what survives a restrictive network, not by preference:

| Provider        | Reaches its edge on             | Needs                                                                                                                     | On this phone, 2026-08-28     |
| --------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `ngrok`         | 443 (TLS)                       | a free account — the linux-arm64 binary in `$PREFIX/bin`, `ngrok config add-authtoken <yours>`, and the DNS wrapper below | **worked**                    |
| `localhost.run` | 22 (SSH)                        | `pkg install openssh` — no account, no key                                                                                | **worked**                    |
| `pinggy`        | 443 (SSH, asked for explicitly) | `pkg install openssh` — no account                                                                                        | asked for a password          |
| `serveo`        | 443 (SSH, asked for explicitly) | `pkg install openssh` — no account                                                                                        | connection closed by the host |
| `cloudflared`   | **7844** only                   | `pkg install cloudflared` — and a network that allows 7844                                                                | cannot reach the edge         |

The order changed once the phone had a verdict: `localhost.run` is ahead of the two 443 providers because it
is the one that came up, and every ssh provider carries `BatchMode=yes` — pinggy fell through to a password
prompt on a phone with no key and spent the whole timeout waiting for a person to answer a prompt they could
not see was one.

**ngrok connects here, but only after two things that both look like a network problem.** Measured
2026-08-28 on this phone, the day the account-less providers turned flaky and cloudflared stayed unreachable:

1. **It resolves no names.** Android ships no `/etc/resolv.conf`, and ngrok is a static Go binary carrying its
   own resolver — it finds no file, falls back to `127.0.0.1:53`, and nothing listens there, because a port
   under 1024 is not bindable by an app uid. Every dial failed with `lookup connect.ngrok-agent.com on
[::1]:53: read: connection refused`, which reads exactly like a carrier blocking 443. The fix belongs to
   the phone rather than to this script — a `proot` wrapper that hands the binary a resolv.conf, in
   [termux.md](../../docs/development/termux.md) under _Practical notes_. `netlinkrib: permission denied` in
   the same log is unrelated and harmless.
2. **The address it hands out is a `.dev` one now.** `https://prowling-volumes-smooth.ngrok-free.dev` — and
   `tunnelUrl` knew only `ngrok-free.app`, so a tunnel that had already printed `client session established`
   and `started tunnel` was given up on 45 s later as _"printed no working address"_ and killed on the way to
   the next provider. The pattern takes `ngrok-free.{app,dev}` and `ngrok.{app,dev,io}` since. **A provider
   that changes its domain again fails in exactly this shape**, and it is silent in the worst way: the
   provider's own log says it is up while the script says it is waiting. That disagreement is the symptom to
   read.

`TUNNEL=pinggy` (or any other name) forces one. None installed is not fatal: the MCP server comes up anyway
and the block names the localhost address, which is what a Claude running ON this phone wants.

**An anonymous tunnel's address can change under you.** localhost.run hands out a new one on every
reconnect — 2026-08-28 the block named `1799d46bfdb9ba.lhr.life` and fourteen minutes later the log carried
`ceb8689e34376a.lhr.life`, with nothing to mark that the pasted value had died. A new address after the
block has been printed now reprints it, under a line saying the previous one is dead.

**Then it happened for real, mid-measurement, and cost the session** (2026-08-28). The provider said exactly
why, in one line nobody was watching: `Received disconnect … tunnel inactivity timeout`. An agent's tunnel is
idle by nature — it carries a burst of calls and then nothing while the agent reads what came back — so the
quiet is the normal state, not a sign anybody has finished. Three things came out of it, and each is a
separate failure:

- **It goes quiet, so it is kept warm.** One request a minute through the tunnel (`GET /mcp`, which the
  server refuses with 405 — traffic without carrying anything or needing the token).
- **A dead tunnel was SILENT.** A provider that exits after being announced hit a guard that had already
  settled, so nothing was printed and nothing was restarted: the address stayed in the agent's environment,
  every call answered `no tunnel`, and the phone's screen said nothing had happened. It now says so and
  reconnects.
- **A moving address costs a SESSION.** The address is read at session start, so every reconnect used to
  mean pasting a new value and starting over — which, with automatic reconnection, would now happen more
  often rather than less. Two ways to stop it moving, and the block prints both when neither is in place:
  `ssh-keygen -t ed25519 -N '' -f ~/.ssh/id_ed25519` (a keyed localhost.run connection keeps its subdomain,
  where `nokey@` is handed a fresh one) or `NGROK_DOMAIN=https://<yours>.ngrok-free.app` (a free ngrok
  account reserves one). The key is used automatically once it exists.

**An address is not a tunnel, and the first version of this script believed it was.** cloudflared printed
`Your quick Tunnel has been created!` with a `trycloudflare.com` address, the script printed the paste block,
and every dial to the edge failed afterwards — the address was dead and the block said it was ready, which
is worse than no address at all. So a provider is announced only once it says it is **connected**
(`Registered tunnel connection`; for an SSH provider the address arrives on a connection that is already up,
so printing it is the proof), one whose own diagnostics say it cannot connect here (`hard_fail=true`) is
dropped on that line rather than after the timeout, and anything still not up after 45 s is given up on **by
name** and the next is started.

Keep that session open: closing it closes the tunnel.

Then set two environment variables on the Claude Code environment (Settings → the environment this session
runs in) and **start a new session** — MCP servers are read at session start, never mid-conversation:

| Variable             | Value                                      |
| -------------------- | ------------------------------------------ |
| `OPENSA_PHONE_URL`   | the address the block printed, with `/mcp` |
| `OPENSA_PHONE_TOKEN` | the token beside it                        |

**`.mcp.json` names neither.** It runs `mcp-bridge.mjs`, a stdio server that reads both at RUN time and
forwards each call to the phone — and that indirection is the fix for a real failure, not a layer for its own
sake. The config is parsed before anything runs, and a `${VAR}` that is not set is left _unexpanded_ by
Claude Code: a `url` of `${OPENSA_PHONE_URL}` reaches the client as that literal text and the entry is
refused whole — `INVALID_CONFIG: 'url' is not a valid URL` (2026-08-28). `${VAR:-default}` did not help.
Worse, that failure is at load, so it takes a NEW session to clear — the exact cost this panel exists to
remove. Through the bridge the session always loads: with the variables set the tools are the phone's, and
without them the server lists no tools and says what to set. **The URL and the token are still never
committed** — a quick tunnel's address changes every restart, and a committed token is a leak that outlives
the session that leaked it.

**A public tunnel is a public URL.** The token is what stands between it and a stranger, which is why the
server refuses an unauthenticated request rather than answering it. Stop the tunnel when the session is over;
the next one gets a new address anyway.

## What it checks before you start

`node` · **git identity** (a phone that has only ever pulled has none, and every commit then dies with
_"Author identity unknown"_ — which git says only when one is attempted) · dependency **staleness** (a pull that added deps, the rule `phone-setup.sh` learned the hard way) ·
`tsx` · **`sirv`** (the static server's dependency, and therefore whether the pak can be served at all) ·
the game files · **GAME vs OUT resolving to one folder** (2026-08-09: the convert rewrote the archives it was
reading) · the pak and what it was built from · the two run ports · free space on **both** filesystems (the
repo is on internal storage, build output is routinely a symlink into shared) · the branch · the wake lock.

**push credentials** — an https remote with no credential helper anywhere fails with _"could not read
Username"_, and only when a push is attempted. Read from configuration, never by asking the network.

Each check says what to do about it. The verdict is one line at the top.

## The capture inbox

**Since 2026-08-27 the map files its own capture and nothing is typed.** The console's readout carries a
`file to the panel` button — it appears only when a panel answers — and it POSTs the report here with the
conditions only the MAP knows: which district, which mode, how many units were on the board, and the query
the run was opened with. This server adds what only IT knows (the pak's own recipe, the device, node) and
writes the file. The round trip that used to be _copy the JSON → leave the map → switch apps → paste → type
a name_ is now **one button in the map and one here**, and it is the step where a measurement was actually
being lost: the README opened by warning about captures that arrive as a chat paste with their conditions
missing, and a paste is exactly what a phone makes hardest.

The paste box stays for everything else — a capture from another device, an older report, a run the map
could not file because the panel was not up.

Either way the panel writes `docs/benchmarks/opensa-engine/<date>-<name>.json`, **stamping the conditions it
can prove** into the note rather than trusting them to memory. `Commit & push` then files it on the current
branch.

**What is waiting to be committed comes from git, not from this page.** The panel used to remember what it
had filed in the browser's own memory, so a reload, a restarted server or a phone that put the browser to
sleep left a written capture the panel then refused to commit — because it had forgotten writing it. The
section lists whatever is uncommitted under `docs/benchmarks/opensa-engine/`, whoever wrote it and whenever.

**A push that failed is not a dead end.** `Push` sends what is already committed — after a push that died
for its own reasons (no credentials, no network), the capture is in the repository and the remote is not,
and the commit button has nothing new to file. Preflight counts what is unpushed; so does the button.

Two refusals, both on purpose:

- **a capture with no note is refused** — a row nobody can place is a row nobody can compare;
- **the commit names only the files the panel wrote**, and only under `docs/benchmarks/opensa-engine/`. This
  panel files data, never code, and a dirty worktree on a phone cannot ride along.

A baked `tiles.pmtiles` ([201/6-02](../../docs/plans/201-dispatch-console/6-display-modes/readme.md)) goes
through the same section and lands beside the pak — checked for the format's magic first, because an HTML
error page saved under that name makes the flat map draw nothing, which looks exactly like a map that has not
loaded.

## What it does NOT do

- **It does not expose anything.** The server binds `127.0.0.1`; a page that runs commands is a shell, and a
  shell must not appear on the LAN because it was convenient. `PANEL_HOST=0.0.0.0` opts in and the startup
  line says what that means.
- **It is not reachable from outside the phone**, so nobody's session connects to it. The loop with an agent
  closes through the repository: the panel commits and pushes, the next session reads the branch.
- **It caches nothing.** The service worker exists so Android offers "install"; a cached shell showing
  yesterday's preflight would be worse than no icon.

Plans for the panel itself: [`docs/plans/`](./docs/plans/).
