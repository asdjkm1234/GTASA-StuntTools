#pragma once
// The plugin surface: what a consumer supplies to the framework. The SDK owns the attach lifecycle, the exe
// gate, the byte-verify and the deferral plumbing; the plugin owns its identity, its generated tables and what
// its patches actually do. The framework may never include a payload header — this struct is the seam.
//
// A plugin defines ONE `constexpr Plugin` (see perfect-map's `src/plugin.hpp`) and hands it to
// `asi::OnAttach(...)` from its DllMain. Everything here is compile-time constant: no allocation, no
// registration, no CRT.
#include <cstdint>

#include "generated-tables.hpp"

namespace asi {

class Log;
struct Plugin;

// Applies the plugin's enabled fixes. Called only in an APPLY build, after the exe gate passed and the
// adjuster mask is known; a fix that an adjuster already owns is the plugin's to defer. The plugin is handed
// back so a patch can verify its named sites against its own generated tables (see verify.hpp).
using ApplyFn = void (*)(Log& log, const Plugin& plugin, unsigned adjusterMask);

struct Plugin {
  // Log filename, written next to the host exe (e.g. "perfect-map-asi.log").
  const char* logFile;
  // Line prefix on every framework log line (e.g. "[perfect-map] ").
  const char* tag;
  // The plugin's generated fingerprint + patch-site tables (its `gen/` output, adapted by its plugin.hpp).
  GeneratedTables tables;
  // What to run in an APPLY build; nullptr in a plugin that only verifies.
  ApplyFn apply;
};

}  // namespace asi
