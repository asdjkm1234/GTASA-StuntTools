# CAD depth — what the dispatch console is missing to be a real system

The console ships in 0.5.0 as a real map with a **mock desk**: the world, the streaming, the picking and the
operator chrome are real; the operations feed is a client-side simulation. That was the right cut — it made
the surface exist and proved the engine embeds — and this is the list of what a working dispatch system has
that a mock does not.

Deferred by decision on 2026-08-06, not by difficulty. Each item is a blurb, not a step chain; the chain gets
written when the cycle picks it up. The 0.5.0 half is [plan 201](../../../../plans/201-dispatch-console/readme.md).

## The live operations feed — contract first

`stepOperations` (`apps/dispatch/src/ops/sim.ts`) is a pure, unit-tested reducer that moves units,
auto-dispatches, ages calls and trickles new ones. Its header already names the seam: *when this app is wired
to a game server, `stepOperations` is what gets replaced by the socket handler; nothing else in the app
changes.* There is no networking anywhere in this repo today — not a WebSocket, not a poll.

The source is known as of 2026-08-06: a **native CAD plugin** on the client side is what raises calls and
carries the dispatcher's traffic to the units. The console stays a separate web application beside the game
and consumes what that plugin publishes.

So the first deliverable is not a server, it is a **contract**: the event and snapshot shapes, what a
reconnect replays, how often a unit's position is published (chain 8's interpolation is written against that
rate), and what an operator sees when the feed is stale rather than empty. Written into
[`docs/contracts/`](../../../../contracts/) so the plugin and the console can be built separately, against
something rather than against a guess.

### The transport, evaluated 2026-08-27 (SSE vs WebSocket, and whether Go)

Asked when the publish interval drops below 4 s. The short answer: **at the rates this product can actually
use, the transport is not what costs bytes — the ENCODING and the CADENCE are** — and the map has a ceiling
of its own that decides the rate before the network does.

**The map cannot use more than ~2 Hz, and that is a measured property of this console rather than an
opinion.** It draws on demand ([201/4-01](../../../../plans/201-dispatch-console/4-a-console-is-not-a-game/readme.md)):
a frame happens when the board changes. The 08-23 field capture drew 605 frames and **skipped 599** — that
idle half is the whole battery result, and a 10 Hz feed spends it, because every distinct board is a full 3D
frame on a phone. So whatever the feed does, the console coalesces fixes to its own redraw budget, and there
is no point publishing faster than that. What a faster rate *does* buy is the stepping complaint 202 §4 names:
a car at 100 km/h moves **110 m** between fixes at 4 s, **28 m** at 1 s and **14 m** at 2 Hz — which retires
it without anyone interpolating anything.

**Arithmetic, not a measurement** (150 units, worst case = every unit moving; one batched message per tick;
a fix is id + x/y/z + heading + status). Compact JSON ≈ 58 B/fix, binary ≈ 15 B/fix (id u16, x/y int32 cm,
z int16 dm, heading u16, status u8), gzip-over-JSON estimated at 4–6× on payloads this repetitive:

| Publish rate | fixes/s | JSON raw | JSON + gzip (est.) | binary | 8 h shift, binary |
| --- | --- | --- | --- | --- | --- |
| 4 s (today) | 37.5 | 2.2 kB/s | ~0.45 kB/s | 0.56 kB/s | 16 MB |
| 1 s | 150 | 8.7 kB/s | ~1.8 kB/s | 2.25 kB/s | 65 MB |
| 500 ms | 300 | 17.4 kB/s | ~3.6 kB/s | 4.5 kB/s | 130 MB |
| 100 ms | 1500 | 87 kB/s | ~18 kB/s | 22.5 kB/s | 648 MB |

Read it as three levers, in the order they matter:

1. **Send only what MOVED.** Most of a shift, most units are parked — the same fact the track ring already
   exploits (a stationary run collapses to its two ends). This halves or better, and it is bigger than any
   choice below it.
2. **One message per TICK, not per unit.** Framing is per message (WS 2–6 B, SSE 8 B + text escaping), and on
   a phone the radio state matters more than the bytes: 150 little messages a second hold the radio awake in
   a way one batched message does not.
3. **Then, and only then, the transport.**

**SSE is the recommendation, and the reason is not bandwidth.** At 1 Hz both transports land in the same
order of magnitude once the two levers above are pulled. What separates them is what happens on a phone that
changes network: `EventSource` reconnects by itself and replays from `Last-Event-ID`, so a shift's track does
not acquire a hole when the operator walks out of WiFi. It rides the same HTTP/2 connection as the rest of the
app, gzip applies to the whole stream with a shared dictionary (which is why the gzip column above is
competitive with raw binary), and no middlebox treats it as anything but a slow GET. Its cost is that it is
text: binary needs base64 (+33 %, and base64 does not gzip well), which is exactly why the recommendation is
**compact JSON + gzip rather than binary-over-SSE**. Commands go the other way as ordinary HTTP POST — they
are rare, they want auth, idempotency and retries, and they do not belong in a stream.

**WebSocket wins when one of two things becomes true, and neither is today:** the bytes actually bind in the
field (a measurement, from the phone, not this table), or the client needs a continuous upstream — a viewport
or area subscription, so the server sends only the units on screen. If the second one arrives it decides the
matter on its own, and the switch is one module by construction (`stepOperations` is the seam).

**Go: not justified by load, and out of this repository's scope.** The work is 150 fixes a second fanned out
to a handful of operators — three orders of magnitude below where a runtime choice starts to matter; Node's
`server.js` is nowhere near its limits. Go earns a place at thousands of concurrent streams, or for a single
static binary if that is the deployment preference — an ops argument, not a performance one. And
[202](../../../../plans/202-pcad-dispatch/readme.md) is explicit that this repository owns exactly one
component, the 3D map: what we owe the backend is the **wire contract**, not its language.

**What the console owes the contract, whatever transport wins:**

- **Rate-agnostic client.** The map must not care whether fixes arrive every 4 s or every 200 ms. Two
  constants now say so (`PUBLISH_INTERVAL_MS` = the feed's, `RECORD_INTERVAL_MS` = ours): a faster feed
  improves the live picture and never grows the history. They were ONE constant until 2026-08-26, which
  would have made "the rate is 1 s now" a silent **18.4 MB → 73.4 MB** of track memory on a phone.
- **Resume semantics.** What a reconnect replays — the snapshot plus everything since a sequence number —
  because the alternative is a track with a hole in it that no consumer can see.
- **Staleness derived, never restated.** The screen's *aging* threshold is one publish interval
  (`FIX_FRESH_MS`), so a rate change moves it automatically rather than marking every unit stale.

Note what is **not** deferred: the client-side time axis moved forward into
[201/8](../../../../plans/201-dispatch-console/8-the-time-axis/readme.md), because where time lives in the
data model is cheap to decide now and a rewrite to decide late.

## Routes that are real paths, not bearings

Routes are drawn as straight lines today, and that is honest rather than lazy: the vehicle node graph lives in
`data/Paths` and is **`original`-only** — a total conversion ships none
([assets-and-data](../../../../restrictions/assets-and-data.md)) — so a route line would silently lie on half
the games we run. A bearing that admits to being a bearing beat that.

Real routing needs the graph question answered first: what a game without `data/Paths` gets, and whether the
sidecar the [city-life chain](../../../0.5.0/plans/06-city-life/readme.md) is already designing for this case
too. Note also what the graph does **not** say — travel direction (0 one-way links parsed) and gradient.

## History beyond the current shift

Scrubbing **within a shift** is no longer deferred — it lives in
[201/8](../../../../plans/201-dispatch-console/8-the-time-axis/readme.md), client-side, needing no storage.
What stays here is everything that outlives the browser tab: persisting events across shifts, an incident
archive, and search over it ("what did we see at 14:20 last Tuesday"). That needs a server that keeps the
log, which is the same server the live feed needs — so the two arrive together or not at all.

## Multi-operator

Two or more consoles on the same board: assignment conflicts, ownership of a call, and who wins when both
dispatch the same unit. Blocked on the feed contract above — there is nothing to share state through until
that exists.

## Install and offline

A dispatcher on a phone wants the console on the home screen and the map available when the network is not:
install (PWA), an offline cache over the pak's already content-addressed chunks, and an honest statement of
what works without a connection. Deliberately out of 0.5.0's console chain, which stops at "excellent in a
browser tab on a real phone".
