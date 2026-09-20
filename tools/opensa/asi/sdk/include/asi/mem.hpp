#pragma once
// Memory primitives: readable-range check, byte verification against a baseline, and a scoped
// make-writable-then-restore guard. Every patch in 004 verifies before it writes; this is where that lives.
#include <windows.h>
#include <cstdint>

namespace asi {

// True when [addr, addr+len) is committed and readable (guards the byte-verify against a fault on a stray addr).
inline bool Readable(uintptr_t addr, uint32_t len) {
  MEMORY_BASIC_INFORMATION mbi;
  if (VirtualQuery(reinterpret_cast<void*>(addr), &mbi, sizeof(mbi)) == 0 || mbi.State != MEM_COMMIT) {
    return false;
  }
  const DWORD readable = PAGE_READONLY | PAGE_READWRITE | PAGE_WRITECOPY | PAGE_EXECUTE_READ |
                         PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY;
  if ((mbi.Protect & readable) == 0) {
    return false;
  }
  const uintptr_t regionEnd = reinterpret_cast<uintptr_t>(mbi.BaseAddress) + mbi.RegionSize;
  return addr + len <= regionEnd;
}

// True when the `len` bytes at `addr` equal `expected` — the mandatory pre-patch check (never write on a miss).
inline bool VerifyBytes(uintptr_t addr, const uint8_t* expected, uint32_t len) {
  if (!Readable(addr, len)) {
    return false;
  }
  const uint8_t* actual = reinterpret_cast<const uint8_t*>(addr);
  for (uint32_t i = 0; i < len; ++i) {
    if (actual[i] != expected[i]) {
      return false;
    }
  }
  return true;
}

// RAII: make [addr, len) writable+executable for the scope, restore the original protection on destruction.
class ScopedUnprotect {
 public:
  ScopedUnprotect(uintptr_t addr, uint32_t len) : addr_(addr), len_(len) {
    ok_ = VirtualProtect(reinterpret_cast<void*>(addr), len, PAGE_EXECUTE_READWRITE, &old_) != 0;
  }

  ~ScopedUnprotect() {
    if (ok_) {
      DWORD ignored = 0;
      VirtualProtect(reinterpret_cast<void*>(addr_), len_, old_, &ignored);
    }
  }

  ScopedUnprotect(const ScopedUnprotect&) = delete;
  ScopedUnprotect& operator=(const ScopedUnprotect&) = delete;

  bool ok() const { return ok_; }

 private:
  uintptr_t addr_;
  uint32_t len_;
  DWORD old_ = 0;
  bool ok_ = false;
};

}  // namespace asi
