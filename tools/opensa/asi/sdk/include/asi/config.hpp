#pragma once
// Framework build-time switches. A plugin owns its OWN config header for its payload flags (perfect-map's
// PM_FIX_* / PM_*_LOG); these two are the SDK's. Default = verify-only (dry-run); `make APPLY=1` patches.

#ifndef ASI_APPLY
#define ASI_APPLY 0  // 0 = verify-only (dry-run, zero writes); 1 = apply the plugin's enabled fixes
#endif

#ifndef ASI_DEBUG
#define ASI_DEBUG 0  // 1 (`make DEBUG=1`) = verbose: dump every patch site's verify status before applying
#endif
