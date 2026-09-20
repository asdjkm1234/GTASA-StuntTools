# Documentation

How we work with docs. The guiding principle: **a direction earns more structure as it earns more certainty.**
A vague thought is an *idea*; a vetted-but-unbuilt one is a *concept*; a decided one is a *plan*. Nothing is
deleted when it dies — it becomes a *postmortem* so the dead-end is never re-run.

## The lifecycle

```
                        ┌─────────────────────────── know exactly what to do ──────────────────────────┐
                        │                                                                               ▼
   idea  ─────────►  concept  ─────────►  plan  ────────►  (implemented)                          docs/plans/
 docs/ideas/       docs/concepts/     docs/plans/                                                       ▲
   (unproven,        (research +          │  └──────────► want it, but a LATER version ──► docs/roadmap/┘
    unscheduled)      go/no-go)           │
                        │                 └──────────► architecture changed ──► notes in docs/architecture/
                        ▼
                  docs/postmortem/   (died — record WHY)
```

Read it as a set of rules:

- **We have a rough idea** → write it in [`docs/ideas/`](./ideas/README.md). High-level, unproven, unscheduled;
  it names the motivation, the fit with our architecture, the ruled-out dead-ends, and the open questions.
- **Before we build an idea** → promote it to a [`docs/concepts/`](./concepts/README.md) doc: the research and an
  honest go/no-go. A concept has two exits and no third:
  - it survives → it becomes a **plan** (its research record moves into the plan folder);
  - it dies → it becomes a [`docs/postmortem/`](./postmortem/README.md) (what we tried, what we measured, why
    it failed, and when it might be worth revisiting).
- **We already know exactly what to do** → skip straight to a [`docs/plans/`](./plans/README.md) chain (small,
  individually-implementable steps, each ending with verification + measured numbers).
- **We know what to do but want it in a later version** → [`docs/roadmap/`](./roadmap/) (e.g. `0.5.0/`, `0.6.0/`
  — scheduled cycles, same plan-chain shape as `docs/plans/`, just not this version).
- **We researched it fully and then did not need it** → [`docs/in-reserve/`](./in-reserve/README.md). Not
  scheduled like a roadmap item and not dead like a postmortem: a card that names the TRIGGER which would make
  it work again, **and where that trigger is checked in code**. The point is that the guard which fires months
  later says the card's name, so the same investigation is never paid for twice.
- **Before ANY of the three above are written** → read [`docs/project-goals.md`](./project-goals.md) first.
  It is what the project is FOR, and it is directive: OpenSA is compatible with RenderWare and is **not** a
  reimplementation of San Andreas. Honour the authored DATA (timecyc, handling, the IDE/popcycle tables — the
  design every mod is written in); do not port the LOGIC. We have our own engine and our own formats, so a
  legacy limit is not our limit, and where we can beat the original we are required to. It also carries what
  keeps that honest — better must be demonstrated, performance is part of every feature's spec, and a mod
  author's data must keep working. **Then** check
  [`docs/restrictions/`](./restrictions/README.md).
  It holds the rules a design has to satisfy — layer boundaries, format ceilings, engine splits, decisions
  taken at build time that cannot be re-taken at runtime — and says for each whether a violation is caught by
  a test/guard/lint or is SILENT. A new restriction is recorded there in the SAME change that finds it.
- **A plan is about the offline TOOLCHAIN** → it belongs in that tool's OWN chain at
  `tools/<tool>/docs/plans/NNN-<name>.md`, built or not, spanning one tool or four (the user's call,
  2026-08-20). Pick the tool whose RULE it is and let its row name what else it reaches; an umbrella keeps
  its folder shape there (`tools/add-vehicles/docs/plans/102-add-vehicles/`). A step that ships inside one
  tool moves the same way, taking the next free number with its measured numbers filled in. **`docs/plans/`
  is the ENGINE's** — the runtime, RenderWare parsing, streaming, rendering, characters, vehicles, physics,
  UI — and nothing else. Every tool keeps the record of its own steps beside its code, where the code's
  reader finds it.
- **A change alters the architecture** → add/adjust notes (and the diagram) in
  [`docs/architecture/`](./architecture/README.md) in the SAME change.
- **A NAME starts carrying behaviour** (a file the pipeline looks for, a frame/material the converter reads,
  a data row a tool writes) → record it in [`docs/contracts/`](./contracts/), one file per subject. A name
  contract is invisible from the code that consumes it: nobody greps for a filename they do not know exists,
  and a mod that spells one wrong contributes nothing, silently.
- **We knowingly took a shortcut** (a constant fitted by eye, a heuristic standing in for a formula nobody
  has recovered, an effect faked because the real one is not there) → write it up in
  [`docs/hacks/`](./hacks/README.md) in the SAME change, and move it to `hacks/retired/` when the honest
  version replaces it. A hack nobody recorded is indistinguishable from a decision.
- **After a big rework** → run an audit and a benchmark, and record both: the audit under
  [`docs/audit/`](./audit/), the numbers under [`docs/benchmarks/`](./benchmarks/) (per its schema). A large
  change without its audit + before/after numbers is unfinished.

## Folder map

| Folder | What lives here |
| --- | --- |
| [`project-goals.md`](./project-goals.md) | What the project is FOR — the directives a plan must aim at. Read FIRST, with `restrictions/`. |
| [`ideas/`](./ideas/README.md) | Unproven, unscheduled high-level directions (stage 1). |
| [`concepts/`](./concepts/README.md) | Live explorations under go/no-go review (stage 2). |
| [`postmortem/`](./postmortem/README.md) | Dead directions + the reason they died. |
| [`roadmap/`](./roadmap/) | Decided work deferred to a later version (`0.5.0/`, `0.6.0/`). |
| [`plans/`](./plans/README.md) | Committed work: numbered plan chains with measured verification. |
| [`architecture/`](./architecture/README.md) | Module/flow/format docs + rendered mermaid diagrams. |
| [`features/`](./features/README.md) | Per-feature state (one file per feature). |
| [`contracts/`](./contracts/) | Names that carry behaviour (files, frames, materials, data rows). |
| [`edge-cases/`](./edge-cases/README.md) | CURRENT limitations/constraints only, no legacy. Read while DEBUGGING. |
| [`restrictions/`](./restrictions/README.md) | Rules a new design must satisfy. Read BEFORE an idea/concept/plan. |
| [`gta-sa-original/`](./gta-sa-original/README.md) | The ORIGINAL game and the real install we ship into — kept apart from anything describing OpenSA. Anything we change or discover about GTA:SA original is recorded here in the same change. |
| [`hacks/`](./hacks/README.md) | Expedients we knowingly took: fitted constants, stand-in rules, faked effects. Replaced ones move to [`hacks/retired/`](./hacks/retired/). |
| [`references/`](./references/readme.md) | Ideas borrowed from other projects, with their status — planned, built, or refused with the reason. |
| [`performance/`](./performance/) | Deferred-optimization levers (a price tag, not a plan). |
| [`benchmarks/`](./benchmarks/) | Every reported perf figure, recorded before it is analysed. |
| [`audit/`](./audit/) | Post-rework audits (what changed, what it cost, what it bought). |
| [`debug/`](./debug/README.md) | Kept debug scripts: what each answers + how to run. |
| [`open-issues/`](./open-issues/) | Tracked open problems and their fixed writeups. |
| [`improvements/`](./improvements/) | Smaller improvement notes not yet a plan. |
| [`development/`](./development/) | Contributor/setup notes. |
| [`tutorial/`](./tutorial/) | End-user guides for what we SHIP, one folder per app (`<app>/`, screenshots beside the page). The English source of the published page. |
| [`commands.md`](./commands.md) | CLI/command cheat sheet. |
| [`links.md`](./links.md) | Useful external resources. |

The per-folder rules live in [CLAUDE.md → Documentation Maintenance](../CLAUDE.md); this page is the map.
