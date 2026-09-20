# Session 14 — layered mod folders, the lean delivery shape, and two conflicts nobody could see

**2026-08-15, 14 commits.** Two shipped pieces of work, one mod-set migration done by hand with the
user, and two debug scripts that exist because the migration needed an answer no doc could give.

## What changed

### 1. `vehicle-cutscene --no-base-copy` (plan 006, closed)

The tool copied the whole 1.4 GB `--game` tree in order to write three files. APFS copy-on-write hid
that on this machine; NTFS has none, and Windows is the standalone converter's only platform.

| | Base copy | `--no-base-copy` |
| --- | ---: | ---: |
| Output | 1.72 GiB, a whole game tree | **579 MiB, three files** |
| Wall-clock (two runs) | 4.556 s · 3.426 s | 2.633 s · 2.353 s |

**The three files are byte-identical between the modes** (SHA-256, on the real 23-car fleet) — that is
what lets the pmb pipeline and the standalone app share one converter, and it is the check the plan was
written around. Numbers:
[`benchmarks/tools/2026-08-15-vehicle-cutscene-no-base-copy.md`](../benchmarks/tools/2026-08-15-vehicle-cutscene-no-base-copy.md).

Two decisions the plan did not anticipate, both made because a delivery set has to be checkable:

- **Both modes now READ from `--game`.** In the copy mode the copy IS the game byte for byte, so one read
  path serves both and they cannot drift apart. Before, the run read `cutscene.img` and `txdcut.ide` out
  of the copy.
- **`anim/cuts.img` is written even when neither scene pass touched it** — the copy mode always leaves one
  in `--out`, and a set that is sometimes three files and sometimes two cannot be diffed.

The `--out == --game` refusal moved a layer down: the tool dropped `vehicle-installer`'s private `guardOut`
for `@opensa/tool-kit/game-dir`'s shared one (whose own doc invited that), and path comparison there is
now case-folded on every platform. The asymmetry is the whole argument — a false refusal costs a rename, a
missed match overwrites the user's install, and under this flag there is no wipe to warn anybody first.

### 2. Layered mod folders (mod-installer plan 011, closed)

`mods-src/<game>/mods` may now be `common/` + `sa/` + `opensa/`, all optional: `common` applies first, then
the layer of the target being built. A folder without those names is FLAT and behaves exactly as before —
**proved by `diff -rq`: the same 393 files / 1 892 164 KiB, before and after the layer walk**.

The layer order beats the numbering (`common/50. X` before `sa/0. Y`), because the target layer has to be
the last writer for the split to mean anything. Three shapes are refused rather than guessed: a mod folder
beside the layers (which is what a misspelled layer name looks like), a layered tree with no target, and
two layer folders differing only in case.

**The one real complication was structural**: the `mods` stage sits in the chain both targets SHARE, and
`resolveBuildTarget` resolves a both-target run to `sa`. So a layered folder plus a run that builds both is
refused at config time, before any stage runs — the same precedent as the `--target opensa` refusal beside
it. It costs today's builds nothing (all four `build:game:*` scripts already exclude one target). Running
the common chain twice is written down in the plan as the option if that ever stops being true, and as a
rule in [`restrictions/architecture.md`](../restrictions/architecture.md).

### 3. The migration, and what it exposed

The user split `original` into `common` (64) + `sa` (67) over the session, staging batches in a folder
named `1` beside the layers — which the new mixed-tree guard would have refused, so each batch was moved
into `sa` and renumbered as it arrived. Then the question that mattered: **do the two layers collide?**

They did, in two ways, and neither is visible in a file listing:

- **Two model IDs.** `sa/35. Новый алгоритм для поездов` bakes `tllgs.IDE` defining 18631/18632 as
  traffic-light masts. `common/0. Map Fixes Pack` had already given those ids to two neon objects — AND
  places them. The installer's supersede rule kept the baked definition and stripped the neon's, so both
  placements drew a mast. The ids are int16 literals inside the mod's compiled CLEO script (26 · 52 · 27
  occurrences), so the mod cannot be renumbered and deleting its IDE rows would have left the script
  requesting undefined ids. The user's call: drop the mod (kept in `NO_COMMIT/removed-mods/`, "we will
  write our own"), and drop `sa/58. Enterable Hidden Interiors Repatched` with it.
- **Seven `gta3.img` entries**, all from that interiors mod, over versions shipped by four common mods.

After both removals: **0 entry conflicts, 0 supersedes caused by the sa layer**, the neon rows back in the
`sa` build, and both installs still passing the dangling-models gate. What remains are two files that
differ for a structural reason and are not losses — `data/gta.dat` (both layers append) and
`data/maps/interior/stadint.ipl` (the IPL-fold host depends on which mod IPLs exist).

A whole-set id scan then cleared everything else: 14 882 ids claimed, 62 claims from 14 mods, **no
collision involving a mod**. The 7 that remain are STOCK↔STOCK (16700–16708, `leveldes.ide` vs
`countn2.ide`) — R\*'s own, in every copy of the game.

## What it cost

Two debug scripts, kept because each answered a question that had no other answer:

- `scripts/debug/mod-layer-conflicts.ts` — empirical, three-state (base → A → B), files and archive
  ENTRIES reported apart, each attributed to the mods shipping the name.
- `scripts/debug/mod-id-collisions.ts` — static, no install, and it says which ids two sources claim for
  DIFFERENT models. The duplicate is not the finding; the disagreement is.

Two fixes to the `renumber-mods` skill, both found by using it on a real folder rather than by reading it:
it stripped the number with `${dir#*. }`, which leaves `8.1 SPC Cars` whole (there is no `". "` in it), and
it ordered by `sort -n`, which puts an UNNUMBERED folder FIRST while the installer puts it LAST — so
`Common Textures Fixes` would have gone from last writer to first, silently. The order now comes from
`sortMods` itself, and the rename goes through a temp name so an INSERT is as safe as a compaction.

## What this session got wrong, and how it surfaced

**Both of my own instruments lied before they told the truth**, and neither lie was visible in a passing
test:

- The layer-conflict script short-circuited files over 64 MB to "differs", so it reported `anim/cuts.img`
  as written by both layers when nothing had touched it. Fixed by hashing in chunks.
- The id scanner parsed every numbered row, and a `2dfx` row is `<id>, x, y, z, …` — so floats read as
  model names and it reported 37 collisions that were one file's own effect entries. Fixed by tracking the
  section and reading model sections only.

**And the wall-clock measurement had to be abandoned rather than published.** The flat-path A/B spread
68 s / 92 s across code versions with CPU time flat, because the user was writing a mod folder into
`mods-src` during the window — the mod count went 61 → 62 mid-measurement. The byte-identical output is
what survived a busy machine, and the benchmark says so instead of quoting a number
([`benchmarks/tools/2026-08-15-mod-installer-layered-flat-path.md`](../benchmarks/tools/2026-08-15-mod-installer-layered-flat-path.md)).

## State at close

Suite **4313/4313** (475 files), tsc + eslint clean, tree clean. `sa` is 67 mods numbered 1…67, `common`
64 with one deliberately unnumbered folder that installs last. Neither game has an `opensa` layer yet, so
an opensa build applies `common` alone and says so in its log line.
