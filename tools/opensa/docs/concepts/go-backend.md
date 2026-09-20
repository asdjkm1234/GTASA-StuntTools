# Concept — Go for the dispatch backend

**Status: LIVE, opened 2026-08-26** at the user's request ("обсуждаем язык Go как бекенд"). Research first,
no code. The two exits are [`docs/plans/`](../plans/README.md) and
[`docs/postmortem/`](../postmortem/README.md).

**Recommendation, stated up front so it can be argued with: do not rewrite PCAD's backend in Go, and do not
close the door on Go either.** There is exactly one component where it would pay, it is greenfield, and it
can be deleted without touching anything that works.

---

## 1. What exists today

The backend is **not ours and not hypothetical** — it is built, deployed and carrying real users. Read from
the code on 2026-08-06 and recorded in [plan 202](../plans/202-pcad-dispatch/readme.md):

| Piece | What it is |
| --- | --- |
| Transport | Node.js `ws` server on `:8443` |
| Store | MariaDB (`caddata`) |
| Auth | bcrypt + JWT, behind a Discord.js role gate |
| Services | Unit (~1.1k lines), TacticalAssist, RMS, Radio, Discord; `server.js` is **~4.1k lines** |
| Game client | MoonLoader Lua over `websocketsamp.dll` — a WebSocket client, and not negotiable |

Plan 202's central correction applies directly here: **the dull half is behind us, not ahead.** The
remaining work is the map. A backend rewrite is the single most expensive thing available and it buys no
user-visible feature.

---

## 2. The argument that does not apply: throughput

Go's usual case is concurrency under load. This workload has none. From the same reading of PCAD:

| Fact | Value |
| --- | --- |
| Position publish rate, per unit | **every 4 s** |
| Status broadcast, per unit | every 15 s |
| Heartbeat | 20 s |
| Units on a busy SA-MP server | ~150, order of magnitude |

That is **~37 position messages per second at 150 units**, plus ~10 status messages. Fan-out to a handful of
dispatcher browsers multiplies the egress, not the ingest. Node is not near a limit at this scale and
neither is anything else; a language chosen for throughput here would be chosen for a problem we do not
have.

[project-goals](../project-goals.md) is explicit that better must be **demonstrated, not assumed**. Nobody
has produced a measurement showing the current backend is the constraint, and the numbers above suggest
nobody will.

## 3. The arguments that do apply, honestly

- **One static binary.** PCAD is self-hosted by server owners. A single artifact with no `node_modules` is a
  genuine operational improvement for the person installing it — and the development machine is an Android
  phone in Termux ([termux.md](../development/termux.md)), where `pkg install golang` works and cross-
  compiling is easy. This is real, and it is worth less than a rewrite costs.
- **A typed event contract.** Go structs plus generated JSON would enforce the shape of the event stream.
  But the web application is TypeScript, so today that contract can be a shared `.d.ts` at zero cost; across
  a Go boundary it needs code generation, which is a new build step rather than a saving.

## 4. Where Go WOULD pay, and it is not the backend

**The dispatcher's read path**, if and when it is split out. Plan 202 §4 leaves the transport deliberately
open — *"the contract comes before the transport… what a reconnect replays"* — and the browser's half of it
is nearly pure server→client fan-out (see the rates above; the client sends only rare assign/create calls).
That component:

- is **greenfield**, so nothing working is put at risk;
- **validates the existing JWT** rather than owning auth, so the Discord role gate — the deepest and most
  dangerous part of `server.js` — is not touched;
- has one narrow contract, so it can be **deleted** and replaced by the Node path if it does not pay;
- is where **SSE** would be evaluated (browser-native reconnect, `Last-Event-ID` replay), while the game
  client keeps WebSocket because `websocketsamp.dll` speaks nothing else.

That is the only shape in which Go enters this stack without a rewrite.

## 5. What would have to be true to graduate this

The concept moves to `docs/plans/` only when **all** of these hold, and dies to `docs/postmortem/` if the
first one is answered and the answer is "no":

1. A measurement shows the Node read path is a real constraint — CPU, memory or tail latency under a
   realistic unit count — rather than an aesthetic preference. Recorded in
   [`docs/benchmarks/`](../benchmarks/) per its schema, as every performance figure in this repository must
   be.
2. The event contract is written down and stable, so a second implementation of it is a port rather than a
   redesign.
3. Somebody other than an agent is willing to maintain a second toolchain on a phone.

## 6. Scope note

**The backend lives in `sexorcist00/pcad`, not here**, and that repository is private and outside this
session's scope. This repository owns exactly one component of the product — the 3D map — and its seam is
the shell↔map interface, not the transport ([202 §4](../plans/202-pcad-dispatch/readme.md)). So this
concept is a recommendation to the other repository's owner, and nothing in it is actionable here.

## 7. What is decided

Nothing yet — that is what LIVE means. What is recorded is the recommendation in the first paragraph and
the three conditions in §5.
