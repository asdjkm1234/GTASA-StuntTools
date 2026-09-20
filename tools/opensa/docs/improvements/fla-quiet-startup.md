# `fla-quiet` — close FLA's monthly "main window" without the hand-typed code

**Original SA only** — this concerns the `sa` target's real install (OLA + FLA + `perfect-map.asi`); the
OpenSA engine has no FLA. Parked 2026-08-19 on the user's call: designed, not built.

## The annoyance

fastman92 limit adjuster 6.5 shows a modal dialog at startup — the **"FLA main window"**: a donation note,
a link to the forum and a latest-version check (`DialogBoxParamA`; strings `NOTE_FROM_AUTHOR`, `SPENDE_*`,
`LATEST_VERSION_URL` in `$fastman92limitAdjuster.asi`). The game does not start until **Continue** is
pressed. The ini suppresses it with `[MAIN] FLA main window disable code = XXXXX-XXXXX-…`, but the code is
**time-bound** (the module imports `GetSystemTime`) and changes every month, so it has to be fetched from
fastman92.com and re-entered into `mods-src/original/mods/sa/6. fastman92 limit adjuster 6.5 (stable)/
fastman92limitAdjuster_GTASA.ini` (and the bottle) again and again. The dialog is shown **before the game
starts** — the field observation that fixes the design below — most likely straight from FLA's `DllMain`,
when no later-loading ASI exists yet.

## Say it plainly

This is the author's chosen donation reminder and his monthly code is the mechanism that keeps people
visiting his site. Closing it by machine is a circumvention of a freeware author's nag, however mild. On
one's own install that is one's own business; **it must not ride in the pmb tree or in anything we
distribute** — it is a hand-installed local convenience, and the doc that describes it says so.
Alternatives that keep his mechanism intact: a script that once a month fetches the published code and
writes it into the ini (+ bottle), or asking fastman92 whether permanent codes exist for projects/donors.

## The design (if it is ever built)

A separate plugin, **not** perfect-map — `asi/fla-quiet`, on `asi/sdk`, its own README/Makefile
(`asi-plugin.mk`), `npm run build:asi -w @opensa/fla-quiet-asi`, **never wired into pmb**.

- **Name `!fla-quiet.asi`** — `!` (0x21) sorts before `$` (0x24), so the ASI loader loads it before
  `$fastman92limitAdjuster.asi`. `perfect-map.asi` stays AFTER FLA, as 004/011 require (they overlay FLA's
  jmps; whichever writes last owns the bytes — loading perfect-map first would lose the int16 fix).
- **Win32, not byte-patching.** In `DllMain`: `SetWindowsHookEx(WH_CBT, proc, nullptr, GetCurrentThreadId())`
  — FLA shows the dialog on the main thread. On `HCBT_ACTIVATE`: window class `#32770`, title/text naming
  fastman92 / limit adjuster, a child button captioned **Continue** → `PostMessage(button, BM_CLICK, 0, 0)`
  (= the user pressed Continue; FLA proceeds down its normal path), unhook after the first match, log
  `fla-quiet.log` ("dialog seen and closed" / "not seen"). Nothing written into anyone's code; independent
  of FLA's version and of `user32`'s prologues (which under Wine/CrossOver are NOT Microsoft's — an inline
  hook on `DialogBoxParamA` is the wrong tool there). An IAT hook on FLA's import table would suppress the
  dialog without a flash, but needs FLA's module loaded, which contradicts loading first.
- **Cost**: the dialog flashes for one frame.
- **Risk to verify first, by log**: ASI load order under Wine follows `FindFirstFile` order, which on APFS
  is not guaranteed alphabetical (it has held for perfect-map — every attach logs `adjuster present:
  fastman92 (FLA)`, i.e. FLA was already there). `!fla-quiet.asi` checks at attach that FLA's module is NOT
  yet loaded and logs `too late — FLA already loaded` instead of hooking if it is.
- Size: ~100 lines of C++ + docs, one field round.

## When it is picked up

Promote to `asi/fla-quiet/docs/plans/001-…` with the field round; record the FLA window facts above in
`docs/gta-sa-original/` (they are facts about the adjuster, not about us) and the local-only rule in the
plugin's README; a row in `docs/commands.md` for the build command.
