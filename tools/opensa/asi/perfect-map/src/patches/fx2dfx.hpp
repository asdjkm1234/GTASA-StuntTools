#pragma once
// Fix #6 (2dfx emitter leak/crash on LODs): null-guard the fx-system use-after-free. See plan 008 for the full RE.
//
// Root: the fx manager reaps a finished FxSystem_c (FxManager_c::Update 0x4A9A80 → DestroyFxSystem 0x4A9810 →
// ~FxSystem_c zeroes m_SystemBP @+8) WITHOUT unlinking the entity's FxEntitySystem node in Fx_c::m_FxEntities.
// On stream-out CEntity::DestroyEffects → Fx_c::DestroyEntityFx (0x4A1280) then does node->m_System->Kill()
// (0x4AA3F0 → Stop 0x4AA390) on that dangling system → `mov cl,[m_SystemBP(null)+0x1B]` → AV 0x004AA3A1.
//
// DestroyEntityFx already RemoveItems + `operator delete`s the node regardless of the Kill — so the ONLY defect is
// the redundant Kill()/Stop() dereferencing an already-freed system. A dead system has m_SystemBP == null (the dtor
// zeroed it); Stop/Play on it has nothing to do. So the minimal, correct fix is to null-guard the two functions that
// deref m_SystemBP unconditionally: FxSystem_c::Stop (0x4AA390, the crash) and Play (0x4AA2F0, the symmetric path).
// Guarding Stop neutralises Kill (Kill just calls Stop then writes a state byte on the — not-yet-reused — block).
// This is a genuine lifecycle fix, not a pool bump: particles still unload via the normal node-delete path; we only
// stop the dead-system deref. It lets particle 2dfx ride LODs without the crash (plan 010).
//
// Both are thiscall, 0 args (ret 0). Assumes the fixed 0x400000 image base (SA 1.0, no ASLR).
#include <windows.h>
#include <cstdint>

#include "../config.hpp"
#include "../identity.hpp"
#include <asi/fingerprint.hpp>  // asi::Runtime(), asi::HostBase()
#include <asi/hook.hpp>
#include <asi/append-log.hpp>
#include <asi/log.hpp>
#include <asi/plugin.hpp>
#include <asi/verify.hpp>

namespace pm::patches {

#if PM_FX2DFX_LOG
inline int gFxGuardHits = 0;

// Count the catches (the guard runs after OnAttach closed its Log → the SDK's reopen-append logger). Only ever
// called on the RARE null-blueprint path (a genuinely reaped system) — never on the hot live-system path.
inline void PmFxDeadSystemLog(void* /*sys*/) {
  ++gFxGuardHits;
  if (gFxGuardHits > 32) {
    return;  // enough proof; stop spamming the log
  }
  asi::AppendCount(kLogFile, "[dbg] fx2dfx dead-system Stop/Play caught #", gFxGuardHits);
}
#endif

namespace detail {

// Build a null-blueprint guard trampoline for a thiscall(this=ecx), 0-arg function whose first `savedLen` bytes
// (whole instructions, >=5) we relocate. Stub: if `this->m_SystemBP (+8)` is null → `ret`; else run the saved
// prologue and jmp to `cont`. Then overwrite the entry with a 5-byte jmp to the stub.
inline bool InstallNullBpGuard(uintptr_t entry, uintptr_t cont, const uint8_t* saved, uint32_t savedLen) {
  uint8_t* t = asi::AllocExec(48 + savedLen);
  if (!t) {
    return false;
  }
  const uintptr_t base = reinterpret_cast<uintptr_t>(t);
  uint32_t p = 0;
  t[p++] = 0x8B;
  t[p++] = 0x41;
  t[p++] = 0x08;  // mov eax, [ecx+8]   (m_SystemBP)
  t[p++] = 0x85;
  t[p++] = 0xC0;  // test eax, eax
#if PM_FX2DFX_LOG
  // Null path: log the catch (rare) then ret. `jnz relocated` skips the whole logging+ret block.
  const uint32_t jnzAt = p;
  t[p++] = 0x0F;
  t[p++] = 0x85;  // jnz rel32 → relocated (patched after we know the offset)
  t[p++] = 0x00;
  t[p++] = 0x00;
  t[p++] = 0x00;
  t[p++] = 0x00;
  t[p++] = 0x60;  // pushad
  t[p++] = 0x51;  // push ecx  (the FxSystem_c* this)
  asi::EmitCall(t, p, base, reinterpret_cast<uintptr_t>(&PmFxDeadSystemLog));
  t[p++] = 0x83;
  t[p++] = 0xC4;
  t[p++] = 0x04;  // add esp, 4
  t[p++] = 0x61;  // popad
  t[p++] = 0xC3;  // ret
  const uint32_t relocated = p;
  const int32_t rel = static_cast<int32_t>(relocated) - static_cast<int32_t>(jnzAt + 6);
  t[jnzAt + 2] = static_cast<uint8_t>(rel);
  t[jnzAt + 3] = static_cast<uint8_t>(rel >> 8);
  t[jnzAt + 4] = static_cast<uint8_t>(rel >> 16);
  t[jnzAt + 5] = static_cast<uint8_t>(rel >> 24);
#else
  t[p++] = 0x75;
  t[p++] = 0x01;  // jnz +1  (skip the ret → run the original)
  t[p++] = 0xC3;  // ret     (dead system → no-op; thiscall, 0 args)
#endif
  for (uint32_t i = 0; i < savedLen; ++i) {
    t[p++] = saved[i];  // relocated prologue (position-independent movs/pushes — no rel operands)
  }
  asi::EmitJmp(t, p, base, cont);
  return asi::WriteJmp(entry, base);
}

}  // namespace detail

// The prologues we relocate (whole instructions covering the 5-byte jmp) are named, never re-declared: their
// bytes come from the catalogue through the generated table.
inline constexpr const char* kFx2dfxSites[] = {"FxSystem_c.Stop", "FxSystem_c.Play"};

inline void ApplyFx2dfx(asi::Log& log, const asi::Plugin& plugin) {
  if (asi::HostBase() != 0x400000) {
    log.Tagged(plugin.tag, "fx2dfx: unexpected image base — DEFER");
    return;
  }
  if (!asi::VerifySitesOrDefer(log, plugin.tag, plugin.tables, kFx2dfxSites,
                               sizeof(kFx2dfxSites) / sizeof(kFx2dfxSites[0]))) {
    log.Tagged(plugin.tag, "fx2dfx: DEFER (patching nothing) — a hook already owns the fx zone");
    return;
  }
  const asi::ByteAnchor* stop = asi::FindSite(plugin.tables, kFx2dfxSites[0]);
  const asi::ByteAnchor* play = asi::FindSite(plugin.tables, kFx2dfxSites[1]);
  if (stop == nullptr || play == nullptr) {  // unreachable while the verify above passed — see the note there
    log.Tagged(plugin.tag, "fx2dfx: site name not in the catalogue — DEFER");
    return;
  }
  // Address AND continuation both derive from the site: the stub relocates `length` bytes and must resume at
  // exactly entry+length. A literal continuation would silently desync if the catalogue's byte window changed.
  const uintptr_t stopEntry = asi::Runtime(stop->address);
  const uintptr_t playEntry = asi::Runtime(play->address);
  const bool a = detail::InstallNullBpGuard(stopEntry, stopEntry + stop->length, stop->bytes, stop->length);
  const bool b = detail::InstallNullBpGuard(playEntry, playEntry + play->length, play->bytes, play->length);
  log.Tagged(plugin.tag, a && b
                             ? "fx2dfx APPLIED: FxSystem_c::Stop/Play null-blueprint guarded (2dfx UAF fixed)"
                             : "fx2dfx: patch write FAILED (see VirtualProtect)");
}

}  // namespace pm::patches
