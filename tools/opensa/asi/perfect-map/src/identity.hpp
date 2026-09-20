#pragma once
// perfect-map's identity in one place: the log filename and the log-line tag. `plugin.hpp` hands these to the
// framework; the payloads' diagnostic traces reopen the same file through the SDK's append logger.

namespace pm {

inline constexpr const char* kLogFile = "perfect-map-asi.log";
inline constexpr const char* kTag = "[perfect-map] ";

}  // namespace pm
