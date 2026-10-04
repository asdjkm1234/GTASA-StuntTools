#pragma once
// perfect-vehicle's PAYLOAD switches (the framework's own — ASI_APPLY / ASI_DEBUG — live in the SDK's
// config.hpp). Per-fix flags allow bring-up bisection: enable one fix at a time under Wine.
#include <asi/config.hpp>

// The plugin's fixes are compiled only into an APPLY build; PV_APPLY mirrors the framework switch so the
// payload headers keep one name to gate on. Guarded, so a `-DPV_APPLY=…` on the command line is honoured.
#ifndef PV_APPLY
#define PV_APPLY ASI_APPLY
#endif

#ifndef PV_FIX_LINKS
#define PV_FIX_LINKS 1  // [002] carmods.dat `link` pairs 30 → 256. No adjuster has a setting for it.
#endif

#ifndef PV_FIX_UPGRADES
#define PV_FIX_UPGRADES 0  // [002] m_anUpgrades[18] per car → a sidecar. RE done (plan 001), NOT built: nothing needs it yet (the fleet's fullest car lists 15 of the 16), and the installer refuses past 16.
#endif

#ifndef PV_LINKS_LOG
#define PV_LINKS_LOG 0  // 1 = trace every link pair our writer takes into the log
#endif
