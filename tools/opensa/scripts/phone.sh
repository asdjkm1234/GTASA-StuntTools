#!/usr/bin/env bash
# One command for a phone run (plan 200 chain 4): convert what is missing, prove the pak is what it claims,
# serve it, print the URL to open. Re-running it is the normal case — everything already done is skipped, so
# the second run is just "servers up, here is the link".
#
#   npm run phone                     # convert (once) with the collision bake, serve, print the URL
#   DISTRICT=ganton npm run phone     # another measurement district (npx tsx scripts/district.ts lists them)
#   REBUILD=1 npm run phone           # re-convert even though a pak is already there
#   BAKE=0 OUT=./build/phone-plain npm run phone     # the OTHER side of the A/B: no --bake-collision
#   MODELS=0 npm run phone            # skip the model convert entirely: fast, but dispatch-only (no physics)
#   MAPOBJ=0 npm run phone            # convert the whole ~14k map-object catalogue, not just what the rect places
#   LODONLY=1 OUT=./build/phone-map3d npm run phone   # the baked 3D city map: the LOD tier as the only tier
#   VEHICLES=admiral,infernus PEDS=bmycg npm run phone     # convert a different subset
#   VEHICLES=all PEDS=all npm run phone                    # the whole roster (hours on a phone)
#   TEXTURES=rgba8 OUT=./build/phone-rgba8 npm run phone   # the texture-format A/B's other side
#   ASTC_THREADS=0 npm run phone      # one encoder worker per core (a desktop; it OOMs this phone)
#   HEAP=1536 npm run phone           # the node heap the convert reserves, MB (default 4096)
#   RECT=8,-8,11,-5 SPAWN=2495,-1687,20 npm run phone
#
# A PREBUILT app in `build/webapp` (or `WEBAPP=<dir>`) is used INSTEAD of the dev server, and then vite is
# never started at all. That is not a convenience: vite's rolldown binding dies with SIGILL on some arm64
# Android CPUs (loading the native binding kills the process before the wasm fallback is even consulted), so
# on those devices a dev server cannot run and a built copy served as static files is the only way in.
#
# Every knob is an env var so the command itself never changes. Ctrl+C stops the servers this run started
# (one it found already running is left alone); so does closing the Termux session, which sends HUP.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

WAKE_HELD=0
GAME="${GAME:-./game-src/original}"
OUT="${OUT:-./build/phone}"
# Both are routinely symlinks here (internal storage is small), and on 2026-08-09 they pointed at ONE folder:
# the convert then rewrote the archives it was reading, and the district came out with 49 texture layers where
# it had had 597. `guardOut` refuses this now, but it refuses it after the rm below, so the check is repeated
# up front — before anything is deleted.
if [ "$(readlink -f "$GAME" 2>/dev/null)" = "$(readlink -f "$OUT" 2>/dev/null)" ]; then
  echo "GAME and OUT are the same directory ($(readlink -f "$GAME")) — the convert would eat its own source." >&2
  echo "point OUT at a path outside the game copy, e.g. OUT=./build/phone-ls npm run phone" >&2
  exit 1
fi
# The DISTRICT decides the rect, the spawn and the map's opening point together, from one table
# (`apps/dispatch/src/world/districts.ts`) the console reads as well. It defaults to the one 201/1-01 PINNED,
# because a capture on any other ground is a valid measurement of somewhere else and not part of the chain's
# before/after series — which the first real mobile row found out after it was taken. RECT and SPAWN still
# override, for ground the table does not name.
DISTRICT="${DISTRICT:-los-santos-centre}"
BAKE="${BAKE:-1}"
MODELS="${MODELS:-1}"
# Convert only the map objects the rect PLACES, not all ~14 000 the IDEs name. ON here because this script
# always converts a DISTRICT: the rest are models this pak does not contain. MAPOBJ=0 converts the catalogue.
MAPOBJ="${MAPOBJ:-1}"
# LODONLY=1 builds the BAKED 3D CITY MAP (201/6-01): the cell LOD tier as the world's only tier. Not a
# quality setting — the LODs are a whole simplified city already, and a map is what they are the right shape
# for. Give it its own OUT: a pak with one tier and a pak with two are different builds, and the reuse check
# below refuses the mismatch rather than serving the wrong world.
LODONLY="${LODONLY:-0}"
# ASTC by default (200/2-02): a quarter of rgba8's texture memory on the same texels, and the format this
# class of GPU actually carries. It costs an encode stage in the convert — `TEXTURES=rgba8` is the way back
# and the A/B's other side. `bc` is desktop-only and would fail the --platforms mobile line below.
TEXTURES="${TEXTURES:-astc}"
# astcenc worker threads. The library's default (0) is one per core; each worker is a V8 isolate reserving its
# own code range. Measured 2026-08-09, counting threads off `/proc/self/status` across module load, context
# creation and the encode itself:
#
#   --astc-threads 0 → +4 workers (one per core)   2 → +2 workers   1 → +0, the encode runs on the MAIN thread
#
# 1 is the setting that spawns nothing, and it is the default because this phone died three times at
# `encoding texture arrays` while the flag was on the command line — the cap reached the model dictionaries
# and NOT the world arrays, whose encoder was built with no options at all and kept one worker per core. That
# was the whole bug (fixed 2026-08-09, `threads` is now required so a third call site cannot inherit a
# default). With it fixed the encode ran: 1.1 M texels in 12.8 s, single-threaded. The setting stays at 1
# because it is what has been proven on this device; the cost is speed only (astcenc's pool measured 2.38x one
# thread on 2026-08-07, bit-identical either way). `ASTC_THREADS=0` restores one-per-core for a machine that
# can afford it.
#
# WORTH RETRYING, and nobody has: the three deaths were caused by the bug FIXED on 2026-08-09, not by the
# thread count surviving it. `2` has not been tried since. The pool measured 2.38x one thread and is
# bit-identical, so it is a free 2x if the address space allows — pair it with a smaller HEAP (the isolates
# need room the 4096 MB reservation is holding) and a separate OUT, so a failed experiment costs nothing:
#
#   HEAP=1536 ASTC_THREADS=2 REBUILD=1 OUT=./build/phone-ls-t2 npm run phone
ASTC_THREADS="${ASTC_THREADS:-1}"
# The default is a SUBSET, because converting the roster costs hours on a phone and a field run needs a
# handful of models. `all` restores the full convert. The player's model is added below whatever is asked
# for: without it the game boots with nobody to move (`GAME_CONFIG.mainCharacter`).
PLAYER_PED="${PLAYER_PED:-bmycg}"
VEHICLES="${VEHICLES:-admiral,infernus,comet}"
PEDS="${PEDS:-bmycg,wmycr}"
REBUILD="${REBUILD:-0}"
APP_PORT="${APP_PORT:-5173}"
WEBAPP="${WEBAPP:-build/webapp}"
STATIC_PORT="${STATIC_PORT:-3001}"
LOGS="build/.phone"
STARTED=()

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

# The LOCAL tsx, never `npx tsx`. On a phone npx is the slower path and, when the package cannot be resolved,
# it reaches for the network — which on a field run means a convert that hangs on a captive portal instead of
# saying what is missing. This says it instead, and names the command that installs it.
TSX=node_modules/tsx/dist/cli.mjs
if [ ! -f "$TSX" ]; then
  echo "no $TSX — run: npm run phone:setup" >&2
  exit 1
fi
tsx() { node "$TSX" "$@"; }

# The district's numbers, read from the table the console reads — never typed twice. RECT/SPAWN set in the
# environment still win, so ground the table does not name is still reachable.
if ! DISTRICT_LINE="$(tsx scripts/district.ts "$DISTRICT")"; then
  echo "  npx tsx scripts/district.ts   # lists the districts and which one 201/1-01 pinned" >&2
  exit 1
fi
read -r DISTRICT_RECT DISTRICT_SPAWN DISTRICT_AT <<<"$DISTRICT_LINE"
RECT="${RECT:-$DISTRICT_RECT}"
SPAWN="${SPAWN:-$DISTRICT_SPAWN}"
AT="${AT:-$DISTRICT_AT}"

# Node rather than curl/nc: node is the one tool this repo already requires, and Termux ships neither of the
# other two by default.
port_open() {
  node -e "
const s = require('net').connect($1, '127.0.0.1');
s.setTimeout(800);
s.on('connect', () => { s.end(); process.exit(0); });
s.on('error', () => process.exit(1));
s.on('timeout', () => process.exit(1));
" 2>/dev/null
}

wait_port() {
  for _ in $(seq 1 90); do
    port_open "$1" && return 0
    sleep 1
  done

  return 1
}

lan_ip() {
  node -e "
const nets = require('os').networkInterfaces();
for (const list of Object.values(nets)) {
  for (const net of list ?? []) {
    if (net.family === 'IPv4' && !net.internal) { console.log(net.address); process.exit(0); }
  }
}
"
}

# 1 — the install. Without it nothing below can mean anything, so it fails here rather than three minutes in.
if [ ! -f "$GAME/data/gta.dat" ]; then
  echo "no $GAME/data/gta.dat — put the PC game's data/ and models/ there first (docs/development/mobile-pak.md)" >&2
  exit 1
fi

# 2 — convert, but only when there is nothing to run on. A phone convert is minutes to hours; re-running this
# script must not silently repeat it.
if [ "$REBUILD" = 1 ] || [ ! -f "$OUT/pak/manifest.json" ]; then
  # The heap the convert asks for. The ASTC-specific reduction that briefly lived here was aimed at the wrong
  # cause — the real one was a call site that never received `--astc-threads` and kept spawning a worker per
  # core (see the note above). The knob stays because it is genuinely useful on a small device, and because
  # the failure count did fall with it (six lost isolates at 4 GB, two at 2 GB), but the default is the value
  # the model and collision stages were built around.
  HEAP="${HEAP:-4096}"
  # The RESOLVED path, because `OUT` is routinely a symlink on a phone (internal storage is small, so build
  # output is pointed at shared storage) and two different OUT names can be the same directory. On 2026-08-09
  # four of them were: `phone`, `phone-ganton`, `phone-ls` and `phone-ls-rgba8` all resolved to one folder, so
  # every convert overwrote the last and the A/B that was supposed to keep two paks apart kept one.
  REAL_OUT="$(cd "$(dirname "$OUT")" 2>/dev/null && pwd -P)/$(basename "$OUT")"
  REAL_OUT="$(readlink -f "$OUT" 2>/dev/null || echo "$REAL_OUT")"
  # Held for the CONVERT only, and released on the way out however this exits (`cleanup` below runs on
  # HUP/INT/TERM/EXIT). Without it Android suspends the process the moment the screen goes off. It is not a
  # cure for being killed outright — nothing in userspace is — which is what the checkpoints above are for.
  if command -v termux-wake-lock >/dev/null 2>&1; then
    termux-wake-lock && WAKE_HELD=1 && say "wake lock held for the convert"
  else
    echo "   no termux-wake-lock (pkg install termux-api) — the convert dies when the screen sleeps" >&2
  fi
  say "converting $GAME → $OUT (rect $RECT, textures=$TEXTURES, astc-threads=$ASTC_THREADS, heap=${HEAP}m, bake=$BAKE, models=$MODELS)"
  [ "$REAL_OUT" != "$(readlink -f . 2>/dev/null)/${OUT#./}" ] && echo "   → real path: $REAL_OUT"
  # A REBUILD is a rebuild: the previous pak's products are removed first. Without this the convert writes
  # into a directory that still holds the last one, and a run can inherit archives it never converted — which
  # is how a district that reads 597 texture layers on one build came out with 49 on the next.
  if [ -d "$OUT/pak" ]; then
    echo "   removing the previous pak in $OUT/pak (a rebuild starts from nothing)"
    rm -rf "$OUT/pak"
  fi
  # A rebuild starts from nothing, and the journal is part of that nothing: replaying yesterday's chunks into
  # a pak that was just deleted is the one way a resume can produce a tree nobody can account for.
  [ "$REBUILD" = 1 ] && rm -rf "$OUT/.pack-checkpoints"

  # A convert that is killed is RESUMED, not restarted.
  #
  # This device does not decide when a convert ends: Android does. Termux gets killed with the screen ON and
  # the app merely backgrounded (2026-08-25, EMUI), and a run that died at minute 40 of 50 used to cost all
  # fifty. The pack journals every weld chunk under `$CKPT` and `--resume` re-enters at the first chunk
  # without one, replaying the finished ones onto fresh state — so deleting the half-written `pak/` above is
  # correct and costs nothing: the pak is assembled after the loop, never during it.
  #
  # **The pack's own refusal covers ONE thing: a different CHUNK PLAN.** `openCheckpoints` compares the chunk
  # rects and nothing else, so a journal written with `TEXTURES=astc` would replay happily into an
  # `rgba8` run and produce a pak whose contents no set of flags reproduces — silently, which is the exact
  # failure the resume rule exists to prevent. (The full "sources, flags or code moved" guard lives in pmb's
  # `resume.json`; this script drives `opensa-pack` directly and does not get it.) So the recipe is stamped
  # beside the journal here, and a resume over a changed one is refused with the difference named.
  CKPT="$OUT/.pack-checkpoints"
  RECIPE_NOW="GAME=$(readlink -f "$GAME" 2>/dev/null || echo "$GAME")
RECT=$RECT
TEXTURES=$TEXTURES
BAKE=$BAKE
MAPOBJ=$MAPOBJ
LODONLY=$LODONLY
MODELS=$MODELS
VEHICLES=$([ "$MODELS" = 0 ] && echo '-' || echo "$VEHICLES")
PEDS=$([ "$MODELS" = 0 ] && echo '-' || echo "$PEDS")"
  args=(--game "$GAME" --out "$OUT" --textures "$TEXTURES" --max-texture 256 --rect "$RECT" --no-ao --platforms mobile
        --checkpoints "$CKPT")
  if [ -d "$CKPT" ] && [ "$REBUILD" != 1 ]; then
    if [ ! -f "$CKPT/.recipe" ]; then
      # A journal from before the stamp existed. Its recipe is unknowable, so it cannot be resumed — but
      # refusing and demanding REBUILD=1 costs the same convert as dropping it and says something alarming
      # for what is really just an upgrade. Drop it, say so, convert.
      say "the journal in $CKPT predates the recipe stamp — starting this convert fresh (once)"
      rm -rf "$CKPT"
    elif [ "$(cat "$CKPT/.recipe")" = "$RECIPE_NOW" ]; then
      say "resuming the last convert from $CKPT (REBUILD=1 starts over)"
      args+=(--resume)
    else
      echo "resume refused: the journal in $CKPT was written for a different recipe." >&2
      echo "  it holds:  $(tr '\n' ' ' <"$CKPT/.recipe")" >&2
      echo "  you asked: $(echo "$RECIPE_NOW" | tr '\n' ' ')" >&2
      echo >&2
      echo "Resuming across that would weld the old chunks into the new pak, and no set of flags would" >&2
      echo "reproduce the result. Either put the knob back, or start over:" >&2
      echo "  REBUILD=1 npm run phone" >&2
      exit 1
    fi
  fi
  mkdir -p "$CKPT" && printf '%s' "$RECIPE_NOW" >"$CKPT/.recipe"
  [ "$TEXTURES" = astc ] && [ "$ASTC_THREADS" != 0 ] && args+=(--astc-threads "$ASTC_THREADS")
  # Said out loud because it is the slow setting and the log otherwise looks stuck: the encode is the LAST
  # stage, and on this device it is the one that has to run without spawning a single worker isolate.
  [ "$TEXTURES" = astc ] && [ "$ASTC_THREADS" = 1 ] && say "astc: single-threaded encode (no worker isolates — slower, and it survives)"
  [ "$BAKE" = 1 ] && args+=(--bake-collision)
  [ "$MAPOBJ" = 1 ] && args+=(--map-objects-in-rect)
  [ "$LODONLY" = 1 ] && args+=(--lod-only)
  [ "$MODELS" = 0 ] && args+=(--no-models)
  if [ "$MODELS" != 0 ]; then
    [ "$VEHICLES" != all ] && args+=(--vehicles "$VEHICLES")
    if [ "$PEDS" != all ]; then
      case ",$PEDS," in
        *",$PLAYER_PED,"*) ;;
        *) PEDS="$PLAYER_PED,$PEDS" ;;
      esac
      args+=(--peds "$PEDS")
    fi
  fi
  # --platforms mobile fails the pack when anything it wrote needs a GPU feature a phone lacks (BC), so a pak
  # that survives this line is one the device can actually open.
  # (On success the journal is deleted just below — it is a rope for a crash, not an artefact, and it holds a
  #  full copy of every chunk's produced inputs on a device the doctor already warns about free space on.)
  if ! NODE_OPTIONS="--max-old-space-size=$HEAP" tsx tools/opensa-pack/src/cli.ts "${args[@]}"; then
    echo "convert failed — nothing was served" >&2
    if [ "$TEXTURES" = astc ]; then
      echo >&2
      echo "the ASTC encode is the LAST stage, so the district converted and only the re-encode died." >&2
      echo "it is also 97% of a map-only run's wall clock and it is NOT checkpointed: the weld resumes, the" >&2
      echo "encode restarts (measured 2026-08-25 — 77s of weld, ~2550s of encode, killed at 6m25s)." >&2
      echo "  docs/benchmarks/tools/2026-08-25-phone-map-only-astc-encode-wall.md" >&2
      echo "  docs/in-reserve/opensa-pack-encode-checkpoints.md  ← what it would take to make it resumable" >&2
      echo "next, in order of cost:" >&2
      echo "  TEXTURES=rgba8 REBUILD=1 npm run phone  # skips the stage entirely; 4x the texture memory" >&2
      echo "  DISTRICT=los-santos-centre npm run phone  # 4 cells instead of 16 — a quarter of the texels" >&2
      echo "  HEAP=1536 REBUILD=1 npm run phone     # less reserved address space for the isolates to fit in" >&2
    fi
    exit 1
  fi
  rm -rf "$CKPT"
else
  # Reuse is the normal case — but only after the pak on disk is asked whether it is the one being requested.
  # Until this check existed, `RECT=8,-8,11,-5 npm run phone` over an existing pak served the OLD district and
  # said nothing: the knobs above are read only on the convert branch, so a mismatch was invisible on screen
  # and in the log. Same for the collision A/B, where the two sides differ by one flag and nothing else.
  say "pak already at $OUT/pak (REBUILD=1 to redo it)"
  expect=(--expect "rect=$RECT" --expect "bakeCollision=$([ "$BAKE" = 1 ] && echo true || echo false)"
          --expect "mapObjectsInRect=$([ "$MAPOBJ" = 1 ] && echo true || echo false)"
          --expect "lodOnly=$([ "$LODONLY" = 1 ] && echo true || echo false)"
          --expect "textures=$TEXTURES"
          --expect "models=$([ "$MODELS" != 0 ] && echo true || echo false)")
  if [ "$MODELS" != 0 ]; then
    expect+=(--expect "vehicles=$VEHICLES")
    if [ "$PEDS" = all ]; then
      expect+=(--expect "peds=all")
    else
      case ",$PEDS," in
        *",$PLAYER_PED,"*) expect+=(--expect "peds=$PEDS") ;;
        *) expect+=(--expect "peds=$PLAYER_PED,$PEDS") ;;
      esac
    fi
  fi
  if ! tsx scripts/debug/pak-recipe.ts "$OUT/pak" "${expect[@]}"; then
    echo >&2
    echo "nothing was served. Either re-convert into this folder:" >&2
    echo "  REBUILD=1 npm run phone" >&2
    echo "or keep both and serve the other one from its own folder:" >&2
    echo "  OUT=./build/phone-$(date +%H%M) npm run phone" >&2
    exit 1
  fi
fi

# 3 — what the pak actually carries. The first line is the collision GRID: a bake keyed on the render grid
# renders perfectly and drops the player through the world, and nothing else would ever say so.
say "pak check"
tsx scripts/debug/dump-cell-collision.ts "$OUT/pak"
# What the textures actually cost this device, read off the manifest rather than assumed — the `as built` row
# is the one to compare between two runs of the A/B above.
tsx scripts/debug/texture-budget.ts "$OUT/pak"

# 4 — servers. Each is started only if its port is free, so re-running this reuses what is already up.
mkdir -p "$LOGS"
if port_open "$STATIC_PORT"; then
  say "static server already on :$STATIC_PORT"
else
  say "starting the static server on :$STATIC_PORT → $LOGS/static.log"
  # `node <entry>` rather than `npm run …`: an npm wrapper puts a shell and a node process between us and the
  # server, and killing the wrapper leaves the server holding the port — which is the difference between
  # Ctrl+C working and the next run finding :$STATIC_PORT busy.
  node node_modules/tsx/dist/cli.mjs scripts/serve-static.ts >"$LOGS/static.log" 2>&1 &
  STARTED+=($!)
fi
PREBUILT=0
if [ -f "$WEBAPP/index.html" ]; then
  PREBUILT=1
  say "prebuilt app at $WEBAPP — serving it as static files (no dev server)"
elif port_open "$APP_PORT"; then
  say "app already on :$APP_PORT"
else
  say "starting the app on :$APP_PORT → $LOGS/app.log"
  node node_modules/vite/bin/vite.js --host --port "$APP_PORT" >"$LOGS/app.log" 2>&1 &
  STARTED+=($!)
fi

# Children first, then the process itself: esbuild (tsx) and vite both keep a helper process, and killing the
# parent alone can leave one holding the port.
kill_tree() {
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do
    kill_tree "$child"
  done
  kill "$1" 2>/dev/null
}

cleanup() {
  local pid
  for pid in ${STARTED[@]+"${STARTED[@]}"}; do
    kill_tree "$pid"
  done
  # Only if THIS run took it: a second session's lock is not ours to drop.
  [ "${WAKE_HELD:-0}" = 1 ] && termux-wake-unlock >/dev/null 2>&1
}
trap cleanup HUP INT TERM EXIT

ports=("$STATIC_PORT")
[ "$PREBUILT" = 0 ] && ports+=("$APP_PORT")
for port in "${ports[@]}"; do
  if ! wait_port "$port"; then
    echo "port $port never opened — see $LOGS/*.log" >&2
    exit 1
  fi
done

# 5 — the link. `localhost` is a SECURE CONTEXT, so on the phone itself Cache Storage works and the download
# is kept; the LAN address is plain http, where it is not (the shell says so under the preloader).
#
# With a SUBSET converted, the traffic spawners are turned off in the URL. This is not tidiness: a car outside
# `--vehicles` kept its original BC textures, and on a device without BC the first parked car or generator to
# reach for one ends the run. `?parked=0&cargen=0` is the pair that stills the world (`parked=0` alone does
# not — the generators are the larger half, ~962 placements against ~212).
GATE=""
if [ "$MODELS" != 0 ] && { [ "$VEHICLES" != all ] || [ "$PEDS" != all ]; }; then
  GATE="&parked=0&cargen=0"
fi
PAK_URL="http://localhost:$STATIC_PORT/${OUT#./}"
IP="$(lan_ip)"
# One origin when the app is prebuilt (it is served by the same static server as the pak): no CORS, no second
# port, and — the reason it matters on a phone — no vite.
if [ "$PREBUILT" = 1 ]; then
  APP_URL="http://localhost:$STATIC_PORT/${WEBAPP#./}/index.html"
  MAP_URL="http://localhost:$STATIC_PORT/${WEBAPP#./}/dispatch.html"
  LAN_APP="http://$IP:$STATIC_PORT/${WEBAPP#./}/index.html"
  LAN_PAK="http://$IP:$STATIC_PORT/${OUT#./}"
else
  APP_URL="http://localhost:$APP_PORT/"
  MAP_URL="http://localhost:$APP_PORT/dispatch.html"
  LAN_APP="http://$IP:$APP_PORT/"
  LAN_PAK="http://$IP:$STATIC_PORT/${OUT#./}"
fi
# Every map URL carries `district=`, and the console takes its opening point from that name — so the ground
# the run looks at and the ground the capture is FILED under cannot disagree.
MAP_QUERY="src=$PAK_URL&district=$DISTRICT&at=$AT"
say "open on this phone"
if [ "$MODELS" = 0 ]; then
  echo "  MODELS=0 → no vehicles/peds were converted, so only the map surface is usable (it runs no physics,"
  echo "  which means it does not exercise the collision bake at all):"
  echo "  $MAP_URL?$MAP_QUERY"
else
  echo "  the game (this is the one that streams collision):"
  echo "  $APP_URL?loader=http-dir&src=$PAK_URL&spawn=$SPAWN$GATE"
  echo
  echo "  the map surface, no physics:"
  echo "  $MAP_URL?$MAP_QUERY"
fi
echo
echo "  the 201/1-01 inventory capture (let it settle past 300 frames, then press copy JSON):"
echo "  $MAP_URL?$MAP_QUERY&inventory=1"
if [ -n "$IP" ]; then
  echo
  echo "  from another device on this network (plain http → no Cache Storage, the shell will say so):"
  echo "  $LAN_APP?loader=http-dir&src=$LAN_PAK&spawn=$SPAWN$GATE"
fi
if [ -n "$GATE" ]; then
  echo
  echo "  converted: vehicles [$VEHICLES] · peds [$PEDS] — so the URL carries parked=0&cargen=0."
  echo "  Everything else kept its original (BC) textures and would fail to spawn on this GPU."
  echo "  VEHICLES=all PEDS=all npm run phone converts the roster and drops the gate (hours on a phone)."
fi
# 6 — the logs, FOLLOWED rather than named. Printing `tail -f …` as advice made the running terminal a dead
# end: the only way to type it was Ctrl+C, which stops the very servers whose logs were wanted. So this run
# holds the terminal on the logs themselves, and Ctrl+C still means "stop everything" through the trap below.
say "running — Ctrl+C stops the servers this run started (the logs follow below)"
logs=()
for file in "$LOGS/static.log" "$LOGS/app.log"; do
  [ -f "$file" ] && logs+=("$file")
done
if [ ${#logs[@]} -eq 0 ]; then
  # Nothing to follow: both servers were already up, so this run started no log of its own.
  echo "no log from this run — the servers were already running"
  wait
else
  # `-n 5` rather than the whole file: a reused log can be long, and what matters is what happens NEXT.
  tail -n 5 -f "${logs[@]}" &
  TAIL_PID=$!
  STARTED+=("$TAIL_PID")
  wait
fi
