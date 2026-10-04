#pragma once
// The game structures this plugin reads, in ONE place. Every offset and address below was read out of the
// accepted exe (SHA1 8c23ceff…) and cross-checked against gta-reversed-modern — see plan 001's design table.
// Nothing here writes; the patches in `patches/` do that.
//
// The VAs are used as ABSOLUTE addresses: SA 1.0 is linked at 0x400000 and does not relocate, and every patch
// here refuses to install unless `asi::HostBase()` is that base (the same gate perfect-map's fx2dfx uses). The
// alternative — resolving through `asi::Runtime()` — puts a `GetModuleHandleA` call inside a classifier that
// runs per visible entity per frame, which is not a price a render path should pay.
#include <cstdint>

namespace pc::game {

inline constexpr uintptr_t kExpectedImageBase = 0x400000;

// --- entity layout (CEntity / CPlaceable / CObject) --------------------------------------------------------
inline constexpr uint32_t kPlacementPos = 0x04;   // CPlaceable::m_placement position (used when m_matrix null)
inline constexpr uint32_t kMatrix = 0x14;         // CPlaceable::m_matrix
inline constexpr uint32_t kMatrixPos = 0x30;      // CMatrix::pos
inline constexpr uint32_t kModelIndex = 0x22;     // CEntity::m_nModelIndex (int16)
inline constexpr uint32_t kTypeByte = 0x36;       // CEntity type bitfield; `& 7` is the entity type
inline constexpr uint32_t kObjectType = 0x13C;    // CObject::m_nObjectType (CPhysical is 0x138 bytes)
inline constexpr uint8_t kEntityTypeObject = 4;   // eEntityType ENTITY_TYPE_OBJECT
inline constexpr uint8_t kObjectTypeCutscene = 4; // eObjectType OBJECT_TYPE_CUTSCENE

inline constexpr uint32_t kRwObject = 0x18;      // CEntity::m_pRwObject
inline constexpr uint8_t kRwObjectClump = 2;     // rpCLUMP, in the RwObject's first byte

// --- model info -------------------------------------------------------------------------------------------
inline constexpr uint32_t kModelInfoPtrsVa = 0xa9b0c8;  // CModelInfo::ms_modelInfoPtrs
inline constexpr uint32_t kModelInfoKey = 0x04;         // CBaseModelInfo::m_nKey (CKeyGen hash of the name)
inline constexpr uint32_t kGetModelTypeSlot = 4;        // CBaseModelInfo vtable: dtor, As*Ptr ×3, GetModelType
inline constexpr uint8_t kModelInfoVehicle = 6;         // ModelInfoType MODEL_INFO_VEHICLE

// --- the engine's own skinned-clump test (RwHelper.cpp) ---------------------------------------------------
// `GetAnimHierarchyFromSkinClump(clump)`: non-null only when the clump's first atomic is SKINNED. That is how
// CCutsceneMgr itself tells a cutscene ACTOR from a cutscene car/prop (see its particle-attachment code), and
// it is the only split available — every cutscene model, actor and car alike, is loaded into the shared
// CUTOBJ clump slots, so `GetModelType()` reports 5 (MODEL_INFO_CLUMP) for all of them (measured in the field,
// plan 001 step 2 round 1).
inline constexpr uint32_t kGetAnimHierarchyFromSkinClumpVa = 0x734a40;

using GetAnimHierarchyFn = void*(__cdecl*)(void*);

// --- renderer globals -------------------------------------------------------------------------------------
inline constexpr uint32_t kCameraPosVa = 0xb76870;  // CRenderer::ms_vecCameraPosition (3 floats)
inline constexpr uint32_t kCurrAreaVa = 0xb72914;   // CGame::currArea — 0 is the outdoor world
inline constexpr uint32_t kModelInfoFlagsByte = 0x12;    // CBaseModelInfo flag byte carrying bDontWriteZBuffer
inline constexpr uint8_t kDontWriteZBufferBit = 0x08;

// --- render state -----------------------------------------------------------------------------------------
// RW's device call table: `mov ecx,[0xC97B24]; push value; push state; call [ecx+0x20]` is how the game itself
// reaches RwRenderStateSet (read out of CVisibilityPlugins::RenderEntity).
inline constexpr uint32_t kRwDevicePtrVa = 0xc97b24;
inline constexpr uint32_t kRwRenderStateSetSlot = 0x20;
inline constexpr uint32_t kRsAlphaTestFunctionRef = 30;  // rwRENDERSTATEALPHATESTFUNCTIONREF
inline constexpr uint32_t kOutdoorAlphaRef = 140;        // what RenderEverythingBarRoads sets outdoors
inline constexpr uint32_t kDeferredAlphaRef = 100;       // what RenderEntity sets in the deferred pass

using RwRenderStateSetFn = int(__cdecl*)(uint32_t, uint32_t);

inline void SetRenderState(uint32_t state, uint32_t value) {
  void* device = *reinterpret_cast<void**>(kRwDevicePtrVa);
  if (device == nullptr) {
    return;
  }
  RwRenderStateSetFn set =
      *reinterpret_cast<RwRenderStateSetFn*>(reinterpret_cast<uintptr_t>(device) + kRwRenderStateSetSlot);
  set(state, value);
}

inline bool IsOutdoorArea() {
  return *reinterpret_cast<const int32_t*>(kCurrAreaVa) == 0;
}

// --- the .rdata window a model-info vtable must live in, so a garbage pointer never becomes a call ---------
inline constexpr uint32_t kRdataLowVa = 0x858000;
inline constexpr uint32_t kRdataHighVa = 0x8a4000;

using GetModelTypeFn = uint8_t(__attribute__((thiscall)) *)(void*);

inline uint8_t ByteAt(const void* base, uint32_t offset) {
  return *reinterpret_cast<const uint8_t*>(reinterpret_cast<uintptr_t>(base) + offset);
}

inline int16_t Int16At(const void* base, uint32_t offset) {
  return *reinterpret_cast<const int16_t*>(reinterpret_cast<uintptr_t>(base) + offset);
}

inline void* PtrAt(const void* base, uint32_t offset) {
  return *reinterpret_cast<void* const*>(reinterpret_cast<uintptr_t>(base) + offset);
}

inline uint8_t EntityType(const void* entity) {
  return static_cast<uint8_t>(ByteAt(entity, kTypeByte) & 7);
}

inline void* ModelInfo(int16_t modelIndex) {
  if (modelIndex < 0) {
    return nullptr;
  }
  void** table = reinterpret_cast<void**>(kModelInfoPtrsVa);
  return table[modelIndex];
}

/**
 * `modelInfo->GetModelType()` through the vtable — the general test (a model's TYPE, never its name or its id
 * range, which FLA moves). The vtable pointer is range-checked against .rdata first: on anything unexpected we
 * return 0 (= no type) instead of calling through a garbage pointer.
 */
inline uint8_t ModelType(void* modelInfo) {
  if (modelInfo == nullptr) {
    return 0;
  }
  const uintptr_t vtable = reinterpret_cast<uintptr_t>(PtrAt(modelInfo, 0));
  if (vtable < kRdataLowVa || vtable >= kRdataHighVa) {
    return 0;
  }
  GetModelTypeFn getType = reinterpret_cast<GetModelTypeFn>(reinterpret_cast<void**>(vtable)[kGetModelTypeSlot]);
  return getType(modelInfo);
}

/** The renderer's own inlined `CEntity::GetPosition()`: the matrix position when there is a matrix, else the
 *  simple placement. Returns a pointer to three floats. */
inline const float* EntityPosition(const void* entity) {
  void* matrix = PtrAt(entity, kMatrix);
  if (matrix != nullptr) {
    return reinterpret_cast<const float*>(reinterpret_cast<uintptr_t>(matrix) + kMatrixPos);
  }
  return reinterpret_cast<const float*>(reinterpret_cast<uintptr_t>(entity) + kPlacementPos);
}

inline float Sqrt(float value) {
  float result;
  __asm__("fsqrt" : "=t"(result) : "0"(value));  // no CRT under -nostdlib
  return result;
}

/** Distance from the camera the visible-entity loop itself uses as the sort key. */
inline float DistanceFromCamera(const void* entity) {
  const float* pos = EntityPosition(entity);
  const float* cam = reinterpret_cast<const float*>(kCameraPosVa);
  const float dx = cam[0] - pos[0];
  const float dy = cam[1] - pos[1];
  const float dz = cam[2] - pos[2];
  return Sqrt(dx * dx + dy * dy + dz * dz);
}

/** The model's `bDontWriteZBuffer` flag — the one input, besides the area, to the ref RenderEntity picks. */
inline bool ModelDontWriteZBuffer(const void* entity) {
  void* modelInfo = ModelInfo(Int16At(entity, kModelIndex));

  return modelInfo != nullptr && (ByteAt(modelInfo, kModelInfoFlagsByte) & kDontWriteZBufferBit) != 0;
}

/** The clump of an entity, or nullptr when it has no RwObject or the RwObject is not a clump. */
inline void* EntityClump(const void* entity) {
  void* object = PtrAt(entity, kRwObject);
  if (object == nullptr || ByteAt(object, 0) != kRwObjectClump) {
    return nullptr;
  }
  return object;
}

inline bool ClumpIsSkinned(void* clump) {
  return reinterpret_cast<GetAnimHierarchyFn>(kGetAnimHierarchyFromSkinClumpVa)(clump) != nullptr;
}

/**
 * A cutscene object that is NOT a skinned actor — the cars and props whose geometry can z-erase an actor drawn
 * after them, and the only entities this plugin ever treats differently. Deriving it the other way round (find
 * the cars) is not available: cutscene cars and cutscene actors share the CUTOBJ model slots and both report
 * model type 5, so "not skinned" IS the engine's own actor test, run in reverse.
 */
inline bool IsDeferrableCutsceneObject(const void* entity) {
  if (entity == nullptr || EntityType(entity) != kEntityTypeObject) {
    return false;
  }
  if (ByteAt(entity, kObjectType) != kObjectTypeCutscene) {
    return false;
  }
  void* clump = EntityClump(entity);

  return clump != nullptr && !ClumpIsSkinned(clump);
}

}  // namespace pc::game
