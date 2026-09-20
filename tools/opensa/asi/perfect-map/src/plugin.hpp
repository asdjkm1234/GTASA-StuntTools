#pragma once
// perfect-map's plugin declaration — what this plugin hands to the SDK framework: its identity, its generated
// tables (adapted from `pm::gen`, the generator's output) and its apply entry point. This file is the ONLY
// place where the plugin's generated namespace meets the framework.
#include <asi/generated-tables.hpp>
#include <asi/plugin.hpp>

#include "config.hpp"
#include "generated/patches.hpp"
#include "identity.hpp"

#if PM_APPLY
#include "apply.hpp"
#endif

namespace pm {

// The generated tables are already emitted as the framework's own anchor types, so this is a plain hand-over.
inline constexpr asi::GeneratedTables kTables = {
    gen::kExeSize, gen::kFingerprint, gen::kFingerprintCount, gen::kPatchSites, gen::kPatchSiteCount,
};

inline constexpr asi::Plugin kPlugin = {
    kLogFile,
    kTag,
    kTables,
#if PM_APPLY
    &ApplyPatches,
#else
    nullptr,
#endif
};

}  // namespace pm
