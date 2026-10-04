#pragma once
// A reopen-append logger for RUNTIME use — the framework's `Log` is opened and closed inside the attach
// sequence, so a hook that fires later (an observer, a guard, any installed detour) has no handle to write
// through. Both of perfect-map's payloads had hand-rolled this same CreateFileA/itoa/WriteFile code before it
// lived here; anything a plugin needs to trace from inside a hook goes through this instead.
//
// Append-opens per line: slow by construction, and that is the point — a diagnostic build's trace survives a
// crash. Never put one of these on a hot path.
#include <windows.h>
#include <cstdint>

#include "log.hpp"

namespace asi {

// Signed decimal into `out`, returning the new write cursor. No CRT, no allocation.
inline char* AppendInt(int32_t value, char* out) {
  uint32_t magnitude = value < 0 ? (*out++ = '-', 0u - static_cast<uint32_t>(value)) : static_cast<uint32_t>(value);
  char digits[12];
  int n = 0;
  do {
    digits[n++] = static_cast<char>('0' + magnitude % 10);
    magnitude /= 10;
  } while (magnitude);
  while (n) {
    *out++ = digits[--n];
  }
  return out;
}

// Append one raw line (CRLF added) to the plugin's log file next to the host exe.
inline void AppendLine(const char* logFile, const char* text, uint32_t length) {
  char path[MAX_PATH];
  HostDir(path, sizeof(path));
  lstrcatA(path, logFile);
  HANDLE file = CreateFileA(path, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_ALWAYS,
                            FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) {
    return;
  }
  DWORD written = 0;
  WriteFile(file, text, length, &written, nullptr);
  WriteFile(file, "\r\n", 2, &written, nullptr);
  CloseHandle(file);
}

// Append "<label> <a> <b> <c>" — the shape a hook traces its state in.
inline void AppendLabelled(const char* logFile, const char* label, int32_t a, int32_t b, int32_t c) {
  char buffer[160];
  char* cursor = buffer;
  for (const char* s = label; *s; ++s) {
    *cursor++ = *s;
  }
  *cursor++ = ' ';
  cursor = AppendInt(a, cursor);
  *cursor++ = ' ';
  cursor = AppendInt(b, cursor);
  *cursor++ = ' ';
  cursor = AppendInt(c, cursor);
  AppendLine(logFile, buffer, static_cast<uint32_t>(cursor - buffer));
}

// Append "<label><n>" — the counter shape (a guard reporting how many times it fired). Unlike
// AppendLabelled, the LABEL owns the separator, so a label may end in "#", ": " or nothing at all.
inline void AppendCount(const char* logFile, const char* label, int32_t n) {
  char buffer[128];
  char* cursor = buffer;
  for (const char* s = label; *s; ++s) {
    *cursor++ = *s;
  }
  cursor = AppendInt(n, cursor);
  AppendLine(logFile, buffer, static_cast<uint32_t>(cursor - buffer));
}

}  // namespace asi
