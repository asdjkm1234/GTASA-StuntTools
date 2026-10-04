#pragma once
// Step 3 — THE fix. One call is repointed: the inline `call CRenderer::RenderOneNonRoad(entity)` in
// `RenderEverythingBarRoads`' visible-entity loop. A cutscene object that is not a skinned actor (a car, a
// prop — see game.hpp's classifier) goes into the engine's own sorted entity list instead — the same list, callback and flush (`RenderFadingInEntities`)
// gameplay vehicles have used all along, which draws it after every other entity of the pass, back-to-front.
// Everything else falls straight through to the original.
//
// The deferred pass runs at RenderEntity's own alpha-test ref (100, or 0 in an interior) rather than the
// 140 the outdoor pass uses. That is deliberate and field-chosen: mod cutscene glass sits at alpha 102-125,
// so ref 140 discards it outright and the car renders unglazed. Restoring 140 for parity was built and
// REMOVED the same day (plan 001 step 3b) - it was justified by a diagnosis the modulate fix replaced, and
// its real effect is to delete the very tint this plugin exists to keep.
//
// Why here and not per-atomic: `m_alphaList` (the vehicle alpha-atomic list) is cleared and flushed INSIDE one
// entity's `RenderOneNonRoad`, so atomics inserted from a cutscene object would never be drawn. The entity
// list is the mechanism that actually runs late in the frame. Full reasoning: plan 001's design section.
#include <cstdint>

#include <asi/fingerprint.hpp>
#include <asi/hook.hpp>
#include <asi/log.hpp>
#include <asi/plugin.hpp>
#include <asi/verify.hpp>

#include "../config.hpp"
#include "../game.hpp"

namespace pc::patches {

using RenderOneNonRoadFn = void(__cdecl*)(void*);
using InsertEntityIntoSortedListFn = uint8_t(__cdecl*)(void*, float);

inline RenderOneNonRoadFn gRenderOneNonRoad = nullptr;
inline InsertEntityIntoSortedListFn gInsertEntityIntoSortedList = nullptr;

/**
 * Stands in for the loop's `RenderOneNonRoad(entity)`. A classified cutscene object is deferred; if the
 * sorted list is full the insert returns false and we render inline exactly as before — a car is never lost.
 * The deferred entity is rendered later by `CVisibilityPlugins::RenderEntity`, which calls this same
 * `RenderOneNonRoad` — through the ORIGINAL pointer, not this call site, so there is no re-entry.
 */
__attribute__((force_align_arg_pointer)) inline void __cdecl PcRenderOneNonRoad(void* entity) {
  if (game::IsDeferrableCutsceneObject(entity) && gInsertEntityIntoSortedList != nullptr &&
      gInsertEntityIntoSortedList(entity, game::DistanceFromCamera(entity)) != 0) {
    return;
  }
  gRenderOneNonRoad(entity);
}

inline constexpr const char* kDeferSites[] = {
    "CRenderer.RenderEverythingBarRoads.callRenderOneNonRoad",
    "CRenderer.RenderOneNonRoad.entry",
    "CVisibilityPlugins.InsertEntityIntoSortedList.entry",
    "RwHelper.GetAnimHierarchyFromSkinClump.entry",
};

/**
 * Repoint one `E8 rel32` call site at `replacement`, but only after its own rel32 decodes to `expected` — so a
 * site that points anywhere we did not predict (a relocated body, a foreign hook) stops us instead of being
 * followed blindly. Returns the original callee, or 0 when the site is not what the catalogue says.
 */
inline uintptr_t RepointCall(const asi::ByteAnchor& site, uintptr_t expected, void* replacement) {
  const uintptr_t at = asi::Runtime(site.address);
  const int32_t rel = *reinterpret_cast<const int32_t*>(at + 1);
  const uintptr_t callee = at + 5 + static_cast<uintptr_t>(rel);
  if (callee != expected || !asi::WriteCall(at, reinterpret_cast<uintptr_t>(replacement))) {
    return 0;
  }

  return callee;
}

inline void ApplyDefer(asi::Log& log, const asi::Plugin& plugin) {
  if (asi::HostBase() != game::kExpectedImageBase) {
    log.Tagged(plugin.tag, "defer: unexpected image base — DEFER (game.hpp reads absolute VAs)");
    return;
  }
  if (!asi::VerifySitesOrDefer(log, plugin.tag, plugin.tables, kDeferSites, 4)) {
    log.Tagged(plugin.tag, "defer: DEFER (patching nothing) — someone else owns the entity render path");
    return;
  }
  const asi::ByteAnchor* loopCall = asi::FindSite(plugin.tables, kDeferSites[0]);
  const asi::ByteAnchor* renderOne = asi::FindSite(plugin.tables, kDeferSites[1]);
  const asi::ByteAnchor* insert = asi::FindSite(plugin.tables, kDeferSites[2]);
  if (loopCall == nullptr || renderOne == nullptr || insert == nullptr) {
    log.Tagged(plugin.tag, "defer: site name not in the catalogue — DEFER");
    return;
  }
  const uintptr_t original = asi::Runtime(renderOne->address);
  gRenderOneNonRoad = reinterpret_cast<RenderOneNonRoadFn>(original);
  gInsertEntityIntoSortedList = reinterpret_cast<InsertEntityIntoSortedListFn>(asi::Runtime(insert->address));

  const bool ok = RepointCall(*loopCall, original, reinterpret_cast<void*>(&PcRenderOneNonRoad)) != 0;
  log.Tagged(plugin.tag, ok ? "defer APPLIED: cutscene cars/props render in the sorted entity pass"
                            : "defer: loop call site is not what the catalogue says — DEFER");
}

}  // namespace pc::patches
