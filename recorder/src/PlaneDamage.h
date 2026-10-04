#pragma once
#include <cstddef>
#include <cstdint>

// Read-only aircraft damage layout, verified against the LOCAL executable as
// well as Plugin-SDK. Never call game getters/setters or infer damage from health.
// https://github.com/DK22Pac/plugin-sdk/blob/master/plugin_sa/game_sa/CDamageManager.h
// https://github.com/gta-reversed/gta-reversed/blob/master/source/game_sa/Entity/Vehicle/Plane.h
namespace plane_damage {
constexpr std::size_t kPanelsOffset = 0x5A0 + 0x14;
constexpr int kSurfaceFrames[] = {16, 17, 18, 19, 20};
constexpr unsigned kAllSurfaces = 0x1F;

// GetAeroplaneCompStatus: [this+0x14] >> (2*(frame-12)) & 3.
constexpr unsigned char kGetterCode[] = {
    0x8B,0xC1,0x8B,0x40,0x14,0x33,0xC9,0x8A,0x4C,0x24,0x04,0x80,
    0xE9,0x0C,0xD0,0xE1,0xD3,0xE8,0x83,0xE0,0x03,0xC2,0x04,0x00
};
// CPlane::ProcessFlyingCarStuff: push frame; lea ecx,[plane+0x5A0]; call getter.
constexpr unsigned char kCallerCode[] = {
    0x53,0x8D,0x8E,0xA0,0x05,0x00,0x00,0xE8,0x64,0x69,0xFF,0xFF
};
template <typename Match>
bool verifiedLayout(Match match) {
    return match(0x6C2300, kGetterCode, sizeof(kGetterCode))
        && match(0x6CB990, kCallerCode, sizeof(kCallerCode));
}
constexpr int decode(std::uint32_t panels, int surface) {
    return surface >= 0 && surface < 5
        ? static_cast<int>((panels >> (2 * (kSurfaceFrames[surface] - 12))) & 3u) : -1;
}
struct Snapshot {
    std::uint32_t raw = 0;
    unsigned valid = 0; // bits 0..4: rudder, elevator L/R, aileron L/R
    bool layoutVerified = false;
    int states[5] = {-1, -1, -1, -1, -1};
};
}
