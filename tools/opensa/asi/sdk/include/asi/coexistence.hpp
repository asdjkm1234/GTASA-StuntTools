#pragma once
// Adjuster coexistence: enumerate loaded modules and flag FLA / OLA. A patch that conflicts with an adjuster
// that already owns its zone is DEFERRED (skipped), never double-applied — the documented FLA×OLA LinkLods
// double-patch crash is impossible by construction.
#include <windows.h>
#include <tlhelp32.h>

#include "log.hpp"

namespace asi {

enum Adjuster : unsigned { kAdjusterFla = 1u, kAdjusterOla = 2u };

// Case-insensitive "does `haystack` contain `needle`" (ASCII, no CRT).
inline bool ContainsCI(const char* haystack, const char* needle) {
  for (const char* h = haystack; *h; ++h) {
    const char* a = h;
    const char* b = needle;
    while (*a && *b) {
      char ca = *a >= 'A' && *a <= 'Z' ? static_cast<char>(*a + 32) : *a;
      char cb = *b >= 'A' && *b <= 'Z' ? static_cast<char>(*b + 32) : *b;
      if (ca != cb) {
        break;
      }
      ++a;
      ++b;
    }
    if (*b == '\0') {
      return true;
    }
  }
  return false;
}

// Returns a bitmask of detected limit adjusters (see {@link Adjuster}) and logs each under the plugin's tag.
inline unsigned DetectAdjusters(Log& log, const char* tag) {
  unsigned mask = 0;
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE, 0);
  if (snapshot == INVALID_HANDLE_VALUE) {
    return 0;
  }
  MODULEENTRY32 entry;
  entry.dwSize = sizeof(entry);
  if (Module32First(snapshot, &entry)) {
    do {
      if (ContainsCI(entry.szModule, "fastman92")) {
        mask |= kAdjusterFla;
        log.Tagged(tag, "adjuster present: fastman92 (FLA)");
      } else if (ContainsCI(entry.szModule, "limitadjuster")) {
        mask |= kAdjusterOla;
        log.Tagged(tag, "adjuster present: LimitAdjuster (OLA)");
      }
    } while (Module32Next(snapshot, &entry));
  }
  CloseHandle(snapshot);
  if (mask == 0) {
    log.Tagged(tag, "no limit adjuster detected");
  }
  return mask;
}

}  // namespace asi
