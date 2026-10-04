#pragma once
// The patch-table runner + the ASI attach sequence — the framework's centrepiece. In a verify-only build it is
// a DRY RUN: fingerprint-gate → detect adjusters → byte-verify every generated site → log the plan, ZERO writes.
// In an APPLY build it calls the PLUGIN's apply function; the framework never includes a payload header (the
// seam is `Plugin`, see plugin.hpp).
#include <cstdint>

#include "coexistence.hpp"
#include "config.hpp"
#include "fingerprint.hpp"
#include "log.hpp"
#include "mem.hpp"
#include "plugin.hpp"

namespace asi {

// Byte-verify each patch site in MEMORY against its baseline. A pristine site is the plugin's to apply; a site
// whose bytes DIFFER is already owned by an adjuster (FLA/OLA) → it would be DEFERRED, not double-patched (this
// is the coexistence case, not an error). Returns the number of pristine sites.
inline uint32_t VerifyAllSites(Log& log, const Plugin& plugin) {
  uint32_t pristine = 0;
  for (uint32_t i = 0; i < plugin.tables.siteCount; ++i) {
    const ByteAnchor& site = plugin.tables.sites[i];
    const bool ok = VerifyBytes(Runtime(site.address), site.bytes, site.length);
    log.Tagged(plugin.tag, ok ? "site pristine (would apply):" : "site differs — adjuster owns it (would DEFER):");
    log.Line(site.name);
    log.KeyHex("  address ", site.address);
    if (ok) {
      ++pristine;
    } else {
      log.KeyBytes("  live    ", reinterpret_cast<const uint8_t*>(Runtime(site.address)), site.length);
    }
  }
  return pristine;
}

// The whole DLL_PROCESS_ATTACH story, for whichever plugin hands itself in.
inline void OnAttach(const Plugin& plugin) {
  Log log;
  log.Open(plugin.logFile);
#if ASI_APPLY
  log.Tagged(plugin.tag, "loaded — built " __DATE__ " " __TIME__ " (APPLY)");
#else
  log.Tagged(plugin.tag, "loaded — built " __DATE__ " " __TIME__ " (verify-only)");
#endif

  if (!IsSupportedExe(log, plugin.tag, plugin.tables)) {
    log.Close();
    return;
  }
  const unsigned adjusters = DetectAdjusters(log, plugin.tag);

#if ASI_APPLY
#if ASI_DEBUG
  log.Tagged(plugin.tag, "DEBUG: pre-apply site verification —");
  const uint32_t dbgPristine = VerifyAllSites(log, plugin);
  log.TaggedKeyHex(plugin.tag, "DEBUG: sites pristine ", dbgPristine);
  log.TaggedKeyHex(plugin.tag, "DEBUG: sites total    ", plugin.tables.siteCount);
#endif
  if (plugin.apply != nullptr) {
    plugin.apply(log, plugin, adjusters);
  }
#else
  (void)adjusters;
  const uint32_t pristine = VerifyAllSites(log, plugin);
  log.TaggedKeyHex(plugin.tag, "sites pristine ", pristine);
  log.TaggedKeyHex(plugin.tag, "sites total    ", plugin.tables.siteCount);
  log.Tagged(plugin.tag, pristine == plugin.tables.siteCount
                             ? "all sites pristine — catalogue byte-accurate, safe to apply"
                             : "some sites pre-patched — those defer to the adjuster (expected with FLA/OLA)");
#endif
  log.Close();
}

}  // namespace asi
