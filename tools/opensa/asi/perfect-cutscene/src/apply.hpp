#pragma once
// Apply orchestration — perfect-cutscene's `asi::ApplyFn`. Runs the enabled fixes, each gated by config.hpp.
// Compiled only into the APPLY build.
//
// Coexistence: every site this plugin owns lives in the CUTSCENE-object / entity-render path, which no limit
// adjuster touches (FLA and OLA relocate pools and placement arrays) — so the fixes apply regardless of the
// adjuster mask, and each one still verify-and-defers on its own bytes before writing.
#include <asi/log.hpp>
#include <asi/plugin.hpp>

#include "config.hpp"

#if PC_CENSUS
#include "patches/cutscene-load.hpp"
#endif

#if PC_DEFER_ALPHA
#include "patches/defer.hpp"
#endif

namespace pc {

inline void ApplyPatches(asi::Log& log, const asi::Plugin& plugin, unsigned adjusterMask) {
#if PC_CENSUS
  patches::ApplyCutsceneLoad(log, plugin);  // observation only — logs how each cutscene object classifies
#endif

#if PC_DEFER_ALPHA
  patches::ApplyDefer(log, plugin);  // the fix: cutscene vehicles join the sorted entity pass
#endif

#if !PC_CENSUS && !PC_DEFER_ALPHA
  log.Tagged(plugin.tag, "scaffold build: no payload enabled yet (plan 001 step 1) — patching nothing");
#endif

  (void)adjusterMask;
  (void)plugin;
  (void)log;
}

}  // namespace pc
