# 06·1·04 — The path sidecar: extensions the original format cannot carry

[← chain](../readme.md) · prev: [03 population data](03-population-data.md) · next: [05 editor](05-path-editor.md)

Decision D2 keeps `nodes*.dat`/`tracks*.dat` canonical and **spec-conformant forever** — a file our
editor touched must still load in vanilla SA, in SA's own tools, and in every third-party path tool.
Everything beyond the original spec therefore lives in ONE sidecar file this plan defines.

## What goes in the sidecar (and nowhere else)

| Extension | Consumer | Why the original can't carry it |
| --- | --- | --- |
| Intersection records: node group + light PHASE TABLE (phase → green links, durations, all-red gaps) | 2/03 controllers, editor, ASI | SA has only a per-node "light" flag + a global timer |
| Rail: station nodes, per-route schedules (departures, stops, dwell, speed segments), crossing bindings (track window ↔ barrier objects ↔ gated links) | 4/01, 2/03 | `tracks*.dat` is bare polylines |
| Density overrides: per-zone paint over the popcycle import (1/03) | sim, editor | popcycle is per zone-TYPE, not per zone |
| Curve smoothing: bezier control points on links where ring-0/1 want curvature | 2/01, 2/02 | SA links are straight polylines |
| Authored routes (scripted/parked-style persistent routes) | 2/01 | no such concept |
| New path KINDS if ever needed (user: "extra types for our version") | future | by definition |
| Zone-type overrides for mod maps | 1/03 | `info.zon` type column is dead |

## Format decision

- **JSON, versioned, one file per game**: `data/paths/citylife.json` (name final after contracts
  review). Rationale: authored by the editor, read at boot alongside a 3.5 MB parse — there is no
  measured need for a binary layout; a binary compile becomes a deferred optimization with a price tag
  if boot cost ever says so (`docs/performance/` discipline). JSON also IS the debug twin the old plan
  wanted.
- References into the original graph use **stable keys**: `(area, nodeId)` for nodes, `(area, nodeId,
  linkIndex)` for directed links — the same keys SA's own graph uses, so the ASI (reading `ThePaths`)
  and the engine (reading files) resolve identically. NO content hashes: a mod editing a node must not
  orphan every sidecar reference (dangling refs are instead validated loudly at load).
- Versioning copies the streaming-formats contract: unknown MAJOR rejected loudly; minors add optional
  sections only.
- Ships through the normal pipeline untouched (loose `data/` group); a mod may ship its own via the
  standard mod-folder overlay — later mod wins, exactly like every other data file.

## Failure semantics (contracts rule: say what a misspelling does)

- Missing sidecar → city-life runs on originals-only defaults (auto-derived light phases per 2/03,
  imported densities, no schedules → default train timetable). The sidecar is an ENHANCEMENT, never a
  requirement — a stock install with the ASI and no sidecar must still work.
- Dangling node/link refs → the referencing record is dropped with a named warning
  (`[citylife] sidecar: N records dropped (stale refs)`); never a silent partial apply.
- Unknown minor sections → ignored; unknown major → the whole file refused, loudly, features degrade to
  the missing-sidecar path.

## Goals gate

1. *Authored data:* originals stay untouched and fully honoured; the sidecar only ADDS.
2. *Original:* has no extension mechanism at all — this is ours by construction.
3. *Better:* mod authors get an editable, documented city-behaviour layer vanilla never had; proven by
   the editor round-trip (1/05) and the controllers consuming it (2/03).
4. *Cost:* boot-parse only; validated size budget recorded when the stock-map sidecar exists.
5. *Contract:* this plan's main deliverable IS the contract — `docs/contracts/paths.md` (new subject
   file): the sidecar name, its schema, its keys, and the misspelling/failure semantics above, plus the
   `data/paths/*` reading rules the engine already relies on.

## Tasks

- [ ] Schema (typed, versioned) + loader with the failure semantics above (+ negative-first tests).
- [ ] Loud validation pass (dangling refs, phase-table sanity: every controlled link reachable, no
      always-red lane).
- [ ] Defaults derivation stubs so consumers work sidecar-less from day one.
- [ ] `docs/contracts/paths.md` in the same change; row in contracts README.
- [ ] Record the stock-map sidecar's size + boot cost once 1/05 authors one.

## Measured numbers

- Sidecar load + validate (ms), stock map: —
