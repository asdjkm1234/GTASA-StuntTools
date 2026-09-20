#pragma once
// Fix #1 (buildings): lift the int16 IplDef building-pool-range ceiling. Two parts:
//   (a) OBSERVE IncludeEntity (0x404C90 → body 0x1563730): mirror the building min/max into an int32 sidecar
//       keyed by IPL slot. Read-only w.r.t. the engine — cannot corrupt it.
//   (b) REDIRECT RemoveIpl's two int16 bound READS (movsx edi/edx from IplDef+0x22/+0x24) to the int32 sidecar,
//       so the original delete loop iterates the FULL range instead of the truncated int16 one. Everything else
//       in RemoveIpl (object pass, dummy pass, delete path, car generators) runs unchanged — minimal blast radius.
// Dummies (firstDummy/lastDummy, IplDef+0x26/+0x28) are the same shape and get the same treatment under
// PM_FIX_INT16_DUMMY (plan 011): the same observer and snapshot hook, a second sidecar pair, TWO detours over
// RemoveIpl's dummy pass (the pre-loop reads are adjacent → one detour; the loop back-edge re-read → the other).
// Assumes the fixed 0x400000 image base (SA 1.0 has no ASLR); ApplyInt16 refuses otherwise.
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

#if PM_INT16_LOG
inline int gDbgInc = 0;
inline int gDbgRmv = 0;

// Dummy-side traces (011 step 1 was the gate that proved the wrap in the field). `gDbgIncDummy` is a separate
// cap so the building lines cannot starve the dummy ones; `gDbgDummyPeak` traces the pool's high-water mark
// per 8 192 ids, which is the leak curve across world entries.
inline int gDbgIncDummy = 0;
inline int gDbgRmvDummy = 0;
inline int32_t gDbgDummyPeak = 0;

// The runtime hooks fire long after OnAttach closed its Log, so they trace through the SDK's reopen-append
// logger. Diagnostic builds only (PM_INT16_LOG), never the hot path.
inline void DbgAppend(const char* label, int32_t a, int32_t b, int32_t c) {
  asi::AppendLabelled(kLogFile, label, a, b, c);
}
#endif

constexpr int kMaxIpl = 256;                 // m_IplIndex is uint8 → at most 256 slots
constexpr uintptr_t kBuildingPool = 0xB74498;  // *(CPool<CBuilding>**)
constexpr uintptr_t kDummyPool = 0xB744A0;     // *(CPool<CDummy>**) — sizeof(CDummy) == sizeof(CBuilding) == 0x38
constexpr uintptr_t kIplPool = 0x8E3FB0;       // *(CPool<IplDef>**)
constexpr uint32_t kSizeofBuilding = 0x38;
constexpr uint32_t kSizeofIplDef = 0x34;

// int32 sidecar for the building range (replaces the truncating int16 IplDef.firstBuilding/lastBuilding).
inline int32_t gFirstBuilding[kMaxIpl];
inline int32_t gLastBuilding[kMaxIpl];

// int32 sidecar for the dummy range (replaces the truncating int16 IplDef.firstDummy/lastDummy). Kept even when
// PM_FIX_INT16_DUMMY is off so the observer and the log read one shape; only the detours are gated.
inline int32_t gFirstDummy[kMaxIpl];
inline int32_t gLastDummy[kMaxIpl];

// The RemoveIpl snapshot (taken at its entry, before the bound-read detours run). RemoveIpl is non-reentrant, so
// a single pair suffices. The detours read THESE, not gFirst/gLastBuilding — because the entry hook resets the
// slot to empty for the next load right after snapshotting.
inline int32_t gSnapFirst = 0x7FFFFFFF;
inline int32_t gSnapLast = static_cast<int32_t>(0x80000000);
// RemoveIpl runs buildings → objects → dummies in ONE call, so the dummy pass needs its own snapshot pair.
inline int32_t gSnapFirstDummy = 0x7FFFFFFF;
inline int32_t gSnapLastDummy = static_cast<int32_t>(0x80000000);

inline uintptr_t IplDefPtr(int slot) {
  return *reinterpret_cast<uintptr_t*>(*reinterpret_cast<uintptr_t*>(kIplPool)) +
         static_cast<uintptr_t>(slot) * kSizeofIplDef;
}

// cdecl observer the IncludeEntity trampoline calls with (iplSlot, entity) before the body runs. Accumulates the
// building pool-index range in int32 (PURE min/max). The lifecycle reset is done by the RemoveIpl snapshot hook
// (unload clears the slot), NOT by peeking the engine's IplDef.firstBuilding — that field stays SHRT_MAX for
// slots whose buildings are ALL > 32767 (the engine's unsigned min keeps 0x7FFF), which broke the old fresh-detect.
inline void PmIncludeObserver(int slot, void* entity) {
  if (static_cast<unsigned>(slot) >= kMaxIpl || !entity) {
    return;
  }
  const uint8_t type = *reinterpret_cast<uint8_t*>(reinterpret_cast<uintptr_t>(entity) + 0x36) & 7;
  if (type == 5) {  // ENTITY_TYPE_DUMMY
    const uintptr_t db = *reinterpret_cast<uintptr_t*>(*reinterpret_cast<uintptr_t*>(kDummyPool));
    const int32_t did = static_cast<int32_t>((reinterpret_cast<uintptr_t>(entity) - db) / kSizeofBuilding);
    if (did < gFirstDummy[slot]) {
      gFirstDummy[slot] = did;
    }
    if (did > gLastDummy[slot]) {
      gLastDummy[slot] = did;
    }
#if PM_INT16_LOG
    if (did > 32767 && gDbgIncDummy < 24) {
      ++gDbgIncDummy;
      DbgAppend("[dbg] incDUMMY slot/id", slot, did, 0);
    }
    if (did / 8192 > gDbgDummyPeak / 8192) {
      DbgAppend("[dbg] dummyPEAK slot/id/prevPeak", slot, did, gDbgDummyPeak);
    }
    if (did > gDbgDummyPeak) {
      gDbgDummyPeak = did;
    }
#endif
    return;
  }
  if (type != 1) {
    return;  // ENTITY_TYPE_BUILDING == 1
  }
  const uintptr_t base = *reinterpret_cast<uintptr_t*>(*reinterpret_cast<uintptr_t*>(kBuildingPool));
  const int32_t id = static_cast<int32_t>((reinterpret_cast<uintptr_t>(entity) - base) / kSizeofBuilding);
  if (id < gFirstBuilding[slot]) {
    gFirstBuilding[slot] = id;
  }
  if (id > gLastBuilding[slot]) {
    gLastBuilding[slot] = id;
  }
#if PM_INT16_LOG
  // Log the first few buildings whose pool index exceeds int16 (the interesting over-2^15 case): slot, id, last.
  if (id > 32767 && gDbgInc < 16) {
    ++gDbgInc;
    DbgAppend("[dbg] inc slot/id/last", slot, id, gLastBuilding[slot]);
  }
#endif
}

// RemoveIpl entry hook (ALWAYS on with the fix): snapshot the slot's int32 building range for the bound-read
// detours (which run a few instructions later), then RESET the slot to empty so its next load accumulates fresh.
// This is the lifecycle reset that replaces the broken IplDef.firstBuilding==SHRT_MAX peek.
inline void PmRemoveIplSnapshot(int slot) {
  if (static_cast<unsigned>(slot) >= kMaxIpl) {
    gSnapFirst = 0x7FFFFFFF;
    gSnapLast = static_cast<int32_t>(0x80000000);
    gSnapFirstDummy = 0x7FFFFFFF;
    gSnapLastDummy = static_cast<int32_t>(0x80000000);
    return;
  }
  gSnapFirst = gFirstBuilding[slot];
  gSnapLast = gLastBuilding[slot];
  gSnapFirstDummy = gFirstDummy[slot];
  gSnapLastDummy = gLastDummy[slot];
#if PM_INT16_LOG
  if (gDbgRmv < 40) {
    const uintptr_t ipldef = IplDefPtr(slot);
    const int32_t bf = *reinterpret_cast<int16_t*>(ipldef + 0x22);
    const int32_t bl = *reinterpret_cast<int16_t*>(ipldef + 0x24);
    if ((gSnapFirst != 0x7FFFFFFF && (gSnapFirst > 32767 || gSnapLast > 32767)) || bf < 0 || bl < 0) {
      ++gDbgRmv;
      DbgAppend("[dbg] rmvFIX slot/i16bFirst/snapFirst", slot, bf, gSnapFirst);
      DbgAppend("[dbg] rmvFIX slot/i16bLast/snapLast", slot, bl, gSnapLast);
    }
  }
  // The engine's int16 dummy pair (+0x26/+0x28) against the range IncludeEntity actually placed. A negative /
  // clamped i16 beside an honest int32 is the stranding RemoveIpl's dummy pass would have walked past.
  if (gSnapFirstDummy != 0x7FFFFFFF && gDbgRmvDummy < 40) {
    const uintptr_t ipldef = IplDefPtr(slot);
    const int32_t df = *reinterpret_cast<int16_t*>(ipldef + 0x26);
    const int32_t dl = *reinterpret_cast<int16_t*>(ipldef + 0x28);
    if (gSnapFirstDummy > 32767 || gSnapLastDummy > 32767 || df < 0 || dl < 0) {
      ++gDbgRmvDummy;
      DbgAppend("[dbg] rmvDUMMY slot/i16dFirst/snapFirst", slot, df, gSnapFirstDummy);
      DbgAppend("[dbg] rmvDUMMY slot/i16dLast/snapLast", slot, dl, gSnapLastDummy);
    }
  }
#endif
  gFirstBuilding[slot] = 0x7FFFFFFF;
  gLastBuilding[slot] = static_cast<int32_t>(0x80000000);
  gFirstDummy[slot] = 0x7FFFFFFF;
  gLastDummy[slot] = static_cast<int32_t>(0x80000000);
}

namespace detail {

// Little-endian 32-bit store into a code buffer at `pos` (advances it).
inline void Put32(uint8_t* buf, uint32_t& pos, uint32_t value) {
  buf[pos++] = static_cast<uint8_t>(value);
  buf[pos++] = static_cast<uint8_t>(value >> 8);
  buf[pos++] = static_cast<uint8_t>(value >> 16);
  buf[pos++] = static_cast<uint8_t>(value >> 24);
}

inline void PutBytes(uint8_t* buf, uint32_t& pos, const uint8_t* src, uint32_t n) {
  for (uint32_t i = 0; i < n; ++i) {
    buf[pos++] = src[i];
  }
}

// Detour at RemoveIpl.firstBuilding (0x404B4A): set edi = gSnapFirst (the range snapshotted at RemoveIpl entry),
// run the clobbered `mov ecx,[0xB74498]`, jmp back to 0x404B54. No scratch regs needed → no push/pop.
inline bool InstallFirstBuildingDetour() {
  uint8_t* t = asi::AllocExec(24);
  if (!t) {
    return false;
  }
  const uintptr_t base = reinterpret_cast<uintptr_t>(t);
  uint32_t p = 0;
  t[p++] = 0x8B;
  t[p++] = 0x3D;  // mov edi, [gSnapFirst]  (abs32 follows)
  Put32(t, p, reinterpret_cast<uint32_t>(&gSnapFirst));
  const uint8_t tail[] = {0x8B, 0x0D, 0x98, 0x44, 0xB7, 0x00};  // mov ecx, [0xB74498]  (relocated clobbered insn)
  PutBytes(t, p, tail, sizeof(tail));
  asi::EmitJmp(t, p, base, asi::Runtime(0x404B54));
  return asi::WriteJmp(asi::Runtime(0x404B4A), base);
}

// Detour at RemoveIpl.lastBuilding (0x404B5D): set edx = gSnapLast, run the clobbered `cmp edi,edx`, jmp to
// 0x404B63. No scratch regs needed.
inline bool InstallLastBuildingDetour() {
  uint8_t* t = asi::AllocExec(24);
  if (!t) {
    return false;
  }
  const uintptr_t base = reinterpret_cast<uintptr_t>(t);
  uint32_t p = 0;
  t[p++] = 0x8B;
  t[p++] = 0x15;  // mov edx, [gSnapLast]  (abs32 follows)
  Put32(t, p, reinterpret_cast<uint32_t>(&gSnapLast));
  const uint8_t tail[] = {0x3B, 0xFA};  // cmp edi, edx  (relocated clobbered insn)
  PutBytes(t, p, tail, sizeof(tail));
  asi::EmitJmp(t, p, base, asi::Runtime(0x404B63));
  return asi::WriteJmp(asi::Runtime(0x404B5D), base);
}

// Detour at the loop back-edge re-read of lastBuilding (0x404BA8: `movsx edx,word[ebx+0x24]`, then `inc edi;
// cmp edi,edx; jle`). The loop TERMINATION re-reads the truncated int16 every iteration — without this it stops
// after one building. Set edx = gSnapLast, run the clobbered `inc edi`, jmp to 0x404BAD. (0x404BA8 is also a jump
// target for the skip paths — they land on our jmp and do the same edx-reload + inc, so they stay correct.)
inline bool InstallLastBuildingLoopDetour() {
  uint8_t* t = asi::AllocExec(24);
  if (!t) {
    return false;
  }
  const uintptr_t base = reinterpret_cast<uintptr_t>(t);
  uint32_t p = 0;
  t[p++] = 0x8B;
  t[p++] = 0x15;  // mov edx, [gSnapLast]  (abs32 follows)
  Put32(t, p, reinterpret_cast<uint32_t>(&gSnapLast));
  t[p++] = 0x47;  // inc edi  (relocated clobbered insn)
  asi::EmitJmp(t, p, base, asi::Runtime(0x404BAD));
  return asi::WriteJmp(asi::Runtime(0x404BA8), base);
}

// [011] Detour at RemoveIpl.dummyRange (0x404C0F): the two pre-loop reads `movsx edi,word[ebx+0x26]` /
// `movsx ecx,word[ebx+0x28]` are ADJACENT (8 bytes), so one 5-byte jmp covers both and the detour sets edi =
// gSnapFirstDummy, ecx = gSnapLastDummy, then jumps to the `cmp edi,ecx` at 0x404C17. Nothing to relocate.
inline bool InstallDummyRangeDetour() {
  uint8_t* t = asi::AllocExec(24);
  if (!t) {
    return false;
  }
  const uintptr_t base = reinterpret_cast<uintptr_t>(t);
  uint32_t p = 0;
  t[p++] = 0x8B;
  t[p++] = 0x3D;  // mov edi, [gSnapFirstDummy]  (abs32 follows)
  Put32(t, p, reinterpret_cast<uint32_t>(&gSnapFirstDummy));
  t[p++] = 0x8B;
  t[p++] = 0x0D;  // mov ecx, [gSnapLastDummy]  (abs32 follows)
  Put32(t, p, reinterpret_cast<uint32_t>(&gSnapLastDummy));
  asi::EmitJmp(t, p, base, asi::Runtime(0x404C17));
  return asi::WriteJmp(asi::Runtime(0x404C0F), base);
}

// [011] Detour at the loop back-edge re-read of lastDummy (0x404C4E: `movsx eax,word[ebx+0x28]`, then `inc edi;
// add ebp,0x38; cmp edi,eax; jle`) — the same shape as the building loop's 0x404BA8. Set eax = gSnapLastDummy,
// run the clobbered `inc edi`, jmp to 0x404C53. (0x404C4E is also the skip-path target inside the loop body —
// those land on our jmp and do the same eax-reload + inc, so they stay correct.)
inline bool InstallLastDummyLoopDetour() {
  uint8_t* t = asi::AllocExec(24);
  if (!t) {
    return false;
  }
  const uintptr_t base = reinterpret_cast<uintptr_t>(t);
  uint32_t p = 0;
  t[p++] = 0xA1;  // mov eax, [gSnapLastDummy]  (abs32 follows)
  Put32(t, p, reinterpret_cast<uint32_t>(&gSnapLastDummy));
  t[p++] = 0x47;  // inc edi  (relocated clobbered insn)
  asi::EmitJmp(t, p, base, asi::Runtime(0x404C53));
  return asi::WriteJmp(asi::Runtime(0x404C4E), base);
}

}  // namespace detail

// We hook the two ENTRY points (they must be pristine — HookObserve overwrites them) and FORCE our bound-read
// detours over the three RemoveIpl read sites. The detours are self-contained (they hardcode the relocated stock
// instruction and jump to a fixed continuation), so they work whether the read site is pristine (OLA/vanilla) or
// already jmp-hooked by FLA — we simply overlay FLA's incomplete int16 patch with our complete one. We DO verify
// the detour CONTINUATION targets, so a future adjuster hooking THOSE makes us defer instead of corrupt.
//
// The sites are named, never re-declared: their bytes come from the catalogue through the generated table.
inline constexpr const char* kInt16Sites[] = {
    "IncludeEntity.entry", "RemoveIpl.entry", "RemoveIpl.cont.404B54", "RemoveIpl.cont.404B63",
    "RemoveIpl.cont.404BAD",
};

// [011] The dummy detours' continuations — verified separately, so an adjuster owning THESE defers the dummy
// half alone and the building half still applies. The read sites themselves (RemoveIpl.dummyRange /
// RemoveIpl.lastDummy.loop) are overlaid, as the building reads are: FLA jmp-hooks both (measured 2026-08-19).
inline constexpr const char* kInt16DummySites[] = {
    "RemoveIpl.cont.404C17",
    "RemoveIpl.cont.404C53",
};

inline void ApplyInt16(asi::Log& log, const asi::Plugin& plugin) {
  if (asi::HostBase() != 0x400000) {
    log.Tagged(plugin.tag, "int16: unexpected image base — DEFER");
    return;
  }
  for (int i = 0; i < kMaxIpl; ++i) {
    gFirstBuilding[i] = 0x7FFFFFFF;
    gLastBuilding[i] = static_cast<int32_t>(0x80000000);
    gFirstDummy[i] = 0x7FFFFFFF;
    gLastDummy[i] = static_cast<int32_t>(0x80000000);
  }
  // Verify every byte we hook or relocate (framework rule) before touching anything.
  if (!asi::VerifySitesOrDefer(log, plugin.tag, plugin.tables, kInt16Sites,
                               sizeof(kInt16Sites) / sizeof(kInt16Sites[0]))) {
    log.Tagged(plugin.tag, "int16: DEFER (patching nothing)");
    return;
  }
  // HookObserve1Cont relocates RemoveIpl's first instruction, so it needs those bytes — from the table, not a
  // second copy of them.
  const asi::ByteAnchor* removeIplEntry = asi::FindSite(plugin.tables, kInt16Sites[1]);
  const asi::ByteAnchor* includeEntry = asi::FindSite(plugin.tables, kInt16Sites[0]);
  if (removeIplEntry == nullptr || includeEntry == nullptr) {  // unreachable while the verify above passed
    log.Tagged(plugin.tag, "int16: site name not in the catalogue — DEFER");
    return;
  }
  // Address AND continuation derive from the site: the trampoline relocates `length` bytes and must resume at
  // exactly entry+length. IncludeEntity is different — its continuation is the HOODLUM-relocated BODY, which is
  // not adjacent to the entry and is therefore a genuine literal.
  const uintptr_t removeIplAt = asi::Runtime(removeIplEntry->address);
  // Order matters: the snapshot hook (RemoveIpl entry) sets gSnap for the bound-read detours a few insns later.
  const bool s = asi::HookObserve1Cont(removeIplAt, removeIplAt + removeIplEntry->length, removeIplEntry->bytes,
                                  removeIplEntry->length, reinterpret_cast<void*>(&PmRemoveIplSnapshot));
  const bool a = asi::HookObserve2(asi::Runtime(includeEntry->address), asi::Runtime(0x1563730),
                                   reinterpret_cast<void*>(&PmIncludeObserver));
  const bool b = detail::InstallFirstBuildingDetour();
  const bool c = detail::InstallLastBuildingDetour();
  const bool e = detail::InstallLastBuildingLoopDetour();  // the loop back-edge re-read — the completeness fix
  log.Tagged(plugin.tag,
             s && a && b && c && e
                 ? "int16 APPLIED (buildings): IncludeEntity observed + RemoveIpl snapshot + bounds int32"
                 : "int16: patch write FAILED (see VirtualProtect)");
#if PM_FIX_INT16_DUMMY
  if (!(s && a)) {
    log.Tagged(plugin.tag, "int16 (dummies): hooks missing — DEFER");
    return;
  }
  if (!asi::VerifySitesOrDefer(log, plugin.tag, plugin.tables, kInt16DummySites,
                               sizeof(kInt16DummySites) / sizeof(kInt16DummySites[0]))) {
    log.Tagged(plugin.tag, "int16 (dummies): DEFER (building half stays applied)");
    return;
  }
  const bool f = detail::InstallDummyRangeDetour();
  const bool g = detail::InstallLastDummyLoopDetour();
  log.Tagged(plugin.tag, f && g ? "int16 APPLIED (dummies): RemoveIpl dummy bounds int32 (2 detours)"
                                : "int16 (dummies): patch write FAILED (see VirtualProtect)");
#endif
}

}  // namespace pm::patches
