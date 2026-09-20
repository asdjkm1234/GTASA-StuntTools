#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <cstdint>

// GTA SA 1.0 US recorder ASI.  Standalone (no CLEO / no SCM opcode), because
// SA-MP 0.3.7-R5 rejects the CLEO-opcode path.  Only Hydra (520) and Rustler /
// "Stuntplane" (476) are recorded, at the game's native ~25 Hz cadence.
//
// Data honesty rule: the Q/A/E/D/arrow columns are KEY INPUT (what the player
// pressed).  The real animated part transforms are read separately from the
// plane's CPlane node frames; `surface_source` says whether those real values
// were available.  Keys are never written into the real-node columns.
namespace {
constexpr uintptr_t kGameProcessCall = 0x53E981;
constexpr uintptr_t kFindPlayerVehicle = 0x56E0D0;
constexpr float kQuickhomeDistanceMetres = 120.0f;
constexpr auto kSamplePeriod = std::chrono::milliseconds(40); // GTA SA's native ~25 Hz logic cadence

struct Vec3 { float x, y, z; };
// CMatrix stores right, forward (called `up` in some old SDK headers), then up
// (called `at`/`forward` in those headers).  Keep the semantic names here.
struct Matrix { Vec3 right; float padRight; Vec3 forward; float padForward; Vec3 up; float padUp; Vec3 position; float padPosition; };

// Verified against GTA SA 1.0 US Plugin-SDK layouts.
constexpr size_t kVehicleMatrix = 0x14;
constexpr size_t kVehicleModel = 0x22;
constexpr size_t kVehicleMoveSpeed = 0x44;
constexpr size_t kVehicleSteer = 0x494;
constexpr size_t kVehicleThrottle = 0x49C;
constexpr size_t kVehicleBrake = 0x4A0;
constexpr size_t kVehicleHealth = 0x4C0;
constexpr size_t kVehiclePrimaryColor = 0x434;
constexpr size_t kVehicleSecondaryColor = 0x435;
constexpr size_t kVehicleTertiaryColor = 0x436;
constexpr size_t kVehicleQuaternaryColor = 0x437;
constexpr size_t kPlaneLandingGearStatus = 0x9CC;
// CAutomobile::m_aCarNodes[CAR_NUM_NODES] (25 pointers) at 0x648.
constexpr size_t kVehicleCarNodes = 0x648;
constexpr size_t kPlaneNodeCount = 25;

// CPlane node ids (ePlaneNodes) whose frames the game animates.
struct NodeSpec { const char* name; int index; };
constexpr NodeSpec kPlaneNodes[] = {
    { "rudder",     16 },
    { "elevator_l", 17 },
    { "elevator_r", 18 },
    { "aileron_l",  19 },
    { "aileron_r",  20 },
    { "gear_l",     21 },
    { "gear_r",     22 },
};
constexpr int kPlaneNodeSpecCount = static_cast<int>(sizeof(kPlaneNodes) / sizeof(kPlaneNodes[0]));
constexpr int kSurfaceCount = 5; // first five entries are the aerodynamic surfaces

// GTA SA 1.0 US globals.
constexpr uintptr_t kGameClockHours = 0xB70153;
constexpr uintptr_t kGameClockMinutes = 0xB70152;
constexpr uintptr_t kGameClockSeconds = 0xB70150; // unsigned short
constexpr uintptr_t kWeatherNew = 0xC8131C;     // short
constexpr uintptr_t kWeatherOld = 0xC81320;     // short
constexpr uintptr_t kWeatherForced = 0xC81318;  // short

// RwFrame: object(8) + inDirtyListLink(8) + modelling(64) + ... So the local
// `modelling` matrix (right/up/at basis) sits at frame+16.
constexpr size_t kRwFrameModelling = 16;

using FindPlayerVehicleFn = void* (__cdecl *)(int playerId, bool includeRemote);
using GameProcessFn = void (__cdecl *)();

struct Sample {
    const void* vehicle;
    int model;
    float health;
    float x, y, z, heading;
    float right_x, right_y, right_z;
    float up_x, up_y, up_z;
    float forward_x, forward_y, forward_z;
    float vx, vy, vz;
    float steer, throttle, brake;
    int color_primary, color_secondary, color_tertiary, color_quaternary;
    float landing_gear_status;
    int q, a, e, d, up, down;
    int game_hour, game_minute, game_second;
    int weather_new, weather_old, weather_forced;
    unsigned nodeStatus;         // bit i set => node i frame readable
    float nodeQuat[kPlaneNodeSpecCount][4]; // local modelling rotation per node
    int nodesReadable;
};

FILE* gFile = nullptr;
FILE* gDebugLog = nullptr;
const void* gVehicle = nullptr;
Sample gPrevious{};
bool gHasPrevious = false;
std::chrono::steady_clock::time_point gPreviousSampleTime{};
int gSequence = 0;
GameProcessFn gOriginalGameProcess = nullptr;
void* gGameProcessTrampoline = nullptr;
std::chrono::steady_clock::time_point gLastSample{};
int gCaptureState = -1; // -1 unknown, 0 no readable player vehicle, 1 vehicle sampled
const void* gObservedVehicle = nullptr;
int gObservedModel = -1;

void debugLog(const char* message) {
    if (!gDebugLog) return;
    char now[32];
    SYSTEMTIME t{}; GetLocalTime(&t);
    _snprintf_s(now, sizeof(now), _TRUNCATE, "%02u:%02u:%02u.%03u", t.wHour, t.wMinute, t.wSecond, t.wMilliseconds);
    std::fprintf(gDebugLog, "%s %s\n", now, message);
    std::fflush(gDebugLog);
}

bool readable(const void* pointer, size_t size) {
    MEMORY_BASIC_INFORMATION info{};
    if (!pointer || !VirtualQuery(pointer, &info, sizeof(info))) return false;
    const DWORD noAccess = PAGE_NOACCESS | PAGE_GUARD;
    const auto begin = reinterpret_cast<uintptr_t>(pointer);
    const auto end = begin + size;
    return (info.State == MEM_COMMIT) && !(info.Protect & noAccess)
        && end >= begin && end <= reinterpret_cast<uintptr_t>(info.BaseAddress) + info.RegionSize;
}

template <typename T>
bool readAt(const void* base, size_t offset, T& out) {
    const auto* address = reinterpret_cast<const unsigned char*>(base) + offset;
    if (!readable(address, sizeof(T))) return false;
    out = *reinterpret_cast<const T*>(address);
    return true;
}

bool keyDown(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }
bool isTrackedModel(int model) { return model == 476 || model == 520; } // Rustler / Hydra

void timestamp(char* out, size_t size) {
    SYSTEMTIME t{}; GetLocalTime(&t);
    _snprintf_s(out, size, _TRUNCATE, "%04u-%02u-%02uT%02u:%02u:%02u.%03u",
        t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond, t.wMilliseconds);
}

// Quaternion (w,x,y,z) from an orthonormal right/up/at basis.  The basis is the
// node's LOCAL modelling matrix, so the replay can apply it to the same DFF node
// without ever mixing world and local space.
void quatFromBasis(const Vec3& right, const Vec3& up, const Vec3& at, float q[4]) {
    const float m00 = right.x, m01 = up.x, m02 = at.x;
    const float m10 = right.y, m11 = up.y, m12 = at.y;
    const float m20 = right.z, m21 = up.z, m22 = at.z;
    const float trace = m00 + m11 + m22;
    float x, y, z, w;
    if (trace > 0.0f) {
        float s = std::sqrt(trace + 1.0f) * 2.0f;
        w = 0.25f * s;
        x = (m21 - m12) / s;
        y = (m02 - m20) / s;
        z = (m10 - m01) / s;
    } else if (m00 > m11 && m00 > m22) {
        float s = std::sqrt(1.0f + m00 - m11 - m22) * 2.0f;
        w = (m21 - m12) / s;
        x = 0.25f * s;
        y = (m01 + m10) / s;
        z = (m02 + m20) / s;
    } else if (m11 > m22) {
        float s = std::sqrt(1.0f + m11 - m00 - m22) * 2.0f;
        w = (m02 - m20) / s;
        x = (m01 + m10) / s;
        y = 0.25f * s;
        z = (m12 + m21) / s;
    } else {
        float s = std::sqrt(1.0f + m22 - m00 - m11) * 2.0f;
        w = (m10 - m01) / s;
        x = (m02 + m20) / s;
        y = (m12 + m21) / s;
        z = 0.25f * s;
    }
    const float norm = std::sqrt(x * x + y * y + z * z + w * w);
    if (norm > 0.0001f) {
        const float inv = 1.0f / norm;
        q[0] = x * inv; q[1] = y * inv; q[2] = z * inv; q[3] = w * inv;
    } else {
        q[0] = q[1] = q[2] = 0.0f; q[3] = 1.0f;
    }
}

// Read one animated plane node's local rotation.  Validates the frame pointer
// before touching it, so a non-plane or an unloaded node degrades to a miss
// instead of a crash.
bool readNodeQuat(const void* vehicle, int nodeIndex, float q[4]) {
    if (nodeIndex <= 0 || nodeIndex >= static_cast<int>(kPlaneNodeCount)) return false;
    void* frame = nullptr;
    if (!readAt(vehicle, kVehicleCarNodes + nodeIndex * sizeof(void*), frame)) return false;
    if (!readable(frame, kRwFrameModelling + 3 * sizeof(Vec3))) return false;
    Vec3 right{}, up{}, at{};
    const auto* base = reinterpret_cast<const unsigned char*>(frame) + kRwFrameModelling;
    std::memcpy(&right, base, sizeof(Vec3));
    std::memcpy(&up, base + sizeof(Vec3) + 4, sizeof(Vec3));   // 16-byte stride with flags
    std::memcpy(&at, base + 2 * (sizeof(Vec3) + 4), sizeof(Vec3));
    const float lenR = std::sqrt(right.x * right.x + right.y * right.y + right.z * right.z);
    const float lenU = std::sqrt(up.x * up.x + up.y * up.y + up.z * up.z);
    const float lenA = std::sqrt(at.x * at.x + at.y * at.y + at.z * at.z);
    if (lenR < 0.5f || lenU < 0.5f || lenA < 0.5f) return false; // degenerate / not a frame
    quatFromBasis(right, up, at, q);
    return true;
}

void closeSession(const char* reason) {
    if (!gFile) return;
    char now[32]; timestamp(now, sizeof(now));
    std::fprintf(gFile, "# session_end,%s,%s\n", reason, now);
    std::fclose(gFile);
    gFile = nullptr; gVehicle = nullptr; gHasPrevious = false; gPreviousSampleTime = {};
}

const char* surfaceSource(const Sample& s) {
    if (!s.nodesReadable) return "inferred";
    if (s.nodesReadable >= kSurfaceCount) return "real";
    return "partial";
}

void startSession(const Sample& s) {
    CreateDirectoryA("flight_recordings", nullptr);
    SYSTEMTIME t{}; GetLocalTime(&t);
    char path[MAX_PATH];
    _snprintf_s(path, sizeof(path), _TRUNCATE,
        "flight_recordings\\flight_%04u%02u%02u_%02u%02u%02u_%03u_m%d_%03d.csv",
        t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond, t.wMilliseconds, s.model, ++gSequence);
    gFile = std::fopen(path, "wb");
    if (!gFile) return;
    char now[32]; timestamp(now, sizeof(now));
    std::fprintf(gFile, "# gtasa_flight_recorder,version=6,sample_hz=25\n");
    std::fprintf(gFile, "# node_columns=rudder,elevator_l,elevator_r,aileron_l,aileron_r,gear_l,gear_r\n");
    std::fprintf(gFile, "# surface_source: real=read from CPlane node frames, partial=some nodes, inferred=not available (keys only)\n");
    std::fprintf(gFile, "# session_start,%s,reason=vehicle_entered,model=%d\n", now, s.model);
    std::fprintf(gFile, "local_timestamp,model,health,x,y,z,heading_deg,right_x,right_y,right_z,up_x,up_y,up_z,forward_x,forward_y,forward_z,vx,vy,vz,ax,ay,az,steer,throttle,brake,color_primary,color_secondary,color_tertiary,color_quaternary,landing_gear_status,key_q,key_a,key_e,key_d,key_up,key_down,game_hour,game_minute,game_second,weather_new,weather_old,weather_forced,node_status,surface_source,rudder_qx,rudder_qy,rudder_qz,rudder_qw,elevator_l_qx,elevator_l_qy,elevator_l_qz,elevator_l_qw,elevator_r_qx,elevator_r_qy,elevator_r_qz,elevator_r_qw,aileron_l_qx,aileron_l_qy,aileron_l_qz,aileron_l_qw,aileron_r_qx,aileron_r_qy,aileron_r_qz,aileron_r_qw,gear_l_qx,gear_l_qy,gear_l_qz,gear_l_qw,gear_r_qx,gear_r_qy,gear_r_qz,gear_r_qw\n");
    gVehicle = s.vehicle;
}

void writeQuat(const float q[4], int readable, char* out, size_t size) {
    if (!readable) { _snprintf_s(out, size, _TRUNCATE, "nan,nan,nan,nan"); return; }
    _snprintf_s(out, size, _TRUNCATE, "%.6f,%.6f,%.6f,%.6f", q[0], q[1], q[2], q[3]);
}

void writeSample(const Sample& s, std::chrono::steady_clock::time_point sampleTime) {
    if (!gFile) return;
    float ax = 0.0f, ay = 0.0f, az = 0.0f;
    if (gHasPrevious) {
        const float elapsedSeconds = std::chrono::duration<float>(sampleTime - gPreviousSampleTime).count();
        if (elapsedSeconds > 0.0001f) {
            ax = (s.vx - gPrevious.vx) / elapsedSeconds;
            ay = (s.vy - gPrevious.vy) / elapsedSeconds;
            az = (s.vz - gPrevious.vz) / elapsedSeconds;
        }
    }
    char now[32]; timestamp(now, sizeof(now));
    std::fprintf(gFile, "%s,%d,%.3f,%.6f,%.6f,%.6f,%.4f,%.7f,%.7f,%.7f,%.7f,%.7f,%.7f,%.7f,%.7f,%.7f,%.7f,%.7f,%.7f,%.7f,%.7f,%.7f,%.6f,%.6f,%.6f,%d,%d,%d,%d,%.6f,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%u,%s",
        now, s.model, s.health, s.x, s.y, s.z, s.heading,
        s.right_x, s.right_y, s.right_z, s.up_x, s.up_y, s.up_z, s.forward_x, s.forward_y, s.forward_z,
        s.vx, s.vy, s.vz, ax, ay, az, s.steer, s.throttle, s.brake,
        s.color_primary, s.color_secondary, s.color_tertiary, s.color_quaternary, s.landing_gear_status,
        s.q, s.a, s.e, s.d, s.up, s.down,
        s.game_hour, s.game_minute, s.game_second,
        s.weather_new, s.weather_old, s.weather_forced,
        s.nodeStatus, surfaceSource(s));
    for (int i = 0; i < kPlaneNodeSpecCount; i++) {
        char buffer[96];
        writeQuat(s.nodeQuat[i], (s.nodeStatus >> i) & 1u, buffer, sizeof(buffer));
        std::fprintf(gFile, ",%s", buffer);
    }
    std::fprintf(gFile, "\n");
    std::fflush(gFile);
    gPrevious = s; gPreviousSampleTime = sampleTime; gHasPrevious = true;
}

bool quickhome(const Sample& s) {
    if (!gHasPrevious || s.vehicle != gVehicle) return false;
    const float dx = s.x - gPrevious.x, dy = s.y - gPrevious.y, dz = s.z - gPrevious.z;
    return std::sqrt(dx * dx + dy * dy + dz * dz) >= kQuickhomeDistanceMetres;
}

void readGameClock(Sample& s) {
    unsigned char hour = 0, minute = 0; unsigned short second = 0;
    s.game_hour = (readAt(reinterpret_cast<const void*>(kGameClockHours), 0, hour), static_cast<int>(hour));
    s.game_minute = (readAt(reinterpret_cast<const void*>(kGameClockMinutes), 0, minute), static_cast<int>(minute));
    s.game_second = (readAt(reinterpret_cast<const void*>(kGameClockSeconds), 0, second), static_cast<int>(second));
}

void readWeather(Sample& s) {
    short value = 0;
    s.weather_new = (readAt(reinterpret_cast<const void*>(kWeatherNew), 0, value), static_cast<int>(value));
    s.weather_old = (readAt(reinterpret_cast<const void*>(kWeatherOld), 0, value), static_cast<int>(value));
    s.weather_forced = (readAt(reinterpret_cast<const void*>(kWeatherForced), 0, value), static_cast<int>(value));
}

bool captureSample(Sample& s) {
    const auto findVehicle = reinterpret_cast<FindPlayerVehicleFn>(kFindPlayerVehicle);
    void* vehicle = findVehicle(-1, false);
    if (!readable(vehicle, kVehicleHealth + sizeof(float))) return false;
    Matrix* matrix = nullptr;
    if (!readAt(vehicle, kVehicleMatrix, matrix) || !readable(matrix, sizeof(Matrix))) return false;
    Vec3 speed{};
    if (!readAt(vehicle, kVehicleMoveSpeed, speed)) return false;
    uint16_t model{};
    if (!readAt(vehicle, kVehicleModel, model)) return false;
    s.vehicle = vehicle;
    s.model = static_cast<int>(model);
    uint8_t primary{}, secondary{}, tertiary{}, quaternary{};
    const bool captured = readAt(vehicle, kVehicleHealth, s.health)
        && readAt(vehicle, kVehicleSteer, s.steer)
        && readAt(vehicle, kVehicleThrottle, s.throttle)
        && readAt(vehicle, kVehicleBrake, s.brake)
        && readAt(vehicle, kVehiclePrimaryColor, primary)
        && readAt(vehicle, kVehicleSecondaryColor, secondary)
        && readAt(vehicle, kVehicleTertiaryColor, tertiary)
        && readAt(vehicle, kVehicleQuaternaryColor, quaternary)
        && ((s.x = matrix->position.x), (s.y = matrix->position.y), (s.z = matrix->position.z),
            (s.right_x = matrix->right.x), (s.right_y = matrix->right.y), (s.right_z = matrix->right.z),
            (s.up_x = matrix->up.x), (s.up_y = matrix->up.y), (s.up_z = matrix->up.z),
            (s.forward_x = matrix->forward.x), (s.forward_y = matrix->forward.y), (s.forward_z = matrix->forward.z),
            (s.heading = std::atan2(-matrix->forward.x, matrix->forward.y) * 57.2957795f),
            (s.vx = speed.x), (s.vy = speed.y), (s.vz = speed.z),
            (s.q = keyDown('Q')), (s.a = keyDown('A')), (s.e = keyDown('E')), (s.d = keyDown('D')),
            (s.up = keyDown(VK_UP)), (s.down = keyDown(VK_DOWN)), true);
    if (!captured) return false;
    s.color_primary = primary; s.color_secondary = secondary; s.color_tertiary = tertiary; s.color_quaternary = quaternary;
    s.landing_gear_status = 0.0f;
    if (!readAt(vehicle, kPlaneLandingGearStatus, s.landing_gear_status)) s.landing_gear_status = 0.0f;
    s.nodesReadable = 0;
    s.nodeStatus = 0;
    for (int i = 0; i < kPlaneNodeSpecCount; i++) {
        s.nodeQuat[i][0] = s.nodeQuat[i][1] = s.nodeQuat[i][2] = 0.0f; s.nodeQuat[i][3] = 1.0f;
        if (readNodeQuat(vehicle, kPlaneNodes[i].index, s.nodeQuat[i])) {
            s.nodeStatus |= (1u << i);
            s.nodesReadable += 1;
        }
    }
    readGameClock(s);
    readWeather(s);
    return true;
}

void onGameProcess() {
    static unsigned calls = 0;
    if ((++calls % 300u) == 0u) {
        char heartbeat[64];
        _snprintf_s(heartbeat, sizeof(heartbeat), _TRUNCATE, "heartbeat calls=%u capture_state=%d", calls, gCaptureState);
        debugLog(heartbeat);
    }
    const auto now = std::chrono::steady_clock::now();
    if (gLastSample.time_since_epoch().count() && now - gLastSample < kSamplePeriod) return;
    gLastSample = now;
    Sample s{};
    if (!captureSample(s)) {
        if (gCaptureState != 0) debugLog("diagnostic: no readable player vehicle");
        gCaptureState = 0;
        closeSession("player_left_vehicle_or_vehicle_destroyed");
        return;
    }
    if (gCaptureState != 1 || s.vehicle != gObservedVehicle || s.model != gObservedModel) {
        char message[128];
        _snprintf_s(message, sizeof(message), _TRUNCATE,
            "diagnostic: player vehicle=%p model=%d tracked=%s nodes=%d", s.vehicle, s.model,
            isTrackedModel(s.model) ? "yes" : "no", s.nodesReadable);
        debugLog(message);
    }
    gCaptureState = 1; gObservedVehicle = s.vehicle; gObservedModel = s.model;
    if (!isTrackedModel(s.model)) { closeSession("non_target_vehicle"); return; }
    if (gFile && s.vehicle != gVehicle) closeSession("vehicle_changed");
    if (gFile && quickhome(s)) closeSession("quickhome_teleport_detected");
    if (!gFile) startSession(s);
    if (gFile && !gHasPrevious) debugLog("vehicle detected; CSV session opened");
    writeSample(s, now);
}

bool ensureTrampoline() {
    if (gGameProcessTrampoline) return true;
    auto* trampoline = static_cast<unsigned char*>(VirtualAlloc(nullptr, 16, MEM_RESERVE | MEM_COMMIT, PAGE_EXECUTE_READWRITE));
    if (!trampoline) return false;
    trampoline[0] = 0xFF; trampoline[1] = 0x15;
    *reinterpret_cast<uintptr_t*>(trampoline + 2) = reinterpret_cast<uintptr_t>(&gOriginalGameProcess);
    trampoline[6] = 0x9C; trampoline[7] = 0x60; trampoline[8] = 0xE8;
    *reinterpret_cast<int32_t*>(trampoline + 9) = static_cast<int32_t>(reinterpret_cast<uintptr_t>(&onGameProcess) - (reinterpret_cast<uintptr_t>(trampoline) + 13));
    trampoline[13] = 0x61; trampoline[14] = 0x9D; trampoline[15] = 0xC3;
    gGameProcessTrampoline = trampoline;
    return true;
}

// The target the game-process CALL currently points at: CLEO's hook, another ASI's, or the game's own.
// Accepts a rel32 CALL (0xE8) or JMP (0xE9) so a chained hook written either way is still followed.
void* currentCallTarget() {
    const auto* call = reinterpret_cast<const unsigned char*>(kGameProcessCall);
    if (!readable(call, 5) || (call[0] != 0xE8 && call[0] != 0xE9)) return nullptr;
    return reinterpret_cast<void*>(kGameProcessCall + 5 + *reinterpret_cast<const int32_t*>(call + 1));
}

void applyPatch() {
    DWORD oldProtect{};
    if (!VirtualProtect(reinterpret_cast<void*>(kGameProcessCall), 5, PAGE_EXECUTE_READWRITE, &oldProtect)) return;
    unsigned char patch[5] = { 0xE8 };
    const auto relative = reinterpret_cast<uintptr_t>(gGameProcessTrampoline) - (kGameProcessCall + 5);
    *reinterpret_cast<int32_t*>(patch + 1) = static_cast<int32_t>(relative);
    std::memcpy(reinterpret_cast<void*>(kGameProcessCall), patch, sizeof(patch));
    FlushInstructionCache(GetCurrentProcess(), reinterpret_cast<void*>(kGameProcessCall), 5);
    DWORD ignored{}; VirtualProtect(reinterpret_cast<void*>(kGameProcessCall), 5, oldProtect, &ignored);
}

bool installHook() {
    if (!ensureTrampoline()) return false;
    void* target = currentCallTarget();
    if (!target || target == gGameProcessTrampoline) return gGameProcessTrampoline != nullptr;
    gOriginalGameProcess = reinterpret_cast<GameProcessFn>(target);
    applyPatch();
    return true;
}

// CLEO (and possibly other ASIs) replaces the SAME game-process call during ITS initialization, and the order
// is not fixed — a fixed delay raced CLEO and got overwritten, which silently stopped all recording. This
// watchdog re-asserts our patch and chains whatever now sits there, so whoever patches last is still called.
DWORD WINAPI watchGameProcessHook(LPVOID) {
    for (;;) {
        Sleep(1000);
        if (!gGameProcessTrampoline) continue;
        void* target = currentCallTarget();
        if (!target || target == gGameProcessTrampoline) continue;
        gOriginalGameProcess = reinterpret_cast<GameProcessFn>(target);
        applyPatch();
        debugLog("game-process hook re-asserted (overwritten by another ASI)");
    }
}

DWORD WINAPI installHookAfterLoad(LPVOID) {
    // Install soon, then keep re-asserting: do NOT rely on a fixed sleep to beat CLEO.
    Sleep(1500);
    debugLog(installHook() ? "game-process hook installed" : "game-process hook installation failed");
    HANDLE watchdog = CreateThread(nullptr, 0, watchGameProcessHook, nullptr, 0, nullptr);
    if (watchdog) CloseHandle(watchdog);
    return 0;
}
}

BOOL WINAPI DllMain(HINSTANCE module, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) {
        gDebugLog = std::fopen("FlightRecorder.asi.log", "ab");
        debugLog("ASI loaded");
        DisableThreadLibraryCalls(module);
        HANDLE worker = CreateThread(nullptr, 0, installHookAfterLoad, nullptr, 0, nullptr);
        if (worker) CloseHandle(worker);
    }
    if (reason == DLL_PROCESS_DETACH) {
        closeSession("game_closed");
        debugLog("ASI unloaded");
        if (gDebugLog) { std::fclose(gDebugLog); gDebugLog = nullptr; }
    }
    return TRUE;
}
