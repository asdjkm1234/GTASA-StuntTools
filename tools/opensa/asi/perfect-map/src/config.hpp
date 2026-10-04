#pragma once
// perfect-map's PAYLOAD switches (the framework's own — ASI_APPLY / ASI_DEBUG — live in the SDK's config.hpp).
// Per-fix flags allow bring-up bisection: enable one fix at a time under Wine.
#include <asi/config.hpp>

// The plugin's fixes are compiled only into an APPLY build; PM_APPLY mirrors the framework switch so the
// payload headers keep one name to gate on. Guarded, so a `-DPM_APPLY=…` on the command line is honoured
// rather than silently overridden (an unguarded #define here made per-fix bisection flags a no-op).
#ifndef PM_APPLY
#define PM_APPLY ASI_APPLY
#endif

#ifndef PM_FIX_INT16
#define PM_FIX_INT16 1  // IplDef int16 pool-range → int32 sidecar (the root 2^15 fix). No adjuster fixes this.
#endif

#ifndef PM_FIX_INT16_DUMMY
#define PM_FIX_INT16_DUMMY 1  // [011] the DUMMY half of the int16 lift (firstDummy/lastDummy) — requires PM_FIX_INT16; bisectable on its own
#endif

#ifndef PM_FIX_FX2DFX
#define PM_FIX_FX2DFX 1  // [009] 2dfx fx-system use-after-free — null-guard FxSystem_c::Stop/Play. Fx zone; no adjuster touches it.
#endif

#ifndef PM_FIX_LOADEDBUILDINGS
#define PM_FIX_LOADEDBUILDINGS 0  // [004b] gpLoadedBuildings 4096 relocation — not yet implemented
#endif

#ifndef PM_FIX_IPLINDEX
#define PM_FIX_IPLINDEX 0  // [004b] IplEntityIndexArrays 40-slot relocation — not yet implemented
#endif

#ifndef PM_INT16_LOG
#define PM_INT16_LOG 0  // 1 = trace the int16 sidecar at runtime (IncludeEntity/RemoveIpl) into the log
#endif

#ifndef PM_FX2DFX_LOG
#define PM_FX2DFX_LOG 0  // 1 = count the fx2dfx null-blueprint guard hits (dead-system Stop/Play caught) into the log
#endif
