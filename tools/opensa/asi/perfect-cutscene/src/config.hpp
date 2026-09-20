#pragma once
// perfect-cutscene's PAYLOAD switches (the framework's own — ASI_APPLY / ASI_DEBUG — live in the SDK's
// config.hpp). Per-fix flags allow bring-up bisection: enable one fix at a time under Wine.
#include <asi/config.hpp>

// The plugin's fixes are compiled only into an APPLY build; PC_APPLY mirrors the framework switch so the
// payload headers keep one name to gate on. Guarded, so a `-DPC_APPLY=…` on the command line is honoured.
#ifndef PC_APPLY
#define PC_APPLY ASI_APPLY
#endif

#ifndef PC_CENSUS
#define PC_CENSUS 0  // [step 2] log how each cutscene object classifies (observation only)
#endif

#ifndef PC_DEFER_ALPHA
#define PC_DEFER_ALPHA 0  // [step 3] the fix: translucent cutscene-vehicle atomics into the sorted alpha pass
#endif

#ifndef PC_CENSUS_LOG
#define PC_CENSUS_LOG 0  // 1 = trace per-clump atomic decisions into the log (make DEBUG=1)
#endif
