#pragma once
// perfect-vehicle's plugin declaration — what this plugin hands to the SDK framework: its identity, its
// generated tables and its apply entry point. This file is the ONLY place where the plugin's generated
// namespace meets the framework.
#include <asi/generated-tables.hpp>
#include <asi/plugin.hpp>

#include "config.hpp"
#include "generated/patches.hpp"
#include "identity.hpp"

#if PV_APPLY
#include "apply.hpp"
#endif

namespace pv {

inline constexpr asi::GeneratedTables kTables = {
    gen::kExeSize, gen::kFingerprint, gen::kFingerprintCount, gen::kPatchSites, gen::kPatchSiteCount,
};

inline constexpr asi::Plugin kPlugin = {
    kLogFile,
    kTag,
    kTables,
#if PV_APPLY
    &ApplyPatches,
#else
    nullptr,
#endif
};

}  // namespace pv
