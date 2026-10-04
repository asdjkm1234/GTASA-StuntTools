#pragma once
// Fix #1 — `carmods.dat`'s game-wide `link` pairs: 30 → kLinkPairs. See plan 001 for the RE.
//
// Root: `CLinkedUpgradeList` @0xB4E6D8 is `int16 m_anUpgrade1[30]` (+0), `int16 m_anUpgrade2[30]` (+0x3C) and a
// DWORD count (+0x78), and its writer adds a pair with NO bounds check of any kind:
//
//   AddUpgradeLink   0x4C74B0  mov eax,[ecx+0x78] · mov [ecx+eax*2],dx · mov [ecx+eax*2+0x3c],dx · inc [ecx+0x78]
//   FindOtherUpgrade 0x4C74D0  loop from count-1 down over both arrays, returns the partner or 0xFFFF
//
// So the 31st `link` line writes past both arrays into whatever follows the structure — silent static
// corruption that surfaces somewhere else entirely. Stock uses 23 of the 30; every added car that re-models
// its base car's wings costs one, and the added fleet needs 31.
//
// **Why replacing the two methods is COMPLETE, not a best effort**: the census in plan 001 found the address
// 0xB4E6D8 exactly seven times in the exe, and every one is a `mov <reg>, 0xb4e6d8` immediately before a call
// to one of these two (the seventh is a getter with no callers at all). Nothing indexes the arrays from
// outside, so once both methods answer out of our storage, the game's own 124-byte structure is simply unused
// and the ceiling is ours. That is also why this is a `hook` and not a `relocate`: relocating would mean
// re-encoding the `+0x3C`/`+0x78` displacements, which are disp8 forms that change instruction length once
// the array grows past 127 bytes.
//
// We also add the bound the game never had: past kLinkPairs the pair is DROPPED and logged, rather than
// written past the end.
//
// Both methods are thiscall-shaped (`this` in ecx, args on the stack, callee-cleanup). We ignore `this`.
#include <windows.h>
#include <cstdint>

#include <asi/append-log.hpp>
#include <asi/hook.hpp>
#include <asi/log.hpp>
#include <asi/plugin.hpp>
#include <asi/verify.hpp>

#include "../config.hpp"
#include "../identity.hpp"

namespace pv::patches {

/** The lifted ceiling. Stock is 30, the added fleet needs 31; the margin is what stops the next fifty cars
 *  reopening this. Compile-time, like every other number in these plugins — an ini would be a second source
 *  of truth for something nobody tunes. */
inline constexpr int kLinkPairs = 256;

namespace detail {

/** The catalogue sites this patch verifies before it writes — named, never re-declared (the framework rule:
 *  the bytes live in `gen/catalogue.ts` and reach here through the generated table). */
inline constexpr const char* kLinkSites[] = {
    "AddUpgradeLink.entry",
    "FindOtherUpgrade.entry",
    "LoadVehicleUpgrades.link.this",
    "FindOtherUpgrade.call.4986BB",
};

// Our storage: the same two parallel arrays and the same count, wider. Zero-initialised in .bss, which is
// what the game's own statics are too.
inline int16_t gUpgrade1[kLinkPairs];
inline int16_t gUpgrade2[kLinkPairs];
inline int32_t gCount = 0;
inline int32_t gDropped = 0;

/** `AddUpgradeLink(left, right)` — the game's writer, with a bound. cdecl; the trampoline forwards the args. */
extern "C" void PvAddUpgradeLink(int32_t left, int32_t right) {
  if (gCount >= kLinkPairs) {
    ++gDropped;
    if (gDropped <= 8) {
      asi::AppendCount(kLogFile, "[perfect-vehicle] link list FULL, pair dropped #", gDropped);
    }
    return;
  }
  gUpgrade1[gCount] = static_cast<int16_t>(left);
  gUpgrade2[gCount] = static_cast<int16_t>(right);
  ++gCount;
}

/** `FindOtherUpgrade(id)` — the partner of a mirrored part, or -1. The game reads only `ax` of the result. */
extern "C" int32_t PvFindOtherUpgrade(int32_t id) {
  const int16_t wanted = static_cast<int16_t>(id);
  for (int32_t i = gCount - 1; i >= 0; --i) {
    if (gUpgrade1[i] == wanted) {
      return gUpgrade2[i];
    }
    if (gUpgrade2[i] == wanted) {
      return gUpgrade1[i];
    }
  }

  return -1;
}

/**
 * Trampoline for a callee-cleanup entry with `argc` DWORD args: forward them to a cdecl `target`, clean our
 * own push, and `ret argc*4` so the caller's stack is what it expects. `this` (ecx) is deliberately dropped —
 * our storage is not the game's structure.
 */
inline uint8_t* MakeThiscallShim(void* target, uint32_t argc) {
  uint8_t* t = asi::AllocExec(32);
  if (!t) {
    return nullptr;
  }
  const uintptr_t base = reinterpret_cast<uintptr_t>(t);
  uint32_t p = 0;
  // Push the args right-to-left, each read from its (shifting) slot above the return address.
  for (uint32_t i = 0; i < argc; ++i) {
    t[p++] = 0xFF;
    t[p++] = 0x74;
    t[p++] = 0x24;
    t[p++] = static_cast<uint8_t>(argc * 4);  // push [esp + argc*4] — the top arg, then the next as we shift
  }
  asi::EmitCall(t, p, base, reinterpret_cast<uintptr_t>(target));
  t[p++] = 0x83;
  t[p++] = 0xC4;
  t[p++] = static_cast<uint8_t>(argc * 4);  // add esp, argc*4   (cdecl caller-cleanup of OUR push)
  t[p++] = 0xC2;                            // ret imm16         (callee-cleanup of the GAME's args)
  t[p++] = static_cast<uint8_t>(argc * 4);
  t[p++] = 0x00;

  return t;
}

}  // namespace detail

/**
 * Apply the link-list lift: verify every catalogued site, then point the two accessors at our storage. A site
 * whose bytes have moved means an adjuster owns it — we defer rather than write, which is the framework rule.
 */
inline void ApplyLinks(asi::Log& log, const asi::Plugin& plugin) {
  if (!asi::VerifySitesOrDefer(log, plugin.tag, plugin.tables, detail::kLinkSites,
                               sizeof(detail::kLinkSites) / sizeof(detail::kLinkSites[0]))) {
    log.Tagged(plugin.tag, "links: DEFER (patching nothing)");
    return;
  }
  uint8_t* addShim = detail::MakeThiscallShim(reinterpret_cast<void*>(&detail::PvAddUpgradeLink), 2);
  uint8_t* findShim = detail::MakeThiscallShim(reinterpret_cast<void*>(&detail::PvFindOtherUpgrade), 1);
  if (!addShim || !findShim) {
    log.Tagged(plugin.tag, "links: could not allocate the trampolines — DEFER");
    return;
  }
  // The addresses come from the catalogue, never from a literal here (the no-hand-edited-address rule).
  const asi::ByteAnchor* addSite = asi::FindSite(plugin.tables, detail::kLinkSites[0]);
  const asi::ByteAnchor* findSite = asi::FindSite(plugin.tables, detail::kLinkSites[1]);
  if (!addSite || !findSite) {
    log.Tagged(plugin.tag, "links: a catalogue site is missing — DEFER");
    return;
  }
  const bool wrote = asi::WriteJmp(asi::Runtime(addSite->address), reinterpret_cast<uintptr_t>(addShim)) &&
                     asi::WriteJmp(asi::Runtime(findSite->address), reinterpret_cast<uintptr_t>(findShim));
  log.Tagged(plugin.tag, wrote ? "links APPLIED: 256 pairs (stock 30), both accessors on our storage"
                               : "links: patch write FAILED (see VirtualProtect)");
}

}  // namespace pv::patches
