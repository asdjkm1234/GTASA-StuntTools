# Developing on a phone (Termux)

**The development machine for this project is an Android phone running Termux.** Not a preference — the
working setup. Recorded 2026-08-06 so that instructions, scripts and plan steps are written for it instead of
for a desktop that is not there.

The user **has the game files and can build paks**, so nothing here is blocked on assets. What is different
is the machine.

## What changes

| Assumption a desktop makes | What is true here |
| --- | --- |
| `sudo`, `apt` | neither — `pkg install <x>`, everything runs as the single Termux user |
| stable paths (`/usr`, `/tmp`) | `$PREFIX` (`/data/data/com.termux/files/usr`); `$TMPDIR` is inside it |
| a long command keeps running | Android suspends the process — hold it with `termux-wake-lock` |
| files are just there | shared storage needs `termux-setup-storage` once |
| RAM is not a variable | it is the binding constraint on every build |
| a headless browser exists | **Playwright/Chromium headless is effectively unavailable** |

## The two that actually bite

**The build scripts ask for a 12 GB heap.** Every `build:game:*` script in `package.json` carries
`NODE_OPTIONS=--max-old-space-size=12288`. That is a desktop number and no phone will honour it. If a pak
build runs on the device, the flag has to come down to what the phone has and the build has to be sized to
fit — a district rather than the whole state is the obvious lever, and it is the same district
[201/1-01](../plans/201-dispatch-console/1-the-map-profile/readme.md) pins for measurement anyway.

**There is no headless capture path.** Much of `scripts/debug/` and all of `e2e/` drive a browser through
Playwright. Here the equivalent is: run `npm run dev` in Termux and open the page in the phone's own browser
(`http://localhost:5173/…`). That covers anything a human can read off the screen, and does not cover
scripted input or an automated screenshot diff. A step that owes a scripted check has to say so and find
another way rather than assume `npx playwright` will run.

*Since 2026-08-28 that is narrower than it reads.* The panel's map channel
([`phone-console` plan 002](../../tools-debug/phone-console/docs/plans/002-mcp.md)) drives the console the page
opened with `&agent=1`: an agent opens it, reads the inventory report, takes the console's own PNG, moves the
camera, switches the mode. So a capture no longer needs a person relaying the screen — verified on this device
that day, `map_open` → `map_snapshot` → `map_screenshot` with nobody touching the phone. What it still is not
is headless: it drives THAT page, on THAT screen, and the two conditions below are what it costs.

**A browser opens from the panel only while Termux may display over other apps.** Android forbids a
background app from starting an activity, and `termux-open-url` does not report the refusal: it exits 0,
nothing appears, and `map_open` can only say that it launched something and nobody arrived. Measured
2026-08-28 — the same URL opened instantly when it was typed in a foreground Termux, and the tool's launch of
it opened nothing at all. Grant Termux **Display over other apps** (EMUI: Settings → Apps → Termux → Display
over other apps; the launch-management entry for Termux has to be manual with all three switches on, per the
PowerGenie block below). After that the panel raises the console by itself, which is what makes an unattended
run possible at all.

**A console that is not the foreground tab is a frozen console.** Android suspends the tab: the map stops
polling, so within 15 s the panel reports no map attached, and a command already handed to it is simply never
answered (`map_screenshot` failed exactly this way twice on 2026-08-28, while the cheap `map_snapshot` taken
seconds earlier had gone through). This is not a bug to fix on our side — it is the shape of the device — so
a measurement is taken with the console in front and the phone left alone, and anything else read from the
panel instead.

**Android kills Termux, and the screen being on does not stop it.** Reported 2026-08-25: the session dies
with the screen ON and the app merely backgrounded. Nothing in userspace prevents this — a wake lock keeps the
CPU awake, it does not keep the process alive — so the answer is in two halves, and only the second one is
ours.

*Their half, and on this device it is the one that matters.* The phone is a Huawei (`MGA-LX3`, the model on
every mobile benchmark row), and EMUI's PowerGenie is the most aggressive background killer of any Android
skin. Three settings, all of which have to be set:

| Where | What |
| --- | --- |
| Settings → Battery → **App launch** → Termux | switch OFF "Manage automatically", then enable all three of Auto-launch, Secondary launch and **Run in background**. This is the one that actually decides it |
| Settings → Battery → **More battery settings** | "Stay connected when device sleeps" ON; power-intensive app prompts OFF, or EMUI offers to close the convert for you |
| Recents (the task switcher) | swipe DOWN on the Termux card to **lock** it — a locked card survives "clear all" and is reclaimed last |

Termux's own notification must stay visible: it is what makes the session a foreground service, and hiding it
tells Android the process is idle.

**On Android 12+ there is a second, separate killer, and it looks like the same symptom.** The *phantom
process* limit reaps a background app's child processes past a cap (32 by default), which a node build with
workers reaches by itself. It is not the OEM killer and the battery settings above do not touch it. Without a
PC it is still reachable, over wireless debugging on the device itself:

```bash
pkg install android-tools
# Developer options → Wireless debugging → Pair device with pairing code
adb pair localhost:<pair-port>          # the code the dialog shows
adb connect localhost:<connect-port>    # the port on the Wireless debugging screen
adb shell "settings put global settings_enable_monitor_phantom_procs false"
adb shell "/system/bin/device_config set_sync_disabled_for_tests persistent"
adb shell "/system/bin/device_config put activity_manager max_phantom_processes 2147483647"
```

It resets on reboot. Check whether it is the cause before spending the evening on it: if the convert dies
around the same *stage* every time rather than after the same *elapsed time*, it is the phantom killer.

*Our half, and it is the one that makes the kill survivable.* **A convert that is killed is resumed, not
restarted.** `scripts/phone.sh` passes `--checkpoints "$OUT/.pack-checkpoints"` to the pack, which journals
every weld chunk, and adds `--resume` on the next run when that journal is there — so a run that dies at
minute 40 of 50 costs the last chunk rather than all fifty. The finished chunks replay onto fresh state and
the pak is assembled after the loop, never during it, which is why deleting the half-written `pak/` first is
correct. `REBUILD=1` deletes the journal with the pak; a successful convert deletes it too, because it is a
rope for a crash rather than an artefact and it holds a full copy of every chunk's produced inputs.

**What guards a resume here, exactly — the guard is NOT the one pmb has.** `opensa-pack`'s own refusal
compares the CHUNK PLAN and nothing else, so a journal written with `TEXTURES=astc` would replay into an
`rgba8` run without a word. The full "the sources, the flags or the code moved" check lives in **pmb's**
`resume.json` (pmb plan 006), and this script drives `opensa-pack` directly, so it does not get it. What
covers the gap is a recipe stamped beside the journal by `phone.sh` — game path, rect, textures, bake,
map-objects, models, vehicles, peds — and compared before `--resume` is added:

| The journal | What happens |
| --- | --- |
| absent | a normal convert; the recipe is stamped |
| same recipe | **resumed** at the first chunk without a checkpoint |
| different recipe | **refused**, both recipes printed, `REBUILD=1` offered — resuming across it would weld the old chunks into the new pak and no set of flags would reproduce the result |
| no stamp (written before 2026-08-25) | dropped once, with a line saying so, and the convert starts fresh |

The panel's preflight says *"unfinished convert"* when a journal is sitting there without a pak, so the
answer to "did I lose the forty minutes" is on screen before it is asked.

**And the log outlives the kill.** `build/.phone/panel-jobs.log` gets every job line as it is printed,
unbuffered, because the panel's own ring buffer dies with the panel — which is the same event. After a
restart the panel replays that tail, so the two questions worth asking about a kill (*which stage* and *how
long in*) can be answered from the file rather than from having watched it:

```bash
tail -40 build/.phone/panel-jobs.log     # where it stopped
grep -c chunk build/.phone/panel-jobs.log # how far the weld got
```

## What this does to the measurement plan

[201](../plans/201-dispatch-console/readme.md) is written as *desktop baseline first, phone second* — chain 1
takes its before/after on a desktop and chain 2 re-takes it on a phone. **With no desktop, that ordering does
not hold as written.** Two honest ways out, and the chain says which it took rather than quietly producing
one column:

1. **The phone is the baseline.** Everything is measured on the one machine there is. The numbers stop being
   comparable to the repo's existing desktop rows — which the mobile benchmark schema
   ([200/1-02](../plans/200-platform-reach/1-device-truth/readme.md)) already declares as a rule — and in
   exchange every number is taken on the device the product actually targets.
2. **A desktop is borrowed** for the baseline only, and the phone rows stay the ones that decide anything.

Option 1 is the more honest default here: the console's whole point is that it runs on a phone, and a
baseline taken somewhere the product will never run is a baseline that flatters it.

## Where things are on the phone (read before writing a command with a path in it)

Paths here are not guessable, and two of them are not where the Termux documentation says they are. Measured
2026-08-09 on the device this chain is captured on:

| What | Path | Notes |
| --- | --- | --- |
| the repo | `~/opensa` | `/data/data/com.termux/files/home/opensa` |
| the game copy | `game-src/original` → `~/storage/downloads/New Folder` | holds `data/` + `models/`; **`~/storage/downloads` is a REAL directory inside Termux's private home**, not the usual `termux-setup-storage` symlink into shared storage |
| the pristine distribution | `/storage/emulated/0/Download/GTA CORP.rar` | `GTA_CORP/{data,models,SAMP}` — `models/gta3.img` 1 093 664 768 B, `gta_int.img` 198 545 408 B. **This is the restore source**; `pkg install unrar`, then `unrar e <rar> "GTA_CORP/models/<file>" ./` pulls single files without unpacking 2 GB |
| build output | `build/phone-ls` → `/storage/emulated/0/Download/opensa-build/phone-ls` | on SHARED storage, deliberately outside the game copy — see the symlink rule below |
| volumes | `/storage/emulated` only | no SD card, so there is no second place to look |

**Two search traps this cost a session to learn.** `~/storage/shared` does not exist here, and `find` does not
descend into a symlink it is GIVEN unless you pass `-L` — so `find ~/storage/shared …` returns silence that
reads exactly like "there is no copy of the game on this phone". Search `/storage/emulated/0` for the shared
side and `~` for the Termux-private side, and remember they are different filesystems with different free
space.

## Practical notes

- **The whole setup is `pkg install nodejs-lts git` and then `npm run phone:setup`** — once per device. A
  plain `npm install` is NOT the normal path here: the full tree pulls 1171 packages whose prebuilt binaries
  are `linux-x64-gnu`, and it is the step most likely to fail on arm64. Setup passes `--omit=dev` (173
  packages, none of which the convert path touches) and `HUSKY=0`, and it is idempotent, so re-running it
  after a failure or a reboot repeats nothing. Then `npm run phone` for every run
  ([mobile-pak.md](./mobile-pak.md)).
- **`npm run phone` now takes the wake lock itself** for the duration of a convert and releases it on the way
  out (including on Ctrl+C and on the session closing), so there is nothing to remember. `termux-wake-lock` /
  `termux-wake-unlock` by hand still work for anything else long-running; both need `pkg install termux-api`.
  A wake lock keeps the CPU from sleeping and does NOT stop Android killing the app — see "The two that
  actually bite" above for what does.
- The dev server binds fine; reach it from the phone's browser at `localhost`, and from another device on the
  same network with `npm run dev -- --host`.
- Storage: the built game lives under `build/<game>/opensa`, and a field run reads that and nothing else
  ([restrictions/architecture.md](../restrictions/architecture.md)). Keep it on internal storage — shared
  storage via `termux-setup-storage` is slower and has different permission behaviour.
- **Symlinking `build/*` or `game-src/*` into shared storage is normal here, and two of those links must never
  land on one folder.** On 2026-08-09 `game-src/original`, `build/phone`, `build/phone-ganton`, `build/phone-ls`
  and `build/phone-ls-rgba8` all resolved to the same directory: every convert overwrote the previous pak (an
  A/B that kept one build), and — worse — the converter's `--out` was its own `--game`, so it rewrote the
  archives it was reading (`gta3.img` 1325 → 1145 MB, and a district that measured 597 texture layers came out
  with 49). Nothing said so; the paths had different names. `guardOut` now compares REAL paths and refuses it
  (`tools/tool-kit/src/game-dir.ts`), and `npm run phone` repeats the check before it deletes anything — but
  **a game copy already fed to a run in this shape is damaged and has to be restored from a clean copy.**
  `readlink -f game-src/* build/*` is the one-line way to see it.
  The damage is bounded and measurable: `rewriteOptimizedArchives` touches `models/*.img` and nothing else, so
  `data/` survives and only the archives that HELD converted models are rewritten. Measured on that copy with
  [`img-census.ts`](../debug/README.md) — `gta3.img` 1073 `.osm` bundles, `gta_int.img` 155, `cutscene.img` and
  `player.img` clean. Restoring those two files from a pristine install is the whole repair; the deleted `.dff`
  are not recoverable from the rewritten archive.
- **A downloaded Linux binary resolves no names here, and it looks exactly like a blocked network.** Android
  ships no `/etc/resolv.conf`. Termux's own tools go through Bionic and never notice, but a statically linked
  Go binary carries its own resolver: it finds no file, falls back to `127.0.0.1:53`, and nothing answers
  there — a port under 1024 is not bindable by an app uid, so there is nothing to run on it either. Measured
  2026-08-28 with ngrok, where every dial failed as `lookup connect.ngrok-agent.com on [::1]:53: read:
  connection refused` and read for half an hour as a carrier blocking 443. Hand the binary a resolv.conf
  through `proot`, wrapped under the original name so anything spawning it by name gets the wrapper:

  ```bash
  pkg install proot
  printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n' > $PREFIX/etc/resolv.conf
  mv $PREFIX/bin/ngrok $PREFIX/bin/ngrok.real
  printf '#!%s/bin/sh\nexec proot -b %s/etc/resolv.conf:/etc/resolv.conf %s/bin/ngrok.real "$@"\n' \
    "$PREFIX" "$PREFIX" "$PREFIX" > $PREFIX/bin/ngrok
  chmod +x $PREFIX/bin/ngrok
  ```

  `netlinkrib: permission denied` in the same log is a different thing and harmless — Android does not let an
  app read the interface list, and the binary carries on.

## The panel — the phone's own control surface

**`npm run panel`** starts [`tools-debug/phone-console`](../../tools-debug/phone-console/README.md) on
`http://localhost:8787`. Open it in the phone's browser and use the browser menu's **Add to Home screen**: it
ships a manifest and a service worker, so it installs as an app and opens full-screen. After that a field run
is taps rather than typing — preflight, `git pull`, `phone:setup`, the convert with its knobs, start/stop, the
links to the map, and the inbox that files a capture into `docs/benchmarks/` and commits it.

- **It binds `127.0.0.1`.** A page that runs commands is a shell; `PANEL_HOST=0.0.0.0` puts it on the network
  and the startup line says exactly that.
- **Starting it without a terminal:** Termux:Widget runs a script from a home-screen shortcut
  (`~/.shortcuts/panel` containing `cd ~/opensa && npm run panel`), and Termux:Boot starts one at boot
  (`~/.termux/boot/`). Both are separate F-Droid add-ons; neither is required — a Termux session works.
- **`termux-wake-lock` still applies.** The panel runs the convert as a child of the Termux session, so the
  session sleeping is the convert sleeping. `phone:setup` takes the lock when Termux offers one.

**`npm i <pkg>` writes into `package.json`, and on this device that stops the next `git pull`.** Measured
2026-08-23: `phone:setup` installed tsx with `npm i tsx`, which added it to `package.json`; the next pull
refused with *"Your local changes to the following files would be overwritten by merge"*, so the phone could
not take an update at all — and the symptom surfaced two steps later as a missing npm script. `phone:setup`
passes `--no-save` since, and the panel's preflight names the condition with the way back
(`git checkout -- package.json package-lock.json`). Install anything by hand here with `--no-save` too.

**A landmine the panel now reports rather than lets you discover.** `scripts/serve-static.ts` — the server
that hands out the pak on `:3001` — imports `sirv`, and `sirv` is a **devDependency** whose only other route
into the tree is `@vitest/browser`. `npm run phone:setup` installs with `--omit=dev`. On a device set up
strictly by the documented path the static server therefore cannot start, and because it is the server that
serves the world, the symptom is a map that loads nothing at all rather than an error about a missing module.
The panel's preflight checks for `sirv` by name; the fix, when a real device reports it, is
[`phone-console` plan 001/03](../../tools-debug/phone-console/docs/plans/001-the-panel.md).
