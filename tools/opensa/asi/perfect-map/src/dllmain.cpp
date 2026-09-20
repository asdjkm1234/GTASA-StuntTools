// perfect-map.asi — entry point. On DLL_PROCESS_ATTACH it hands this plugin to the SDK framework
// (`asi::OnAttach`), which opens the log, fingerprint-gates the exe, detects adjusters, and either byte-verifies
// every patch site (dry run) or calls our apply. KERNEL32-only, static, -nostdlib (see the Makefile).
#include <windows.h>

#include <asi/patch_table.hpp>

#include "plugin.hpp"

// The DLL entry point directly (via `-nostdlib -e _DllMain@12`) so no CRT startup is linked — the .asi imports
// KERNEL32 only and loads on any Windows SA runs on. `extern "C"` keeps the stdcall name un-mangled for `-e`.
extern "C" BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID /*reserved*/) {
  if (reason == DLL_PROCESS_ATTACH) {
    DisableThreadLibraryCalls(instance);
    asi::OnAttach(pm::kPlugin);
  }
  return TRUE;
}
