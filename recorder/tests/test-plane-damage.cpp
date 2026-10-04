// Exercises the actual recorder capture/header/writer without loading or modifying GTA.
#include "../src/FlightRecorderASI.cpp"
#include <cassert>
#include <fstream>
#include <string>
#include <vector>
#include <algorithm>

static_assert(sizeof(void*) == 4, "recorder tests must run as i386");

std::vector<std::string> split(const std::string& text) {
    std::vector<std::string> out;
    size_t begin = 0;
    for (;;) {
        const size_t end = text.find(',', begin);
        out.push_back(text.substr(begin, end - begin));
        if (end == std::string::npos) return out;
        begin = end + 1;
    }
}

int main(int argc, char** argv) {
    assert(argc == 3); // local EXE (read-only), generated fixture CSV
    std::ifstream input(argv[1], std::ios::binary);
    const std::vector<unsigned char> exe((std::istreambuf_iterator<char>(input)), {});
    assert(exe.size() > 0x1000);
    const auto u16 = [&](size_t p) { uint16_t v; std::memcpy(&v, exe.data()+p, 2); return v; };
    const auto u32 = [&](size_t p) { uint32_t v; std::memcpy(&v, exe.data()+p, 4); return v; };
    const size_t pe = u32(0x3C), sections = pe + 24 + u16(pe+20);
    const auto match = [&](uintptr_t va, const unsigned char* expected, size_t count) {
        const uint32_t rva = static_cast<uint32_t>(va) - u32(pe+24+28);
        for (int i = 0; i < u16(pe+6); ++i) {
            const size_t s = sections + 40*i;
            if (rva >= u32(s+12) && rva-u32(s+12)+count <= u32(s+16)) {
                const size_t p = u32(s+20) + rva-u32(s+12);
                return p+count <= exe.size() && std::memcmp(exe.data()+p, expected, count) == 0;
            }
        }
        return false;
    };
    assert(plane_damage::verifiedLayout(match));
    assert(!plane_damage::verifiedLayout([&](uintptr_t va, const unsigned char* code, size_t n) {
        return va != 0x6CB990 && match(va, code, n);
    }));
    assert(!surfaceDamageLayoutVerified()); // our test process is not the game
    auto* vehicle = static_cast<unsigned char*>(VirtualAlloc(nullptr, 4096, MEM_RESERVE|MEM_COMMIT, PAGE_READWRITE));
    assert(vehicle);
    Sample s{}; s.vehicle = vehicle;
    for (unsigned mask = 0; mask < 4; ++mask) {
        int calls = 0;
        captureKeyboard(s, true, [&](int key) {
            ++calls; assert(key == 'W' || key == 'S');
            return (mask & (key == 'W' ? 1u : 2u)) != 0;
        });
        assert(calls == 2 && s.w == (mask&1) && s.keyS == ((mask>>1)&1) && s.keyboardStateValid == 1);
    }
    captureKeyboard(s, false, [](int) { assert(false); return true; });
    assert(s.keyboardStateValid == 0 && s.w == -1 && s.keyS == -1);
    for (const int model : {520, 476}) {
        s.model = model;
        for (uint32_t combo = 0; combo < 1024; ++combo) {
            const uint32_t panels = (combo << 8) | 0xFF | 0xFFFC0000;
            std::memcpy(vehicle+plane_damage::kPanelsOffset, &panels, 4);
            captureSurfaceDamage(s, true);
            assert(s.surfaceDamage.valid == 31 && s.surfaceDamage.raw == panels);
            for (int i = 0; i < 5; ++i) assert(s.surfaceDamage.states[i] == static_cast<int>((combo >> (2*i)) & 3));
        }
    }
    captureSurfaceDamage(s, false);
    assert(s.surfaceDamage.valid == 0);
    for (int state : s.surfaceDamage.states) assert(state == -1);
    s.model = 400; captureSurfaceDamage(s, true); assert(s.surfaceDamage.valid == 0);
    s.model = 520; DWORD old;
    assert(VirtualProtect(vehicle, 4096, PAGE_NOACCESS, &old));
    captureSurfaceDamage(s, true); assert(s.surfaceDamage.valid == 0);
    assert(VirtualProtect(vehicle, 4096, old, &old));

    // Produce a real writer fixture with a damage transition and then unknown.
    gFile = std::fopen(argv[2], "wb"); assert(gFile);
    s.x = 123.25f; s.y = -456.5f; s.z = 78.75f; s.health = 1000;
    s.right_x = s.up_z = s.forward_y = 1;
    s.vx = 0.12f; s.vy = -0.25f; s.vz = 0.05f;
    s.throttle = 0.75f; s.brake = 0.25f; s.transmissionGearInferred = 4;
    s.color_primary = 3; s.color_secondary = 4;
    s.landing_gear_status = 0.5f; s.game_hour = 12; s.game_minute = 34; s.game_second = 56;
    s.weather_new = 10; s.weather_old = 1; s.weather_forced = -1;
    s.nodeStatus = 127; s.nodesReadable = 7;
    for (auto& q : s.nodeQuat) q[3] = 1;
    s.centerGearStatus = 1; s.centerGearQuat[0][3] = 1;
    s.propNodeStatus = 1; s.propNodeQuat[0][3] = 1; s.nozzleRotation = 1234; s.smokeActive = 1;
    uint32_t panels = (1u<<8) | (2u<<10) | (3u<<12) | (1u<<16);
    std::memcpy(vehicle+plane_damage::kPanelsOffset, &panels, 4);
    captureSurfaceDamage(s, true); writeRecordingHeader(s);
    gSessionQpc = 100; gQpcFrequency = 1000;
    const auto now = std::chrono::steady_clock::now();
    captureKeyboard(s, true, [](int key) { return key == 'W' || key == 'Q' || key == VK_LEFT; });
    writeSample(s, now, 100);
    panels = (2u<<8) | (1u<<10) | (2u<<14);
    std::memcpy(vehicle+plane_damage::kPanelsOffset, &panels, 4);
    captureKeyboard(s, true, [](int key) { return key == 'S' || key == 'E' || key == VK_RIGHT; });
    captureSurfaceDamage(s, true); writeSample(s, now+std::chrono::milliseconds(40), 140);
    captureKeyboard(s, false, [](int) { assert(false); return false; });
    captureSurfaceDamage(s, false); writeSample(s, now+std::chrono::milliseconds(80), 180);
    // Acceleration is no longer a CSV column, but collision audio still needs its event.
    writeCollisionEvent(s, 0.04f, 31.0f, 220);
    const uint32_t explosionTime = 123;
    std::memcpy(vehicle+kVehicleTimeWhenBlowedUp, &explosionTime, sizeof(explosionTime));
    gVehicle = vehicle; writeExplosionEvent(230); assert(gExplosionWritten);
    std::fclose(gFile); gFile = nullptr;
    std::ifstream csv(argv[2]); std::string line; std::vector<std::string> header;
    int rows = 0;
    while (std::getline(csv, line)) {
        if (line.empty() || line[0] == '#') continue;
        const auto cells = split(line);
        assert(cells.size() == 101);
        if (header.empty()) {
            header = cells;
            assert(header[93] == "rudder_damage" && header[98] == "key_w" && header[100] == "keyboard_state_valid");
            for (const auto& name : header) assert(name != "key_q" && name != "key_e" && name != "key_a" && name != "key_d" && name != "key_up" && name != "key_down" && name != "key_left" && name != "key_right");
            for (const auto* unused : {"ax", "ay", "az", "steer", "center_gear_status", "misc_a_x", "misc_a_y", "misc_a_z", "misc_b_x", "misc_b_y", "misc_b_z", "nozzle_rotation_previous", "prop_node_status", "transmission_gear_source", "engine_load_inferred", "engine_load_source"}) {
                assert(std::find(header.begin(), header.end(), unused) == header.end());
            }
            continue;
        }
        const auto get = [&](const char* key) -> const std::string& {
            const auto found = std::find(header.begin(), header.end(), key);
            assert(found != header.end()); return cells[found-header.begin()];
        };
        assert(get("x") == "123.250000" && get("throttle") == "0.750000" && get("brake") == "0.250000");
        assert(get("color_primary") == "3" && get("landing_gear_status") == "0.500000");
        assert(get("game_second") == "56" && get("surface_source") == "real");
        assert(get("misc_a_qw") == "1.000000" && get("misc_b_qw") == "nan");
        assert(get("nozzle_rotation") == "1234" && get("prop_12_qw") == "1.000000" && get("prop_13_qw") == "nan");
        assert(get("smoke_active") == "1" && get("transmission_gear_inferred") == "4");
        ++rows;
        if (rows == 1) { assert(cells[90] == "31" && cells[91] == "game_memory"); assert(cells[93] == "1" && cells[95] == "3"); }
        if (rows == 3) { assert(cells[90] == "0" && cells[91] == "unknown"); for (int i=92;i<98;++i) assert(cells[i] == "-1"); }
        if (rows == 1) { assert(cells[98] == "1" && cells[99] == "0" && cells[100] == "1"); }
        if (rows == 2) { assert(cells[98] == "0" && cells[99] == "1" && cells[100] == "1"); }
        if (rows == 3) { assert(cells[98] == "-1" && cells[99] == "-1" && cells[100] == "0"); }
    }
    assert(rows == 3);
    csv.clear(); csv.seekg(0);
    const std::string written((std::istreambuf_iterator<char>(csv)), {});
    assert(written.find("version=13,") != std::string::npos && written.find("audio_capture=0") != std::string::npos);
    assert(written.find("# event,0.120000,collision,inferred,31.000000,") != std::string::npos);
    assert(written.find("# event,0.130000,explosion,") != std::string::npos);
    VirtualFree(vehicle, 0, MEM_RELEASE);
    std::puts("PASS: local EXE signatures, damage all 1024 combinations, W/S/focus, actual v13 writer (101 columns), retained replay data and removed unused columns");
}
