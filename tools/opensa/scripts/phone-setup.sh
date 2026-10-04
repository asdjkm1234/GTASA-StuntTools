#!/usr/bin/env bash
# Everything a phone needs BEFORE its first run, once (201 chain 2 / the phone workflow):
#
#   npm run phone:setup     # install what the converter needs, unpack the app, say what is still missing
#   npm run phone           # every run after that
#
# It is idempotent — each step checks whether it is already done, so re-running it after a failure, a pulled
# commit or a reboot costs seconds and repeats nothing. It installs, and it never converts: the pak is
# `npm run phone`'s business, because that is the expensive half.
#
# Two things it deliberately does NOT do, both of which the hand-written recipe used to:
#
#   * `npm pkg delete scripts.prepare` — it edits package.json to get past husky, which leaves the worktree
#     dirty on the one machine where `git status` is hardest to read, and the edit eventually gets committed.
#     `HUSKY=0` is husky's own opt-out and touches nothing.
#   * `--omit=optional` — it looks like it skips the flaky linux-x64 dev binaries, but npm already filters
#     those by cpu/os; what it actually skips is `@esbuild/android-arm64`, the one binary tsx needs.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

GAME="${GAME:-./game-src/original}"
WEBAPP="${WEBAPP:-build/webapp}"

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
ok() { printf '   \033[32m✓\033[0m %s\n' "$1"; }
todo() { printf '   \033[33m→\033[0m %s\n' "$1"; }

say "environment"
echo "   node $(node -v 2>/dev/null || echo 'MISSING — pkg install nodejs-lts') · $(uname -m)"
if [ -n "${PREFIX:-}" ] && [ -d "/data/data/com.termux" ]; then
  ok "Termux"
  # Android suspends a long job the moment the screen goes off, and a convert is minutes to hours.
  command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock && ok "wake lock held (termux-wake-unlock releases it)"
fi

# 1 — runtime deps. --omit=dev is 173 packages instead of 1171: the dev toolchain (nx, rolldown, oxlint) is
# never on the convert path, and its prebuilt binaries are linux-x64-gnu, which is what fails on an arm64 phone.
#
# The check is STALENESS, not existence. npm writes `node_modules/.package-lock.json` on every install, so a
# repo lock newer than it means a pull brought dependencies this tree does not have. Existence alone reported
# "✓ node_modules present" after the merge that added `astc-encoder.js`, and the convert died on
# `Cannot find module 'astc-encoder.js'` minutes later, inside the stage that needed it — a setup step whose
# whole job is to make the next command work, saying yes to a tree that could not run it.
say "dependencies"
if [ -d node_modules ] && [ -f node_modules/.package-lock.json ] && [ ! package-lock.json -nt node_modules/.package-lock.json ]; then
  ok "node_modules present and current with package-lock.json (delete it and re-run to reinstall)"
else
  [ -d node_modules ] && echo "   package-lock.json is newer than the installed tree — a pull added deps"
  echo "   installing runtime deps (HUSKY=0 — a git hook is meaningless here)…"
  if ! HUSKY=0 npm install --omit=dev --no-audit --no-fund; then
    echo "npm install failed — see docs/development/mobile-pak.md for what usually bites" >&2
    exit 1
  fi
  ok "runtime deps installed"
fi

# tsx is a devDependency, so --omit=dev skipped it — and it is what runs every .ts entry point here.
#
# `--no-save`, and that word is the whole point: `npm i <pkg>` WRITES the package into package.json, which
# leaves the worktree dirty on exactly the machine this script exists for. On 2026-08-23 that dirt stopped a
# `git pull` outright ("Your local changes to the following files would be overwritten by merge:
# package.json") — the phone could not take an update at all, and the reason looked like a mistake the user
# had made. This script already refuses `npm pkg delete scripts.prepare` for that same reason two steps
# above; it must not undo the rule with its own next command.
if [ -d node_modules/tsx ]; then
  ok "tsx present"
else
  echo "   installing tsx…"
  HUSKY=0 npm i tsx --no-save --no-audit --no-fund || exit 1
  ok "tsx installed"
fi

# 2 — the app. Serving a built copy is not a fallback on a phone, it is the reliable path: vite's rolldown
# binding dies with SIGILL on some arm64 Android CPUs before printing a line, and no wasm fallback is
# reachable. With build/webapp present, phone.sh serves it as static files and never starts vite.
say "the app"
if [ -f "$WEBAPP/index.html" ]; then
  ok "$WEBAPP — served as static files, vite is not started"
elif [ -f prebuilt/opensa-webapp.tar.gz ]; then
  mkdir -p "$WEBAPP" && tar -xzf prebuilt/opensa-webapp.tar.gz -C "$WEBAPP" && ok "unpacked prebuilt → $WEBAPP"
  todo "delete $WEBAPP to use the dev server instead (only if vite runs on this device)"
else
  todo "no prebuilt archive — the dev server will be used (npm run dev)"
fi

# 3 — the game files. The converter reads the PC game; nothing here can substitute for them.
say "game files"
if [ -f "$GAME/data/gta.dat" ]; then
  ok "$GAME"
else
  todo "missing $GAME/data/gta.dat"
  echo "     copy the PC game's data/ and models/ into $GAME/ (~4.7 GB)."
  echo "     The Android game's files will NOT do — its textures are PVRTC/ETC and the parser skips them"
  echo "     silently, producing a world with no textures (docs/development/mobile-pak.md)."
fi

say "next"
if [ -f "$GAME/data/gta.dat" ]; then
  echo "   npm run phone          # converts once (minutes to hours), then serves and prints the URL"
  echo "   npm run phone          # every run after: servers up, here is the link"
else
  echo "   put the game files in place, then: npm run phone"
fi
echo "   docs/development/mobile-pak.md — the whole recipe and what usually goes wrong"
