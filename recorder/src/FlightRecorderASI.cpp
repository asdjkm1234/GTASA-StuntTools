#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <cstdint>
#include <cwchar>
#include "PlaneDamage.h"

// Temporarily disabled for V1.1. Set to 1 to resume recording the original camera trace.
#define FLIGHT_RECORDER_CAMERA_DEBUG 0

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
#if FLIGHT_RECORDER_CAMERA_DEBUG
// GTA SA 1.0 US CCamera/CCam layout (Plugin-SDK). Read only, for temporary comparison traces.
constexpr uintptr_t kTheCamera = 0xB6F028;
constexpr size_t kCamActive = 0x59;
constexpr size_t kCamZoom = 0xB4;
constexpr size_t kCamZoomSmoothed = 0xC0;
constexpr size_t kCamArray = 0x174;
constexpr size_t kCamSize = 0x238;
constexpr size_t kCamMode = 0xC;
constexpr size_t kCamAlpha = 0xAC;
constexpr size_t kCamFov = 0xB4;
constexpr size_t kCamBeta = 0xBC;
constexpr size_t kCamFront = 0x190;
constexpr size_t kCamSource = 0x19C;
constexpr size_t kCamUp = 0x1B4;
constexpr size_t kCameraMatrix = 0x974;
#endif
constexpr float kQuickhomeDistanceMetres = 120.0f;
constexpr auto kSamplePeriod = std::chrono::milliseconds(40); // GTA SA's native ~25 Hz logic cadence

// Collision impacts are INFERRED from two signals the recorder already samples: a one-sample health drop
// or an acceleration spike.  Either signal alone is enough.  No new game offset is read and nothing is
// hooked, so the source token is always `inferred` and is never presented as a measured material/contact.
constexpr float kCollisionHealthDrop = 20.0f;     // health points lost versus the previous sample
constexpr float kCollisionAccelSpike = 30.0f;     // acceleration magnitude, m/s^2
constexpr float kCollisionEnvelopeDecay = 60.0f;  // spike envelope decay per second (peak-hold over ~0.5 s)
constexpr double kCollisionCooldownSeconds = 1.0; // one event per impact; suppresses the damage tail

struct Vec3 { float x, y, z; };
// CMatrix stores right, forward (called `up` in some old SDK headers), then up
// (called `at`/`forward` in those headers).  Keep the semantic names here.
struct Matrix { Vec3 right; float padRight; Vec3 forward; float padForward; Vec3 up; float padUp; Vec3 position; float padPosition; };

#if FLIGHT_RECORDER_CAMERA_DEBUG
struct CameraDebug {
    int valid = 0;
    int matrixValid = 0;
    int active = -1;
    int mode = -1;
    unsigned zoom = 0;
    float zoomSmoothed = 0.0f;
    float alpha = 0.0f, beta = 0.0f, fov = 0.0f;
    Vec3 source{}, front{}, up{};
    Matrix finalMatrix{};
};
#endif

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
// CVehicle::m_nTimeWhenBlowedUp changes when GTA actually creates the explosion.
constexpr size_t kVehicleTimeWhenBlowedUp = 0x4D8;
constexpr size_t kPlaneLandingGearStatus = 0x9CC;
// CAutomobile::m_wMiscComponentAngle controls Hydra nozzle rotation in SA 1.0 US.
constexpr size_t kPlaneNozzleRotation = 0x86C;
constexpr size_t kPlaneNozzleRotationPrevious = 0x86E;
constexpr size_t kPlaneSmokeParticle = 0x9F8;
constexpr size_t kPlaneSmokeEjector = 0xA00;
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
constexpr int kCenterGearNodes[] = { 23, 24 }; // PLANE_MISC_A / PLANE_MISC_B
constexpr int kCenterGearCount = 2;
constexpr int kPropNodes[] = { 12, 13, 14, 15 };
constexpr int kPropNodeCount = 4;

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
    int transmissionGearInferred;
    float engineLoadInferred;
    int color_primary, color_secondary, color_tertiary, color_quaternary;
    float landing_gear_status;
    int q, a, e, d, up, down;
    int w, keyS, left, right, keyboardStateValid;
    int game_hour, game_minute, game_second;
    int weather_new, weather_old, weather_forced;
    unsigned nodeStatus;         // bit i set => node i frame readable
    float nodeQuat[kPlaneNodeSpecCount][4]; // local modelling rotation per node
    int nodesReadable;
    unsigned centerGearStatus; // bit i set => misc node rotation and position readable
    float centerGearQuat[kCenterGearCount][4];
    Vec3 centerGearPosition[kCenterGearCount];
    int nozzleRotation;
    int nozzleRotationPrevious;
    unsigned propNodeStatus;
    float propNodeQuat[kPropNodeCount][4];
    int smokeActive;
    plane_damage::Snapshot surfaceDamage;
#if FLIGHT_RECORDER_CAMERA_DEBUG
    CameraDebug camera;
#endif
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
LONGLONG gSessionQpc = 0;
LONGLONG gQpcFrequency = 0;
bool gExplosionWritten = false;
float gImpactEnvelope = 0.0f;                 // peak-hold acceleration used by the inferred collision test
double gLastCollisionSeconds = -1.0e9;        // session seconds of the last inferred collision event
HANDLE gAudioStopEvent = nullptr;
HANDLE gAudioProcess = nullptr;
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
template <typename Down>
void captureKeyboard(Sample& s, bool foreground, Down down) {
    s.keyboardStateValid = foreground ? 1 : 0;
    s.q = s.a = s.e = s.d = s.up = s.down = 0;
    s.w = s.keyS = s.left = s.right = -1;
    if (!foreground) return;
    s.q = down('Q'); s.w = down('W'); s.e = down('E');
    s.a = down('A'); s.keyS = down('S'); s.d = down('D');
    s.up = down(VK_UP); s.down = down(VK_DOWN); s.left = down(VK_LEFT); s.right = down(VK_RIGHT);
}
bool gameHasKeyboardFocus() {
    DWORD process = 0;
    GetWindowThreadProcessId(GetForegroundWindow(), &process);
    return process == GetCurrentProcessId();
}
bool isTrackedModel(int model) { return model == 476 || model == 520; } // Rustler / Hydra

bool surfaceDamageLayoutVerified() {
    return plane_damage::verifiedLayout([](uintptr_t address, const unsigned char* code, size_t size) {
        const auto* actual = reinterpret_cast<const void*>(address);
        return readable(actual, size) && std::memcmp(actual, code, size) == 0;
    });
}

void captureSurfaceDamage(Sample& s, bool layoutVerified) {
    s.surfaceDamage = {};
    s.surfaceDamage.layoutVerified = layoutVerified;
    if (!layoutVerified || !isTrackedModel(s.model)) return;
    uint32_t panels = 0;
    if (!readAt(s.vehicle, plane_damage::kPanelsOffset, panels)) return;
    s.surfaceDamage.raw = panels;
    s.surfaceDamage.valid = plane_damage::kAllSurfaces;
    for (int i = 0; i < kSurfaceCount; ++i) s.surfaceDamage.states[i] = plane_damage::decode(panels, i);
}

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

bool readNodePose(const void* vehicle, int nodeIndex, float q[4], Vec3& position) {
    if (!readNodeQuat(vehicle, nodeIndex, q)) return false;
    void* frame = nullptr;
    if (!readAt(vehicle, kVehicleCarNodes + nodeIndex * sizeof(void*), frame)) return false;
    if (!readAt(frame, kRwFrameModelling + 3 * 16, position)) return false;
    return std::isfinite(position.x) && std::isfinite(position.y) && std::isfinite(position.z);
}

void stopAudioCapture() {
    if (gAudioStopEvent) {
        SetEvent(gAudioStopEvent);
        CloseHandle(gAudioStopEvent);
        gAudioStopEvent = nullptr;
    }
    if (gAudioProcess) {
        CloseHandle(gAudioProcess);
        gAudioProcess = nullptr;
    }
}

void closeSession(const char* reason) {
    if (!gFile) return;
    char now[32]; timestamp(now, sizeof(now));
    std::fprintf(gFile, "# session_end,%s,%s\n", reason, now);
    std::fclose(gFile);
    stopAudioCapture();
    gFile = nullptr; gVehicle = nullptr; gHasPrevious = false; gPreviousSampleTime = {};
    gSessionQpc = 0; gQpcFrequency = 0; gExplosionWritten = false;
    gImpactEnvelope = 0.0f; gLastCollisionSeconds = -1.0e9;
}

double sessionSeconds(LONGLONG qpc) {
    return gSessionQpc && gQpcFrequency > 0
        ? static_cast<double>(qpc - gSessionQpc) / static_cast<double>(gQpcFrequency) : 0.0;
}

void writeExplosionEvent(LONGLONG qpc) {
    if (!gFile || !gHasPrevious || gExplosionWritten || !gVehicle) return;
    uint32_t explosionTime = 0;
    if (!readAt(gVehicle, kVehicleTimeWhenBlowedUp, explosionTime) || explosionTime == 0) return;
    const double seconds = sessionSeconds(qpc);
    std::fprintf(gFile, "# event,%.6f,explosion,%.6f,%.6f,%.6f\n",
        seconds, gPrevious.x, gPrevious.y, gPrevious.z);
    std::fflush(gFile);
    gExplosionWritten = true;
}

// Inferred collision impact.  Fires when EITHER a one-sample health drop OR an acceleration spike crosses its
// threshold, and at most once per impact (cooldown plus envelope reset).  `impact` is the peak-hold
// acceleration magnitude in m/s^2; `inferred` is the source token, never a measured surface/material name.
void writeCollisionEvent(const Sample& s, float elapsedSeconds, float accelMagnitude, LONGLONG qpc) {
    if (!gFile || !gHasPrevious) return;
    gImpactEnvelope = std::fmax(accelMagnitude, gImpactEnvelope - kCollisionEnvelopeDecay * elapsedSeconds);
    // OR semantics: return only when NEITHER signal is present.  A `||` here would demand both at once
    // (the defect that swallowed the 486-point health drop because its acceleration was only ~8.9 m/s^2).
    if (gPrevious.health - s.health < kCollisionHealthDrop && gImpactEnvelope < kCollisionAccelSpike) return;
    const double seconds = sessionSeconds(qpc);
    if (seconds - gLastCollisionSeconds < kCollisionCooldownSeconds) return;
    std::fprintf(gFile, "# event,%.6f,collision,inferred,%.6f,%.6f,%.6f,%.6f\n",
        seconds, gImpactEnvelope, s.x, s.y, s.z);
    std::fflush(gFile);
    gLastCollisionSeconds = seconds;
    gImpactEnvelope = 0.0f;
}

const char* surfaceSource(const Sample& s) {
    if (!s.nodesReadable) return "inferred";
    if (s.nodesReadable >= kSurfaceCount) return "real";
    return "partial";
}

void startAudioCapture(const char* csvPath, long long sessionQpc) {
    wchar_t exePath[MAX_PATH]{};
    const DWORD exeChars = GetModuleFileNameW(nullptr, exePath, MAX_PATH);
    if (!exeChars || exeChars >= MAX_PATH) return;
    wchar_t* tail = std::wcsrchr(exePath, L'\\');
    if (!tail || wcscpy_s(tail + 1, MAX_PATH - (tail + 1 - exePath), L"GameAudioCapture.exe")) return;
    if (GetFileAttributesW(exePath) == INVALID_FILE_ATTRIBUTES) {
        debugLog("audio helper missing; CSV will be silent");
        return;
    }
    char wavPath[MAX_PATH]{};
    if (strcpy_s(wavPath, csvPath)) return;
    char* extension = std::strrchr(wavPath, '.');
    if (!extension || strcpy_s(extension, MAX_PATH - (extension - wavPath), ".wav")) return;
    wchar_t wavRelative[MAX_PATH]{};
    wchar_t wavAbsolute[MAX_PATH]{};
    if (!MultiByteToWideChar(CP_ACP, 0, wavPath, -1, wavRelative, MAX_PATH)) return;
    if (!GetFullPathNameW(wavRelative, MAX_PATH, wavAbsolute, nullptr)) return;
    wchar_t stopName[128]{};
    _snwprintf_s(stopName, _TRUNCATE, L"Local\\GTASAFlightAudio_%lu_%d", GetCurrentProcessId(), gSequence);
    gAudioStopEvent = CreateEventW(nullptr, TRUE, FALSE, stopName);
    if (!gAudioStopEvent) return;
    wchar_t command[2 * MAX_PATH + 256]{};
    _snwprintf_s(command, _TRUNCATE, L"\"%s\" --pid %lu --out \"%s\" --session-qpc %lld --stop-event \"%s\"",
        exePath, GetCurrentProcessId(), wavAbsolute, sessionQpc, stopName);
    STARTUPINFOW startup{}; startup.cb = sizeof(startup);
    PROCESS_INFORMATION process{};
    if (!CreateProcessW(exePath, command, nullptr, nullptr, FALSE, CREATE_NO_WINDOW,
        nullptr, nullptr, &startup, &process)) {
        debugLog("audio helper launch failed; CSV will be silent");
        stopAudioCapture();
        return;
    }
    CloseHandle(process.hThread);
    gAudioProcess = process.hProcess;
    debugLog("audio helper launched");
}

void writeRecordingHeader(const Sample& s) {
    char now[32]; timestamp(now, sizeof(now));
    std::fprintf(gFile, "# gtasa_flight_recorder,version=11,sample_hz=25,camera_debug=%d,center_gear_debug=1\n",
        FLIGHT_RECORDER_CAMERA_DEBUG);
    std::fprintf(gFile, "# keyboard_contract: Q/W/E/A/S/D/UP/DOWN/LEFT/RIGHT; Win32 GetAsyncKeyState high bit, sampled at 25 Hz only while game process owns foreground; keyboard_state_valid=0 means unknown, new keys=-1; physical default-key states, not remapped game actions\n");
    std::fprintf(gFile, "# surface_damage_contract: frames=16/17/18/19/20; 2-bit aircraft states, 0=intact,1=damaged,2=detached,3=raw_other; -1=unknown; valid bits 0..4; source=game_memory only after code-signature validation\n");
    std::fprintf(gFile, "# surface_damage_layout=%s; panels_offset=0x5A0+0x14; getter=0x6C2300; caller=0x6CB990\n",
        s.surfaceDamage.layoutVerified ? "verified" : "unsupported");
    std::fprintf(gFile, "# node_columns=rudder,elevator_l,elevator_r,aileron_l,aileron_r,gear_l,gear_r\n");
    std::fprintf(gFile, "# center_gear_columns=misc_a,misc_b; local frame rotation and position; status bits 0,1\n");
    std::fprintf(gFile, "# surface_source: real=read from CPlane node frames, partial=some nodes, inferred=not available (keys only)\n");
    std::fprintf(gFile, "# inferred_signal_contract: transmission_gear_inferred=speed/throttle heuristic [0,6]; engine_load_inferred=clamp(max(abs(throttle),abs(brake)),0,1); both source columns must equal inferred; engine rev/RPM is unavailable and is not emitted\n");
    std::fprintf(gFile, "# collision_event=# event,<seconds>,collision,inferred,<impact_m_s2>,<x>,<y>,<z>; derived from a health drop OR an acceleration spike; surface token is always inferred, never a measured material/contact\n");
    std::fprintf(gFile, "# timebase=capture_elapsed_s uses the same QPC origin as the WAV audio\n");
#if FLIGHT_RECORDER_CAMERA_DEBUG
    std::fprintf(gFile, "# camera_debug: active CCam and final CCamera matrix, sampled with aircraft; temporary reference data\n");
#endif
    std::fprintf(gFile, "# session_start,%s,reason=vehicle_entered,model=%d\n", now, s.model);
    std::fprintf(gFile, "local_timestamp,model,health,x,y,z,heading_deg,right_x,right_y,right_z,up_x,up_y,up_z,forward_x,forward_y,forward_z,vx,vy,vz,ax,ay,az,steer,throttle,brake,color_primary,color_secondary,color_tertiary,color_quaternary,landing_gear_status,key_q,key_a,key_e,key_d,key_up,key_down,game_hour,game_minute,game_second,weather_new,weather_old,weather_forced,node_status,surface_source,rudder_qx,rudder_qy,rudder_qz,rudder_qw,elevator_l_qx,elevator_l_qy,elevator_l_qz,elevator_l_qw,elevator_r_qx,elevator_r_qy,elevator_r_qz,elevator_r_qw,aileron_l_qx,aileron_l_qy,aileron_l_qz,aileron_l_qw,aileron_r_qx,aileron_r_qy,aileron_r_qz,aileron_r_qw,gear_l_qx,gear_l_qy,gear_l_qz,gear_l_qw,gear_r_qx,gear_r_qy,gear_r_qz,gear_r_qw");
#if FLIGHT_RECORDER_CAMERA_DEBUG
    std::fprintf(gFile, ",camera_valid,camera_matrix_valid,camera_active,camera_mode,camera_zoom,camera_zoom_smoothed,camera_alpha,camera_beta,camera_fov,camera_source_x,camera_source_y,camera_source_z,camera_front_x,camera_front_y,camera_front_z,camera_up_x,camera_up_y,camera_up_z,camera_matrix_x,camera_matrix_y,camera_matrix_z,camera_matrix_right_x,camera_matrix_right_y,camera_matrix_right_z,camera_matrix_forward_x,camera_matrix_forward_y,camera_matrix_forward_z,camera_matrix_up_x,camera_matrix_up_y,camera_matrix_up_z");
#endif
    std::fprintf(gFile, ",center_gear_status,misc_a_qx,misc_a_qy,misc_a_qz,misc_a_qw,misc_a_x,misc_a_y,misc_a_z,misc_b_qx,misc_b_qy,misc_b_qz,misc_b_qw,misc_b_x,misc_b_y,misc_b_z");
    std::fprintf(gFile, ",nozzle_rotation,nozzle_rotation_previous,prop_node_status,prop_12_qx,prop_12_qy,prop_12_qz,prop_12_qw,prop_13_qx,prop_13_qy,prop_13_qz,prop_13_qw,prop_14_qx,prop_14_qy,prop_14_qz,prop_14_qw,prop_15_qx,prop_15_qy,prop_15_qz,prop_15_qw,smoke_active,capture_elapsed_s,transmission_gear_inferred,transmission_gear_source,engine_load_inferred,engine_load_source");
    std::fprintf(gFile, ",surface_damage_valid,surface_damage_source,plane_damage_raw,rudder_damage,elevator_l_damage,elevator_r_damage,aileron_l_damage,aileron_r_damage");
    std::fprintf(gFile, ",key_w,key_s,key_left,key_right,keyboard_state_valid\n");
}

void startSession(const Sample& s, LONGLONG sessionQpc) {
    CreateDirectoryA("flight_recordings", nullptr);
    SYSTEMTIME t{}; GetLocalTime(&t);
    char path[MAX_PATH];
    _snprintf_s(path, sizeof(path), _TRUNCATE,
        "flight_recordings\\flight_%04u%02u%02u_%02u%02u%02u_%03u_m%d_%03d.csv",
        t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond, t.wMilliseconds, s.model, ++gSequence);
    gFile = std::fopen(path, "wb");
    if (!gFile) return;
    writeRecordingHeader(s);
    debugLog(s.surfaceDamage.layoutVerified ? "surface damage layout verified" : "surface damage layout unsupported; recording unknown");
    gVehicle = s.vehicle;
    gSessionQpc = sessionQpc;
    LARGE_INTEGER frequency{};
    if (QueryPerformanceFrequency(&frequency)) gQpcFrequency = frequency.QuadPart;
    gExplosionWritten = false;
    gImpactEnvelope = 0.0f; gLastCollisionSeconds = -1.0e9;
    startAudioCapture(path, sessionQpc);
}

void writeQuat(const float q[4], int readable, char* out, size_t size) {
    if (!readable) { _snprintf_s(out, size, _TRUNCATE, "nan,nan,nan,nan"); return; }
    _snprintf_s(out, size, _TRUNCATE, "%.6f,%.6f,%.6f,%.6f", q[0], q[1], q[2], q[3]);
}

void writeSample(const Sample& s, std::chrono::steady_clock::time_point sampleTime, LONGLONG sampleQpc) {
    if (!gFile) return;
    float ax = 0.0f, ay = 0.0f, az = 0.0f;
    float elapsedSeconds = 0.0f;
    if (gHasPrevious) {
        elapsedSeconds = std::chrono::duration<float>(sampleTime - gPreviousSampleTime).count();
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
#if FLIGHT_RECORDER_CAMERA_DEBUG
    const CameraDebug& c = s.camera;
    std::fprintf(gFile, ",%d,%d,%d,%d,%u,%.6f,%.6f,%.6f,%.6f"
        ",%.6f,%.6f,%.6f,%.6f,%.6f,%.6f,%.6f,%.6f,%.6f"
        ",%.6f,%.6f,%.6f,%.6f,%.6f,%.6f,%.6f,%.6f,%.6f,%.6f,%.6f,%.6f",
        c.valid, c.matrixValid, c.active, c.mode, c.zoom, c.zoomSmoothed, c.alpha, c.beta, c.fov,
        c.source.x, c.source.y, c.source.z, c.front.x, c.front.y, c.front.z, c.up.x, c.up.y, c.up.z,
        c.finalMatrix.position.x, c.finalMatrix.position.y, c.finalMatrix.position.z,
        c.finalMatrix.right.x, c.finalMatrix.right.y, c.finalMatrix.right.z,
        c.finalMatrix.forward.x, c.finalMatrix.forward.y, c.finalMatrix.forward.z,
        c.finalMatrix.up.x, c.finalMatrix.up.y, c.finalMatrix.up.z);
#endif
    std::fprintf(gFile, ",%u", s.centerGearStatus);
    for (int i = 0; i < kCenterGearCount; i++) {
        const bool valid = ((s.centerGearStatus >> i) & 1u) != 0;
        char buffer[96];
        writeQuat(s.centerGearQuat[i], valid, buffer, sizeof(buffer));
        std::fprintf(gFile, ",%s", buffer);
        if (valid) {
            const Vec3& p = s.centerGearPosition[i];
            std::fprintf(gFile, ",%.6f,%.6f,%.6f", p.x, p.y, p.z);
        } else {
            std::fprintf(gFile, ",nan,nan,nan");
        }
    }
    std::fprintf(gFile, ",%d,%d", s.nozzleRotation, s.nozzleRotationPrevious);
    std::fprintf(gFile, ",%u", s.propNodeStatus);
    for (int i = 0; i < kPropNodeCount; i++) {
        char buffer[96];
        writeQuat(s.propNodeQuat[i], (s.propNodeStatus >> i) & 1u, buffer, sizeof(buffer));
        std::fprintf(gFile, ",%s", buffer);
    }
    std::fprintf(gFile, ",%d,%.6f,%d,inferred,%.6f,inferred", s.smokeActive, sessionSeconds(sampleQpc),
        s.transmissionGearInferred, s.engineLoadInferred);
    const auto& damage = s.surfaceDamage;
    std::fprintf(gFile, ",%u,%s", damage.valid, damage.valid ? "game_memory" : "unknown");
    if (damage.valid) std::fprintf(gFile, ",%u", damage.raw);
    else std::fprintf(gFile, ",-1");
    for (int i = 0; i < kSurfaceCount; ++i) std::fprintf(gFile, ",%d", damage.states[i]);
    std::fprintf(gFile, ",%d,%d,%d,%d,%d\n", s.w, s.keyS, s.left, s.right, s.keyboardStateValid);
    std::fflush(gFile);
    writeCollisionEvent(s, elapsedSeconds, std::sqrt(ax * ax + ay * ay + az * az), sampleQpc);
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

#if FLIGHT_RECORDER_CAMERA_DEBUG
bool finiteVec(const Vec3& v) {
    return std::isfinite(v.x) && std::isfinite(v.y) && std::isfinite(v.z);
}

float vecLength(const Vec3& v) {
    return std::sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

void readCameraDebug(Sample& s) {
    CameraDebug& c = s.camera;
    const void* camera = reinterpret_cast<const void*>(kTheCamera);
    unsigned char active = 0xff;
    if (!readAt(camera, kCamActive, active) || active >= 3) return;
    c.active = active;
    const void* cam = reinterpret_cast<const void*>(kTheCamera + kCamArray + active * kCamSize);
    uint16_t mode = 0;
    if (readAt(cam, kCamMode, mode)
        && readAt(cam, kCamAlpha, c.alpha)
        && readAt(cam, kCamBeta, c.beta)
        && readAt(cam, kCamFov, c.fov)
        && readAt(cam, kCamSource, c.source)
        && readAt(cam, kCamFront, c.front)
        && readAt(cam, kCamUp, c.up)
        && std::isfinite(c.alpha) && std::isfinite(c.beta)
        && c.fov >= 10.0f && c.fov <= 160.0f
        && finiteVec(c.source) && finiteVec(c.front) && finiteVec(c.up)
        && vecLength(c.front) > 0.5f && vecLength(c.front) < 1.5f
        && vecLength(c.up) > 0.5f && vecLength(c.up) < 1.5f) {
        c.mode = mode;
        c.valid = 1;
    }
    readAt(camera, kCamZoom, c.zoom);
    readAt(camera, kCamZoomSmoothed, c.zoomSmoothed);
    if (readAt(camera, kCameraMatrix, c.finalMatrix)
        && finiteVec(c.finalMatrix.position)
        && finiteVec(c.finalMatrix.right)
        && finiteVec(c.finalMatrix.forward)
        && finiteVec(c.finalMatrix.up)
        && vecLength(c.finalMatrix.right) > 0.5f
        && vecLength(c.finalMatrix.forward) > 0.5f
        && vecLength(c.finalMatrix.up) > 0.5f) {
        c.matrixValid = 1;
    }
}
#endif

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
            captureKeyboard(s, gameHasKeyboardFocus(), keyDown), true);
    if (!captured) return false;
    captureSurfaceDamage(s, surfaceDamageLayoutVerified());
    const float speedMagnitude = std::sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz);
    const float driveInput = std::fmin(1.0f, std::fabs(s.throttle));
    if (speedMagnitude < 0.01f && driveInput < 0.05f) s.transmissionGearInferred = 0;
    else if (speedMagnitude < 0.08f) s.transmissionGearInferred = 1;
    else if (speedMagnitude < 0.16f) s.transmissionGearInferred = 2;
    else if (speedMagnitude < 0.24f) s.transmissionGearInferred = 3;
    else if (speedMagnitude < 0.34f) s.transmissionGearInferred = 4;
    else if (speedMagnitude < 0.46f) s.transmissionGearInferred = 5;
    else s.transmissionGearInferred = 6;
    s.engineLoadInferred = std::fmin(1.0f, std::fmax(std::fabs(s.throttle), std::fabs(s.brake)));
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
    s.centerGearStatus = 0;
    s.nozzleRotation = -1;
    s.nozzleRotationPrevious = -1;
    s.propNodeStatus = 0;
    s.smokeActive = -1;
    if (s.model == 520) {
        for (int i = 0; i < kCenterGearCount; i++) {
            if (readNodePose(vehicle, kCenterGearNodes[i], s.centerGearQuat[i], s.centerGearPosition[i])) {
                s.centerGearStatus |= (1u << i);
            }
        }
        int16_t nozzle = 0, nozzlePrevious = 0;
        if (readAt(vehicle, kPlaneNozzleRotation, nozzle)) s.nozzleRotation = nozzle;
        if (readAt(vehicle, kPlaneNozzleRotationPrevious, nozzlePrevious)) s.nozzleRotationPrevious = nozzlePrevious;
        for (int i = 0; i < kPropNodeCount; i++) {
            if (readNodeQuat(vehicle, kPropNodes[i], s.propNodeQuat[i])) s.propNodeStatus |= (1u << i);
        }
    }
    void* smoke = nullptr;
    bool smokeEjector = false;
    const bool hasSmokePointer = readAt(vehicle, kPlaneSmokeParticle, smoke);
    const bool hasSmokeEjector = readAt(vehicle, kPlaneSmokeEjector, smokeEjector);
    if (hasSmokePointer || hasSmokeEjector) s.smokeActive = (smoke != nullptr || smokeEjector) ? 1 : 0;
    readGameClock(s);
    readWeather(s);
#if FLIGHT_RECORDER_CAMERA_DEBUG
    readCameraDebug(s);
#endif
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
    LARGE_INTEGER sampleQpc{};
    QueryPerformanceCounter(&sampleQpc);
    Sample s{};
    if (!captureSample(s)) {
        if (gCaptureState != 0) debugLog("diagnostic: no readable player vehicle");
        gCaptureState = 0;
        writeExplosionEvent(sampleQpc.QuadPart);
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
    if (!gFile) {
        startSession(s, sampleQpc.QuadPart);
    }
    if (gFile && !gHasPrevious) debugLog("vehicle detected; CSV session opened");
    writeSample(s, now, sampleQpc.QuadPart);
    writeExplosionEvent(sampleQpc.QuadPart);
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
