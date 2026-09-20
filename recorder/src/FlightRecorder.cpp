#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <cmath>
#include <cstdio>
#include <cstring>
#include "CLEO.h"

namespace {
// 0A4F is intentionally unused by GTA SA 1.0 and the bundled CLEO 4.4 set.
// Do not use 0E10: CLEO 4.4 already assigns it to mouse-wheel input.
constexpr WORD kOpcode = 0x0A4F;
constexpr float kQuickhomeDistanceMetres = 120.0f;

struct Sample {
    int vehicle;
    int model;
    float health;
    float x, y, z;
    float heading;
    float vx, vy, vz;
    int q, a, e, d, up, down;
};

FILE* gFile = nullptr;
int gVehicle = -1;
int gSequence = 0;
Sample gPrevious{};
bool gHasPrevious = false;

void timestamp(char* out, size_t size) {
    SYSTEMTIME t{};
    GetLocalTime(&t);
    _snprintf_s(out, size, _TRUNCATE, "%04u-%02u-%02uT%02u:%02u:%02u.%03u",
        t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond, t.wMilliseconds);
}

void closeSession(const char* reason) {
    if (!gFile) return;
    char now[32]; timestamp(now, sizeof(now));
    std::fprintf(gFile, "# session_end,%s,%s\\n", reason, now);
    std::fclose(gFile);
    gFile = nullptr;
    gVehicle = -1;
    gHasPrevious = false;
}

void startSession(const Sample& s, const char* reason) {
    CreateDirectoryA("flight_recordings", nullptr);
    SYSTEMTIME t{}; GetLocalTime(&t);
    char path[MAX_PATH];
    _snprintf_s(path, sizeof(path), _TRUNCATE,
        "flight_recordings\\flight_%04u%02u%02u_%02u%02u%02u_%03u_v%d_%03d.csv",
        t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond, t.wMilliseconds,
        s.vehicle, ++gSequence);
    gFile = std::fopen(path, "wb");
    if (!gFile) return;
    char now[32]; timestamp(now, sizeof(now));
    std::fprintf(gFile, "# gtasa_flight_recorder,version=1,sample_hz=30\\n");
    std::fprintf(gFile, "# session_start,%s,reason=%s,vehicle_handle=%d,model=%d\\n", now, reason, s.vehicle, s.model);
    std::fprintf(gFile, "local_timestamp,vehicle_handle,model,health,x,y,z,heading_deg,vx,vy,vz,ax,ay,az,key_q,key_a,key_e,key_d,key_up,key_down\\n");
    gVehicle = s.vehicle;
}

void writeSample(const Sample& s) {
    if (!gFile) return;
    float ax = 0, ay = 0, az = 0;
    if (gHasPrevious) {
        // The script supplies GTA velocity units per frame; multiplied by 30 to retain a per-second derivative.
        ax = (s.vx - gPrevious.vx) * 30.0f;
        ay = (s.vy - gPrevious.vy) * 30.0f;
        az = (s.vz - gPrevious.vz) * 30.0f;
    }
    char now[32]; timestamp(now, sizeof(now));
    std::fprintf(gFile, "%s,%d,%d,%.3f,%.6f,%.6f,%.6f,%.4f,%.7f,%.7f,%.7f,%.7f,%.7f,%.7f,%d,%d,%d,%d,%d,%d\\n",
        now, s.vehicle, s.model, s.health, s.x, s.y, s.z, s.heading, s.vx, s.vy, s.vz,
        ax, ay, az, s.q, s.a, s.e, s.d, s.up, s.down);
    std::fflush(gFile);
    gPrevious = s;
    gHasPrevious = true;
}

bool isQuickhome(const Sample& s) {
    if (!gHasPrevious || s.vehicle != gVehicle) return false;
    const float dx = s.x - gPrevious.x, dy = s.y - gPrevious.y, dz = s.z - gPrevious.z;
    const float distance = std::sqrt(dx * dx + dy * dy + dz * dz);
    return distance >= kQuickhomeDistanceMetres;
}

OpcodeResult WINAPI recorderTick(CScriptThread* thread) {
    const int active = static_cast<int>(CLEO_GetIntOpcodeParam(thread));
    if (!active) { closeSession("player_left_vehicle_or_vehicle_destroyed"); return OR_CONTINUE; }
    Sample s{};
    s.vehicle = static_cast<int>(CLEO_GetIntOpcodeParam(thread));
    s.model = static_cast<int>(CLEO_GetIntOpcodeParam(thread));
    s.health = CLEO_GetFloatOpcodeParam(thread);
    s.x = CLEO_GetFloatOpcodeParam(thread); s.y = CLEO_GetFloatOpcodeParam(thread); s.z = CLEO_GetFloatOpcodeParam(thread);
    s.heading = CLEO_GetFloatOpcodeParam(thread);
    s.vx = CLEO_GetFloatOpcodeParam(thread); s.vy = CLEO_GetFloatOpcodeParam(thread); s.vz = CLEO_GetFloatOpcodeParam(thread);
    s.q = static_cast<int>(CLEO_GetIntOpcodeParam(thread)); s.a = static_cast<int>(CLEO_GetIntOpcodeParam(thread));
    s.e = static_cast<int>(CLEO_GetIntOpcodeParam(thread)); s.d = static_cast<int>(CLEO_GetIntOpcodeParam(thread));
    s.up = static_cast<int>(CLEO_GetIntOpcodeParam(thread)); s.down = static_cast<int>(CLEO_GetIntOpcodeParam(thread));

    if (gFile && s.vehicle != gVehicle) closeSession("vehicle_changed");
    if (gFile && isQuickhome(s)) closeSession("quickhome_teleport_detected");
    if (!gFile) startSession(s, gVehicle == -1 ? "vehicle_entered" : "continued");
    writeSample(s);
    return OR_CONTINUE;
}
}

BOOL WINAPI DllMain(HINSTANCE, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH && CLEO_GetVersion() >= CLEO_VERSION) {
        CLEO_RegisterOpcode(kOpcode, recorderTick);
    }
    if (reason == DLL_PROCESS_DETACH) closeSession("game_closed");
    return TRUE;
}
