#pragma once
// Apply orchestration — perfect-vehicle's `asi::ApplyFn`. Runs the enabled fixes, each gated by config.hpp and
// by its own byte-verify. Compiled only into the APPLY build.
//
// Neither ceiling is a zone any adjuster claims: FLA's log on the reference install lists 3 712 memory changes
// and not one names an upgrade, a link or `carmods` (plan 001). So there is no adjuster-mask deferral here —
// the per-site byte verify is the referee, as it is everywhere else.
#include <asi/log.hpp>
#include <asi/plugin.hpp>

#include "config.hpp"

#if PV_FIX_LINKS
#include "patches/links.hpp"
#endif

namespace pv {

inline void ApplyPatches(asi::Log& log, const asi::Plugin& plugin, unsigned adjusterMask) {
#if PV_FIX_LINKS
  patches::ApplyLinks(log, plugin);
#endif

#if PV_FIX_UPGRADES
  log.Tagged(plugin.tag, "upgrades: TODO (002 second half — the per-car sidecar)");
#endif

  (void)adjusterMask;
  (void)plugin;
  (void)log;
}

}  // namespace pv
