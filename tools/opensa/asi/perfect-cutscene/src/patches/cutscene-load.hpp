#pragma once
// The cutscene-object LOAD path — one repointed call, two jobs. The call is
// `CCutsceneObject::SetModelIndex`'s `call SetupCarPipeAtomicsForClump`, which fires once per cutscene object
// as a scene loads, with the model id and the freshly built clump in hand.
//
// 1. **The census (step 2, observation only)** — logs how the object classifies. It earned its keep on round 1:
//    the model TYPE came back 5 (MODEL_INFO_CLUMP) for every cutscene object, cars included, because cutscene
//    models all live in the shared CUTOBJ slots. Round 2 logs the engine's own actor test instead (a skinned
//    clump is an ACTOR).
// A second job — skipping the force-pipe for cutscene cars, so the six kept OUR per-atomic pipelines — was
// tried here and REMOVED the same day: the field says the pipe is what makes their glass look right. It fixed
// nothing it was aimed at and made every other window worse (plan 001 step 4).
#include <cstdint>

#include <asi/append-log.hpp>
#include <asi/fingerprint.hpp>
#include <asi/hook.hpp>
#include <asi/log.hpp>
#include <asi/plugin.hpp>
#include <asi/verify.hpp>

#include "../config.hpp"
#include "../game.hpp"
#include "../identity.hpp"

namespace pc::patches {

using SetupCarPipeFn = void(__cdecl*)(uint32_t, void*);

inline SetupCarPipeFn gSetupCarPipe = nullptr;
inline int32_t gCensusLines = 0;

// One scene loads a handful of objects; the cap only stops a long session from growing the log without bound.
inline constexpr int32_t kCensusLineLimit = 200;

/**
 * Stands in for `SetupCarPipeAtomicsForClump(modelId, clump)` at its ONE call site. A skinned clump is an
 * actor: nothing to log a verdict about and nothing the force-pipe would touch, so it passes straight through.
 */
__attribute__((force_align_arg_pointer)) inline void __cdecl PcSetupCarPipeAtomicsForClump(uint32_t modelId,
                                                                                           void* clump) {
  const bool actor = clump == nullptr || game::ClumpIsSkinned(clump);

#if PC_CENSUS
  if (gCensusLines < kCensusLineLimit) {
    ++gCensusLines;
    void* modelInfo = game::ModelInfo(static_cast<int16_t>(modelId));
    const int32_t key = modelInfo == nullptr
                            ? 0
                            : static_cast<int32_t>(*reinterpret_cast<const uint32_t*>(
                                  reinterpret_cast<uintptr_t>(modelInfo) + game::kModelInfoKey));
    asi::AppendLabelled(kLogFile, "[census] model/key/skinned", static_cast<int32_t>(modelId), key, actor ? 1 : 0);
  }
#endif

  if (gSetupCarPipe != nullptr) {
    gSetupCarPipe(modelId, clump);
  }
}

inline constexpr const char* kLoadSites[] = {
    "CCutsceneObject.SetModelIndex.callSetupCarPipe",
    "CCutsceneObject.SetupCarPipeAtomicsForClump.entry",
    "RwHelper.GetAnimHierarchyFromSkinClump.entry",
};

inline void ApplyCutsceneLoad(asi::Log& log, const asi::Plugin& plugin) {
  if (asi::HostBase() != game::kExpectedImageBase) {
    log.Tagged(plugin.tag, "cutscene-load: unexpected image base — DEFER (game.hpp reads absolute VAs)");
    return;
  }
  if (!asi::VerifySitesOrDefer(log, plugin.tag, plugin.tables, kLoadSites, 3)) {
    log.Tagged(plugin.tag, "cutscene-load: DEFER (patching nothing) — someone else owns the cutscene load path");
    return;
  }
  const asi::ByteAnchor* callSite = asi::FindSite(plugin.tables, kLoadSites[0]);
  const asi::ByteAnchor* target = asi::FindSite(plugin.tables, kLoadSites[1]);
  if (callSite == nullptr || target == nullptr) {
    log.Tagged(plugin.tag, "cutscene-load: site name not in the catalogue — DEFER");
    return;
  }
  // The original callee comes from the call site's OWN rel32, then has to agree with the catalogue's entry
  // address. Decoding it means we never hard-code a callee; cross-checking it means a rel32 that points
  // somewhere unexpected (a relocated body, a foreign hook) stops us instead of being followed blindly.
  const uintptr_t site = asi::Runtime(callSite->address);
  const int32_t rel = *reinterpret_cast<const int32_t*>(site + 1);
  const uintptr_t callee = site + 5 + static_cast<uintptr_t>(rel);
  if (callee != asi::Runtime(target->address)) {
    log.Tagged(plugin.tag, "cutscene-load: call site does not point at SetupCarPipeAtomicsForClump — DEFER");
    return;
  }
  gSetupCarPipe = reinterpret_cast<SetupCarPipeFn>(callee);
  const bool ok = asi::WriteCall(site, reinterpret_cast<uintptr_t>(&PcSetupCarPipeAtomicsForClump));
  log.Tagged(plugin.tag, ok ? "cutscene-load APPLIED (census): cutscene objects will be logged"
                            : "cutscene-load: patch write FAILED (see VirtualProtect)");
}

}  // namespace pc::patches
