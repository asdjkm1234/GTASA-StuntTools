# Audit — the img-archive split (2026-08-15)

A build that could not finish now finishes, and the archive shape it emits is bounded by construction.
This is the big-rework audit for the chain that got there: `tools/img-splitter` plan 001, the
`tool-kit` archive work under it, and the pmb stage that runs it. Measurement record:
[`benchmarks/tools/2026-08-15-vehicle-installer-batched-img.md`](../benchmarks/tools/2026-08-15-vehicle-installer-batched-img.md).

**Where it started**: `npm run build:game:original:sa` was asked to include mod vehicles for the first
time — the packaging call for `asi/perfect-cutscene` plan 001 step 7 — and died mid-stage with
`The value of "length" is out of range … Received 2168825856`.

## What changed

- **`tools/img-splitter`** (new): an IDE-derived classifier, the splitter, the archive-slot gate. Runs
  as pmb's FIRST stage, so every entry name lands in exactly one archive before anything installs.
- **`tool-kit/archive/img`**: `setFile` (an entry whose bytes stay on disk), `size` (a length without
  materialising), `ARCHIVE_CAP_BYTES` + `writeImgFamily` (spill into numbered siblings), and a cap
  enforced inside `writeImgFile` itself.
- **`tool-kit/archive/layout`** (new): `openArchiveIndex` — where a file lives, read off the tree —
  plus `openLazyVer2` promoted out of `opensa-pack`, and the `data/img-layout.json` report.
- **`tool-kit/game-dir`**: `registerImgArchives` / `countImgArchives`, so whoever writes an archive
  registers it.
- **`vehicle-installer`**: one archive open and one write per RUN instead of per car; the target
  archive derived from the tree; the spill sibling registered.
- **`vehicle-cutscene`**: txdp parents and donor models resolved through the index rather than through
  a hardcoded `gta3.img`.
- **Eleven writers** across mod-installer, ped-installer, both LOD generators, sa-lod, procobj and
  lod-trees moved off `writeFileSync(path, img.build())` onto the streaming path.
- **pmb**: the `split` stage, `checkImgIdBudgets` enumerating archives instead of listing four names,
  the slot gate on the finished `sa` tree, and the manifest restated there.

## What it cost

| | |
| --- | --- |
| Code | 1 new tool (3 modules), 2 new `tool-kit` modules, ~14 files touched elsewhere |
| Tests | 4242 → **4290** in the repo suite, all green; tsc and eslint clean |
| Docs | 1 architecture doc + diagram, 1 restriction, 1 edge case, 1 benchmark, 1 `in-reserve` card, plan chain |
| Build time | `sa` end to end **638.9 s** first run, **655.9 s** on the re-run with every writer streaming |
| Split stage | 1.6–3.2 s |

## What it bought

**A build that completes.** The vehicles stage went from "cannot finish" to 4.9 s, and the whole `sa`
target from failing to 655.9 s with mod vehicles, the cutscene fleet and both asis included.

**A ceiling that is now caught instead of silent.** Three separate guards where there were none:
`writeImgFile` refuses to pass 1.75 GiB (and deletes the partial file), `assertUniqueNames` refuses a
source archive whose directory declares more rows than distinct names, and `assertArchiveSlots` fails a
tree registering more than the 8 `CStreaming::ms_files` holds. The restrictions folder gained the rule;
before this session the 2 GiB wall was recorded nowhere and the archive table was recorded as
**"Caught: no"**.

**The empty-TXD route, running as designed for the first time.** The cutscene stage emits **199.1 MB**
against the CLI route's 321.5 MB for the same 23 slots, because txdp parents now resolve out of the
installed archives instead of `--self-contained-txd` embedding a copy per slot. That was the outstanding
half of `asi/perfect-cutscene` plan 001 step 7.

**Peak RSS down where it was measured**: the vehicles stage 3.11 → 2.48 GB, and eleven writers that used
to hold a whole archive in a buffer no longer do.

## What it did NOT buy, and what nearly went wrong

- **The ASI lift was researched and not needed.** The shipped layout registers 8 of 8 — the ceiling was
  never reached, not lifted, and the two are indistinguishable from outside. Deferred with its trigger in
  [`in-reserve/img-archive-limit-lift.md`](../in-reserve/img-archive-limit-lift.md), and the trigger is
  enforced by the guard that names the card.
- **Three guards I wrote were wrong until they were tested.** The duplicate-name check was dead code
  (`parseVer2Directory` keys a Map, so a duplicate is already collapsed); the manifest merge silently
  dropped its carried fields because an eslint reformat moved the code my edit was targeting; and the
  first `finally` closed the descriptor twice. Each was found by reading the OUTPUT, not by a green
  suite — the suite was green through all three.
- **A pre-existing defect surfaced that is not ours**: on the pipeline route ~19 cutscene slots failed
  with `no HAnim skeleton root`, because a mod REPLACES cutscene models with rigs that carry no root and
  the converter reads its template from the installed `cutscene.img` (26.9 → 31.3 MB after `mods`). The
  user removed those mods. It is only visible on the pipeline route, which is why three sessions of CLI
  runs never met it.

## Open after this

- The map bucket sits at **1.64 GB against a 1.75 GiB cap** — the next large mod set trips the guard,
  which is the `in-reserve` card's trigger.
- ~~`asi/perfect-cutscene` plan 001 step 7's last verification~~ — **done the same day**: three swept scenes
  re-run on the pipeline build, all good (the user). That closes plan 001 entirely, steps 0–7. The scenes
  matter more than they look: after the split every one of their txdp parents lives in `vehicles2.img`, so
  they exercised a resolution path that did not exist when the sweep was taken.
