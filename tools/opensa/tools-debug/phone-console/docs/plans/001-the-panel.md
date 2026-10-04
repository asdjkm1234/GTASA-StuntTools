# phone-console 001 — a panel for the phone the work is done on

Opened 2026-08-23, on the user's call: phone testing is becoming the normal case, and every ritual it needs
is typed into a terminal on the device being tested.

## Why, in one paragraph

`scripts/phone.sh` already automates the run itself. What it has no answer for is the two failures around it.
**A run that does not start** fails for a reason at the bottom of a log, on a screen with no scrollback worth
the name — and the causes repeat (a pull added dependencies, `tsx` is missing, a port is held, `GAME` and
`OUT` resolve to one folder, shared storage is full while internal is not). **A run that does finish**
produces a number that has to survive the trip to the next session, and today it travels as a chat paste with
its conditions missing — which is exactly what [`docs/benchmarks/readme.md`](../../../../docs/benchmarks/readme.md)
opens by warning about, and what `CLAUDE.md` requires be committed before it is analysed.

## The decisions, taken with the user 2026-08-23

| Decision | What it rules in | What it rules out |
| --- | --- | --- |
| **A PWA panel, not a native app** | a page served from Termux with a manifest, installed to the home screen | an APK: a JDK + Gradle + SDK toolchain on a device with no PC, signing on every update, and `RUN_COMMAND` intents — for an icon and nothing else |
| **No agent connects to the phone** | the panel commits and pushes; the next session reads the branch | a public tunnel to a page that runs commands, which is a shell on the internet |
| **Zero dependencies, plain `.mjs`** | it boots on `node` alone, which is what lets it report a tree too broken to run TypeScript | a workspace, a build step, or a panel that needs `tsx` to say `tsx` is missing |
| **It runs the existing rituals** | `phone.sh`, `phone-setup.sh`, `district.ts`, `git pull --ff-only` | a second implementation of the convert, which would be a second thing to keep true |
| **It files data, never code** | commits under `docs/benchmarks/opensa-engine/` only, naming the paths on the commit | a panel that can sweep a dirty worktree into a commit from a phone |
| **127.0.0.1 by default** | `PANEL_HOST=0.0.0.0` as an explicit opt-in with a warning line | a command runner on the LAN by default |

## Steps

### 01 — Preflight, the rituals and the capture inbox

**DONE 2026-08-23.** The first slice, chosen by the user: the doctor and the run buttons, plus the capture
inbox and its commit — the two halves that pay for themselves immediately.

- **Preflight** (`doctor.mjs`): node · dependency STALENESS against `package-lock.json` (existence alone once
  reported a healthy tree that died minutes later inside the stage needing the new dependency) · `tsx` ·
  **`sirv`** · the game files · **GAME vs OUT resolving to one folder** · the pak and its recipe · the two
  run ports · free space on both filesystems · branch and behind-count · the wake lock. Each with what to do
  about it, rolled into one verdict line.
- **The rituals** (`jobs.mjs`): `git pull --ff-only`, `phone:setup`, `phone` with its knobs, `map` — the
  same convert with the model half forced off — and `district.ts`.
  One at a time, refusal naming what is running; env is whitelisted per job and a dropped knob is REPORTED
  (a shell script ignores an env var it does not read, silently). Jobs run in their own process group, so
  stopping one reaches vite, the static server and the convert rather than orphaning a held port.
- **The log**: server-sent events with a 400-line ring buffer, so a phone that slept and reconnected sees
  what happened instead of an empty box.
- **The capture inbox** (`captures.mjs` + `capture-store.mjs`): the JSON is filed under the family's own
  naming rule with the provable conditions stamped into its note; a note under 12 characters is refused; the
  commit names only the paths the panel wrote and only under `docs/benchmarks/opensa-engine/`, with
  `HUSKY=0` because `--omit=dev` leaves the phone no hooks to run. A `tiles.pmtiles` is checked for the
  format's magic before it is written beside the pak.

**Verified 2026-08-23** in the container, end to end: 33 unit tests over the pure halves; the server serving
the page and the manifest; `/api/state` answering with real checks (including the districts read out of the
console's own table); a job started, streamed and finished; a capture refused for a thin note and then filed
with its note stamped; a commit refused for naming a source file; a tile upload refused for an HTML body and
accepted for a real header; and a `../../etc` output path refused as outside the repository.

**The first phone run, 2026-08-23, and what it cost.** The panel did not start, and neither did the pull that
carried it: `git pull` refused with *"Your local changes to the following files would be overwritten by
merge: package.json"*, so `npm run panel` answered `Missing script: "panel"` — a symptom two steps away from
its cause. The dirt was ours: **`npm run phone:setup` installs tsx with `npm i tsx`, and `npm i <pkg>` writes
the package into `package.json`** — on the one machine whose worktree the same script's header refuses to
touch for exactly that reason. Fixed with `--no-save`, and the panel now names the condition
(`a pull will refuse`, with the way back) rather than leaving it to be discovered as a missing script.

Fixing that check found a second defect of the same family in the panel itself: `git status --porcelain` was
`.trim()`ed before parsing, and an unstaged modification's status field STARTS with a space — so the first
line lost a character (`ackage.json`) and the check read healthy exactly when the file it was about was the
only thing changed. Now `statusPaths`, with a test for the leading space, the rename arrow and an empty tree.

**The first clean run, 2026-08-23, and the third defect of the same family.** The panel started, preflight
was green but for one line, the convert reused the district pak, and both servers came up — the ritual
worked. What the log then showed is that `phone.sh` was serving `build/webapp`, the unpacked copy of
`prebuilt/opensa-webapp.tar.gz`, and **that archive was 11 days old**: none of chains 7 and 8, none of
[6/02](../../../../docs/plans/201-dispatch-console/6-display-modes/readme.md), existed in the app the phone
was about to open. `prebuilt/README.md` warns about it in prose ("re-unpack it after every pull"), which is
exactly the kind of warning a preflight should carry instead. Now it does: **the served app is compared
against the archive**, and the fix is a button running the README's own two-step command (clear `assets/`,
never `rm -rf build/webapp` — that path is routinely a symlink into shared storage). The archive itself was
refreshed in the same change.

**And the check itself was wrong the first time, in the way this repo keeps meeting.** It compared the
unpacked copy's mtime against the archive's — which always fails the same direction, because `tar -x`
restores the times recorded INSIDE the archive (when the app was built, on another machine) while the archive
file is written by `git pull` (now). Measured: extracted `index.html` 22:40:27 against an archive of 22:40:46.
The user re-unpacked, by button and by hand, and the row stayed red both times. It now compares **content** —
a fingerprint over the archive's `.html` entry points, which are the files that name the content-hashed
chunks — so it needs no cooperation from whoever extracted the archive and cannot be fooled by a clock
(`webapp.mjs`, with the tar walk and the fingerprint tested on both sides of the comparison).

**Two more of the same family, reported from the phone the same evening.** A `Commit & push` that sent
nothing left no trace: the panel collected each git command's output and wrote it to the log only after every
step SUCCEEDED, so the one case the log exists for was the one case it was empty. Now every command is logged
as it runs, a failure logs git's own words, and `GIT_TERMINAL_PROMPT=0` makes a push that needs credentials
fail instead of waiting for a username on a terminal nobody is looking at (a blocked git looks exactly like a
slow one from a page). Then the button answered `nothing filed in this session yet` over a capture that was
already on disk: the list of what to commit lived in the PAGE's memory, so a reload or a restarted panel lost
it forever. The list now comes from `git status` — the repository is the state, the page only shows it.

**And the reason the commit had been failing all along, 2026-08-24: `Author identity unknown`.** git on that
phone had no `user.name` or `user.email` — it never had, because the device had only ever PULLED — and git
only says so when a commit is attempted. Preflight knows it beforehand, so it now carries a **git identity**
row: who captures will be committed as, or the two `git config` lines to set it, with the address DERIVED
from the repository's own remote (`<owner>@users.noreply.github.com`) rather than invented, and never a
placeholder for bash to run literally. Not a button — only the operator knows what to be called.

**Then the commit went through and the PUSH failed — `could not read Username`, 2026-08-24.** That is
`GIT_TERMINAL_PROMPT=0` doing its job (the alternative is git waiting forever on a prompt nobody can see),
and the cause is a phone with no credential helper for an https remote. Two things came out of it: preflight
now carries a **push credentials** row, read from CONFIGURATION rather than by asking the network — an
https remote with no `credential.helper` for github.com warns before a capture is ever filed — and the panel
grew a **Push** button of its own. Until then a failed push was a dead end: the capture was committed, the
remote did not have it, and the only button that could send it insisted on having something new to file
first. The branch's unpushed count is in preflight (`N to push`) and on the button.

**And the first divergence, minutes later.** With credentials finally in place the phone pulled — and
`--ff-only` refused: the capture commit was here, two panel commits were there, both on the same base. That
is what a device that COMMITS meets the first time the other end pushes too, and `git pull` says it in words
that read like a breakage rather than a choice. Preflight now names it (**the branch has diverged**, with
what is on each side) and offers `git pull --rebase` as a button — the one history operation this panel runs,
safe for a precise reason: the phone's commits are capture files nobody else writes and they are not on the
remote yet, so they are replayed rather than rewritten. If a rebase ever stops part-way, preflight says THAT
too, with `--continue` and `--abort` in words — not as buttons, because neither is a tap.

**THE LOOP CLOSED, 2026-08-23.** A capture was filed on the phone, committed by the phone and pushed by the
phone: [`2026-08-23-mobile-pinned-district-inventory.json`](../../../../docs/benchmarks/opensa-engine/2026-08-23-mobile-pinned-district-inventory.json)
— 433 lines of inventory report that reached the repository without passing through a chat window, which is
what this panel was built for. It is also [201/2-03](../../../../docs/plans/201-dispatch-console/readme.md)'s
first row on the pinned district from a real device.

One rule it broke on the way, and the panel now enforces it: **the note came in Russian**, and `CLAUDE.md` is
English-only for anything committed. This panel is the one writing committed files on a device whose operator
does not type English by default, so the rule belongs at the door rather than in a later cleanup — a note
carrying Cyrillic is refused by name, and the panel's own separators keep working.

**A push that could only be rejected, 2026-08-25.** The phone committed while the remote had moved, and the
`Push` button ran a push git could only refuse (`! [rejected] … fetch first`). The panel already KNEW — the
behind-count is in preflight — so the button was a trap rather than an option. It now reads both sides: while
the remote is ahead it says `Pull first (N behind)` and is disabled, and `/api/push` refuses the same case by
name, because a page can be seconds stale. The way forward is the diverged row's rebase, one row up.

The same round added a line the flat map needed: the **pak** row says whether `tiles.pmtiles` is beside the
pak and how big it is, so "did my upload land" is on the screen rather than a question — the archive is
gitignored, so nothing else on the panel could ever have shown it.

**Owed:** the first clean run on the phone itself — the doctor's own verdict there is the measurement this
step is judged on.

### 02 — The console posts its own captures

Today the operator copies JSON and pastes it into the panel. `?inventory=1` could POST it to the panel
directly (`&post=http://localhost:8787/api/capture`), which removes the last manual step of a field run.
Small, and deliberately not in slice 1: it touches the app.

### 03 — The panel serves the pak itself

`scripts/serve-static.ts` imports `sirv`, a devDependency reachable only through the dev tree that
`phone:setup` deliberately omits (`@vitest/browser` is its only other route). On a device set up strictly by
the documented path, the static server therefore cannot start — and it is the server that hands out the pak,
so the symptom is a map that loads nothing. Slice 1 makes the doctor SAY so; the fix is either moving `sirv`
into `dependencies` or serving `build/` from the panel with Range, CORS and `__index`, which are the three
things the loader needs. **Trigger:** the doctor reporting `sirv` missing on a real device.

### 04 — A read-only window for an agent

Ruled out for now as a tunnel (a public URL to a command runner). If it comes back it is read-only, token
gated, off by default, and time-boxed — and even then the repository stays the handoff, because a session
that reads a log it cannot cite has learned nothing the next session can use.

## Status

| Step | State |
| --- | --- |
| 01 preflight + rituals + capture inbox | **DONE 2026-08-23, and PROVEN on the device: a capture was filed, committed and pushed by the phone itself.** — verified in the container end to end (35 tests, every guard exercised). The first phone attempt failed on a dirty `package.json` written by our own `phone:setup`; fixed at the source (`--no-save`) and now reported by the doctor. Owed: the first clean run on the phone |
| 02 the console posts its own captures | not started |
| 05 the map-only button | **DONE 2026-08-25** — the user's ask: one tap that converts the ground and nothing else. `MODELS=0` + `BAKE=0` forced after the form (the page cannot buy either back) and its own `-map` output folder, because `phone.sh` refuses a pak whose recipe is not the one asked for and a forced rebuild would discard the full pak on every press. 62 tests |
| 03 the panel serves the pak itself | not started — gated on the doctor reporting `sirv` missing on a real device |
| 04 a read-only window for an agent | ruled out 2026-08-23 |
