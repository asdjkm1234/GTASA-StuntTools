#pragma once
// Verify-or-defer: the check every patch runs before it writes a byte. A patch names WHICH generated sites it
// touches; it never re-declares their bytes (that is the no-hand-edited-address rule — the bytes live in the
// catalogue and reach here through the generated table).
//
// Both of perfect-map's payloads had their own copy of this loop, each with a private byte array duplicating
// what the generated table already said. One of the two could have drifted from the catalogue without anything
// noticing — which is exactly the failure the rule exists to prevent.
#include <cstdint>

#include "fingerprint.hpp"  // Runtime()
#include "generated-tables.hpp"
#include "log.hpp"
#include "mem.hpp"

namespace asi {

// Find a generated site by its catalogue name; nullptr when the plugin asks for a name the catalogue does not
// carry (a typo, or a site removed from the catalogue but not from the patch).
inline const ByteAnchor* FindSite(const GeneratedTables& tables, const char* name) {
  for (uint32_t i = 0; i < tables.siteCount; ++i) {
    const ByteAnchor& site = tables.sites[i];
    const char* a = site.name;
    const char* b = name;
    while (*a && *a == *b) {
      ++a;
      ++b;
    }
    if (*a == '\0' && *b == '\0') {
      return &site;
    }
  }
  return nullptr;
}

/**
 * Byte-verify the named sites in memory. Returns true only when EVERY one still carries its catalogue bytes —
 * the caller then owns them and may write; otherwise the caller DEFERS (an adjuster owns the zone; that is
 * coexistence, not an error).
 *
 * Every site is checked even after the first miss, and each miss dumps what was found INSTEAD — for a blind
 * patcher that dump is the whole diagnosis: it says which adjuster owns what, which is how a coexistence
 * decision gets planned rather than guessed.
 */
inline bool VerifySitesOrDefer(Log& log, const char* tag, const GeneratedTables& tables, const char* const* names,
                               uint32_t count) {
  bool allPristine = true;
  for (uint32_t i = 0; i < count; ++i) {
    const ByteAnchor* site = FindSite(tables, names[i]);
    if (site == nullptr) {
      log.Tagged(tag, "verify: site not in the generated catalogue — DEFER:");
      log.Line(names[i]);
      allPristine = false;
      continue;
    }
    const uintptr_t address = Runtime(site->address);
    if (!VerifyBytes(address, site->bytes, site->length)) {
      allPristine = false;
      log.Tagged(tag, "verify: site DIFFERS (an adjuster owns it):");
      log.Line(site->name);
      log.TaggedKeyHex(tag, "  address ", site->address);
      if (Readable(address, 8)) {  // what the adjuster actually wrote — read to plan coexistence
        log.TaggedKeyHex(tag, "  found[0..3] ", *reinterpret_cast<const uint32_t*>(address));
        log.TaggedKeyHex(tag, "  found[4..7] ", *reinterpret_cast<const uint32_t*>(address + 4));
      }
    }
  }
  return allPristine;
}

}  // namespace asi
