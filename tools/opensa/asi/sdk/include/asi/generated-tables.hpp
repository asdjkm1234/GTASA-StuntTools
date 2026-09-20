#pragma once
// The shape of a plugin's GENERATED data, as the framework consumes it. The generator emits the constants into
// the plugin's own namespace (`<ns>::gen`, see gen/render.ts); this struct is how the plugin hands them over —
// so no framework file ever names a plugin namespace, and no address is hand-written anywhere.
#include <cstdint>

namespace asi {

// A byte sequence expected at a runtime address (memory byte-verify).
struct ByteAnchor {
  const char* name;
  uint32_t address;
  const uint8_t* bytes;
  uint32_t length;
};

// A byte sequence expected at an exe-FILE offset (disk fingerprint, adjuster-immune).
struct FileAnchor {
  const char* name;
  uint32_t offset;
  const uint8_t* bytes;
  uint32_t length;
};

struct GeneratedTables {
  // Exact file size of the only accepted exe.
  uint32_t exeSize;
  const FileAnchor* fingerprint;
  uint32_t fingerprintCount;
  const ByteAnchor* sites;
  uint32_t siteCount;
};

}  // namespace asi
