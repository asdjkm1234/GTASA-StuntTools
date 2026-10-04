#pragma once
// perfect-vehicle's identity in one place: the log filename and the log-line tag. `plugin.hpp` hands these to
// the framework; the payloads' diagnostic traces reopen the same file through the SDK's append logger.

namespace pv {

inline constexpr const char* kLogFile = "perfect-vehicle-asi.log";
inline constexpr const char* kTag = "[perfect-vehicle] ";

}  // namespace pv
