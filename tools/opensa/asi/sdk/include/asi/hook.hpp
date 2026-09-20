#pragma once
// Minimal self-authored hook primitives (the plan-002 fallback to injector.hpp: fully transparent, no CRT, no
// vendored dep). Enough for our case — every function we hook has a clean ≥5-byte first instruction, so a
// 5-byte E9 rel32 overwrite needs no trampoline-relocation of a split instruction.
#include <windows.h>
#include <cstdint>

#include "mem.hpp"

namespace asi {

// Write a 5-byte `E9 rel32` jump at `at` → `target`. Byte-verify the caller's expected original bytes FIRST
// (framework rule); this only performs the write. Returns false if the page can't be made writable.
inline bool WriteJmp(uintptr_t at, uintptr_t target) {
  ScopedUnprotect guard(at, 5);
  if (!guard.ok()) {
    return false;
  }
  uint8_t* p = reinterpret_cast<uint8_t*>(at);
  const int32_t rel = static_cast<int32_t>(target - (at + 5));
  p[0] = 0xE9;
  p[1] = static_cast<uint8_t>(rel);
  p[2] = static_cast<uint8_t>(rel >> 8);
  p[3] = static_cast<uint8_t>(rel >> 16);
  p[4] = static_cast<uint8_t>(rel >> 24);
  return true;
}

// Repoint an existing 5-byte `E8 rel32` CALL at `at` to `target`, keeping the instruction a call. The patch
// shape for "replace what this one call site invokes" — no trampoline, no relocated prologue, and the original
// function stays untouched for every other caller. Byte-verify the site FIRST (framework rule); this only
// performs the write. Returns false if the page can't be made writable.
inline bool WriteCall(uintptr_t at, uintptr_t target) {
  ScopedUnprotect guard(at, 5);
  if (!guard.ok()) {
    return false;
  }
  uint8_t* p = reinterpret_cast<uint8_t*>(at);
  const int32_t rel = static_cast<int32_t>(target - (at + 5));
  p[0] = 0xE8;
  p[1] = static_cast<uint8_t>(rel);
  p[2] = static_cast<uint8_t>(rel >> 8);
  p[3] = static_cast<uint8_t>(rel >> 16);
  p[4] = static_cast<uint8_t>(rel >> 24);
  return true;
}

// A tiny executable code buffer we assemble trampolines into (RWX, never freed — lives for the process).
inline uint8_t* AllocExec(uint32_t size) {
  return static_cast<uint8_t*>(VirtualAlloc(nullptr, size, MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE));
}

// Emit a `call rel32` / `jmp rel32` into `buf` at `pos` targeting `target`; advances `pos`.
inline void EmitCall(uint8_t* buf, uint32_t& pos, uintptr_t bufBase, uintptr_t target) {
  buf[pos] = 0xE8;  // call rel32
  const int32_t rel = static_cast<int32_t>(target - (bufBase + pos + 5));
  buf[pos + 1] = static_cast<uint8_t>(rel);
  buf[pos + 2] = static_cast<uint8_t>(rel >> 8);
  buf[pos + 3] = static_cast<uint8_t>(rel >> 16);
  buf[pos + 4] = static_cast<uint8_t>(rel >> 24);
  pos += 5;
}

inline void EmitJmp(uint8_t* buf, uint32_t& pos, uintptr_t bufBase, uintptr_t target) {
  buf[pos] = 0xE9;
  const int32_t rel = static_cast<int32_t>(target - (bufBase + pos + 5));
  buf[pos + 1] = static_cast<uint8_t>(rel);
  buf[pos + 2] = static_cast<uint8_t>(rel >> 8);
  buf[pos + 3] = static_cast<uint8_t>(rel >> 16);
  buf[pos + 4] = static_cast<uint8_t>(rel >> 24);
  pos += 5;
}

/**
 * Hook a cdecl function `entry(arg0, arg1)` whose real body continues at `body` — the shape of a protector-
 * relocated function, whose callable entry is itself a `jmp` into an overlay section. Redirects `entry`
 * through a trampoline that calls
 * `observer(arg0, arg1)` (registers preserved, args forwarded) and then jumps to `body` so the original runs
 * unchanged. Observation-only — cannot corrupt the original's behaviour. Returns false on failure.
 */
inline bool HookObserve2(uintptr_t entry, uintptr_t body, void* observer) {
  uint8_t* t = AllocExec(32);
  if (!t) {
    return false;
  }
  const uintptr_t base = reinterpret_cast<uintptr_t>(t);
  uint32_t pos = 0;
  t[pos++] = 0x60;                              // pushad                (esp -= 0x20)
  t[pos++] = 0xFF; t[pos++] = 0x74; t[pos++] = 0x24; t[pos++] = 0x28;  // push [esp+0x28]  (arg1)
  t[pos++] = 0xFF; t[pos++] = 0x74; t[pos++] = 0x24; t[pos++] = 0x28;  // push [esp+0x28]  (arg0, shifted)
  EmitCall(t, pos, base, reinterpret_cast<uintptr_t>(observer));       // call observer(arg0, arg1)
  t[pos++] = 0x83; t[pos++] = 0xC4; t[pos++] = 0x08;                   // add esp, 8
  t[pos++] = 0x61;                                                     // popad
  EmitJmp(t, pos, base, body);                                         // jmp body
  return WriteJmp(entry, base);
}

// OBSERVE a cdecl function `entry(arg0)` whose first instruction (`savedBytes`, `savedLen` bytes) we relocate:
// call `observer(arg0)` (registers preserved), run the saved instruction, then continue at `cont`. For a clean
// ≥5-byte first instruction (e.g. a `mov eax,[abs32]` entry). Diagnostic/observe use — original runs unchanged.
inline bool HookObserve1Cont(uintptr_t entry, uintptr_t cont, const uint8_t* savedBytes, uint32_t savedLen,
                             void* observer) {
  uint8_t* t = AllocExec(48);
  if (!t) {
    return false;
  }
  const uintptr_t base = reinterpret_cast<uintptr_t>(t);
  uint32_t pos = 0;
  t[pos++] = 0x60;                                                    // pushad           (esp -= 0x20)
  t[pos++] = 0xFF; t[pos++] = 0x74; t[pos++] = 0x24; t[pos++] = 0x24;  // push [esp+0x24]  (arg0)
  EmitCall(t, pos, base, reinterpret_cast<uintptr_t>(observer));      // call observer(arg0)
  t[pos++] = 0x83; t[pos++] = 0xC4; t[pos++] = 0x04;                  // add esp, 4
  t[pos++] = 0x61;                                                    // popad
  for (uint32_t i = 0; i < savedLen; ++i) {
    t[pos++] = savedBytes[i];                                         // relocated first instruction
  }
  EmitJmp(t, pos, base, cont);
  return WriteJmp(entry, base);
}

// Replace a cdecl function `entry(arg0)` outright with `replacement(arg0)` (the original never runs) — for a
// patch that reimplements a routine rather than observing it. Trampoline forwards arg0 and returns to the caller.
inline bool HookReplace1(uintptr_t entry, void* replacement) {
  uint8_t* t = AllocExec(16);
  if (!t) {
    return false;
  }
  const uintptr_t base = reinterpret_cast<uintptr_t>(t);
  uint32_t pos = 0;
  t[pos++] = 0xFF; t[pos++] = 0x74; t[pos++] = 0x24; t[pos++] = 0x04;  // push [esp+4]  (arg0)
  EmitCall(t, pos, base, reinterpret_cast<uintptr_t>(replacement));    // call replacement(arg0)
  t[pos++] = 0x83; t[pos++] = 0xC4; t[pos++] = 0x04;                   // add esp, 4
  t[pos++] = 0xC3;                                                     // ret  (cdecl: caller cleans arg0)
  return WriteJmp(entry, base);
}

}  // namespace asi
