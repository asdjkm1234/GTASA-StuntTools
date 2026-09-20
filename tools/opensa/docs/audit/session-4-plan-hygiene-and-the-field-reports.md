# Session 4 audit — three field reports, and 178 phantom tasks removed from the plan record

**2026-08-11, same day as session 3.** Fifteen commits, **84 documents, zero source files.** Suite unchanged
at **4 106 tests / 454 files green** — which is the point rather than a formality: nothing in this session was
allowed to touch behaviour, so the number proves the record was corrected without the thing it describes
moving underneath it.

## What the session was

Two halves that turned out to be the same problem. The first: the user ran the fresh build and reported what
he saw. The second: he asked what was left to do, and the answer the repository gave was wrong — not stale in
detail, but wrong in kind, because it was assembled from checkboxes while the authority was in the banners
above them.

## Half one — the field, and one measurement I got backwards

**Plan 013 closed on his procobj run.** The layer measures **91 419 objects / 43 species / 110 382 map-wide
permanent rows**, both counts **+327** against the pre-floor build. That the two deltas are the same number is
the check that `procObjSpeciesFloor: 1` ADDS objects rather than swapping them, one permanent row each — the
floor's cost, measured rather than modelled. The slope gate is NOT in that verdict and does not need to be:
`procObjSlope` ships undefined, so it is an unjudged knob and not behaviour.

**The UV-repair retirement is field-verified.** The smears came back exactly as authored, which is the
intended state and also proof the retirement was complete — no repaired geometry survived in the stage caches.

**Three "no LOD" reports, and this is where the session earned its lesson.** I published a root cause within
the hour, and it was wrong: I read the lod link's VALUE from the stock tree and the ROW it lands on from the
built one. Resolved properly, `laehospital1`'s stream link is **132, not 133**, and 132 is its own LOD on its
own footprint — the mod merge's rebase and its binary-stream patch both held, and are now measured working.

What survives is one confirmed defect and it is ours: built `LAw.ipl` is one `LODcanhou01_LAx` row short of
stock with the id/name column shifted and the transform column not, so `LODgaz9_law` carries its neighbour's
transform **398.7 u off its object** — and `law_stream2.ipl` was never patched, so link 158 lands on a tree
the build had exiled to z = −300. No mod ships that file or a merge for it. `laehospital1` and `road_lawn33`
resolve cleanly and stay **unexplained**, which is written as unexplained.

His follow-up (`standard01_lawn` "slid or duplicated onto the crossroads") checks out as not moved and not
duplicated — one placement at stock's position, link resolving, nothing new within 150 u. What did change is
that building's COLLISION: `0. Map Fixes Pack`'s `lawn_4.col` contains it and re-authors **427 faces + 31
boxes into 1173 faces, 0 boxes**. A lead, not the answer: bounds are unchanged and the footprint does not
reach the junction.

## Half two — the plan record was lying, and it was lying at scale

Asked what was left, I scanned checkboxes and reported four chains as open. **All four had carried a
`🔒 CLOSED — superseded by 074` banner since 2026-07-21.** The user caught it in one sentence ("they all
come before 074, where we replaced the engine COMPLETELY"). He was right, and the correction was already in
the repo a month before either of us looked.

| Sweep | Boxes | What they were |
| --- | --- | --- |
| Ten closed rendering chains (064–073) | **118** | tails of dead plans, never struck when the chains closed |
| 074 / 080 / 081 | **60** | checklists of shipped work, never ticked |
| `opensa-pack/000` | **10** | the founding list of a tool that builds a 1 167 MB pak every run |
| procobj 011, lod-gen 008, normals 020/021 | 5 | see below |

**178 phantom tasks.** Every one of them made the repository read as if it owed work it had already done or
deliberately killed.

### What was NOT swept, and why that matters more than what was

The sweep would have been worthless if it had been mechanical, because four things really are outstanding and
they only stay visible if nothing around them is noise:

- **074/15 (LOD baked lights) never happened** — no `bakeNightLights` anywhere in the tree. One whole step.
- **Vehicle lamp head/tail STATE** and the **dynamics-only near shadow pass** (074/08) — verified absent while
  their neighbours (god-rays, coronas, skinning, breakables, anim objects, the `_vlo` band, water) are present.
- **074/14**: full-profile conversions (anderius/carcer/gostown) and BC α-subset.
- `opensa-pack/000`'s determinism box is marked PARTIAL, not ticked: per-baker determinism is tested, a
  whole-run double-run hash test does not exist, and the budget guards live in a different tool.

Two closures are STRUCK rather than done, for the same reason in both cases — **there is nothing shipped to
judge**. procobj 011's field check cannot accept or reject a gate that ships undefined; lod-generator 008's
stock-target regression protects a target we do not build (`--strip-particles` survives with no caller, no
test, and that is recorded instead of a tick). The normals A/B (020/021) closed on the user's verdict with its
own caveat written in: it says "nothing visible went wrong" and cannot say "the repair helped".

## What else the session put in place

- **Every deferred optimization now states what it would BUY.** The user corrected the axis mid-task — I had
  rated implementation effort, he wanted impact — and the rewrite says something uncomfortable: most of that
  list cannot fix a frame. Five entries are noise; two of those are not frame-time levers at all (per-ring
  texture laziness is the biggest item there for MEMORY). The honest shortlist is foliage fill and the speed
  camera's framing, and only the first is measured — the camera's ×1.47 agrees with the field's 50-vs-70 fps
  by arithmetic that has never been A/B'd, so it is rated **inferred** and the entry says run it first.
- **Three gates the user set**, each stopping work before it starts: a video before the City Life chain, a
  video before the original-game defect list, and the "Ultimate First Person" mod before the first-person
  camera. All three say the same thing in different words — what is written was reasoned from our own engine
  and has never been checked against a shipped implementation.
- **`docs/improvements/original-game-defects.md`** — the collecting place for stock SA's own bugs, seeded from
  SilentPatch's changelog as a defect INVENTORY. Two traps recorded: our reference install already runs
  SilentPatch (so those defects read as fixed on `sa` while none are fixed in our engine — that gap is what
  the list tracks), and it is a binary patch of a 2004 exe, so its solutions are shaped by what can be hooked.
- **`080/08` moved to `roadmap/0.6.0/plans/07-camera-view-presets`**, which closes 080 and 081 with nothing
  open. Deferred work belongs beside the version that will do it, not as a debt against a finished chain.

## The lesson

Session 3's was that the acceptance test measured the wrong thing. This one is smaller and more embarrassing:
**twice in one session I answered from the cheap signal instead of the authoritative one** — checkboxes
instead of status banners, and one end of a lod link from each tree. Both were caught by the user in a
sentence, and both would have been caught by me in a minute of reading. The rule that falls out is not "be
careful": it is that **a claim assembled from a scan needs one confirming read of the thing it claims about**,
and the read is always cheaper than the correction.

The repository now carries its own defence: a chain's readme states where it stands, and struck boxes are
struck. The next person to ask "what is left" gets 133 boxes that mean it.

## Numbers

| | |
| --- | --- |
| Commits | 15, all `docs(*)` |
| Files | 84 markdown, 0 source |
| Tests | 4 106 / 454 files green (unchanged — nothing behavioural moved) |
| Phantom tasks removed | 178 |
| Genuinely open, `docs/plans` | 133 boxes (was 193 + 118 mis-reported) |
| Chains closed outright | 080, 081, procobj 011, lod-gen 008, `opensa-pack/000`, map-optimizer 020/021 |
| New open issues | 2 (LOD links, crossroads collision) |
| Broken links introduced | 0 (all 84 changed docs checked) |
| Cyrillic quotes paraphrased | 7 across 6 files — the repo is now English-only, verified |
