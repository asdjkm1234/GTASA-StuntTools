// Exercises the actual recorder capture/header/writer without loading or modifying GTA.
#include "../src/FlightRecorderASI.cpp"
#include <cassert>
#include <fstream>
#include <string>
#include <vector>

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
    const int keyCodes[] = {'Q','W','E','A','S','D',VK_UP,VK_DOWN,VK_LEFT,VK_RIGHT};
    for (unsigned mask = 0; mask < 1024; ++mask) {
        captureKeyboard(s, true, [&](int key) {
            for (int i=0;i<10;++i) if (key == keyCodes[i]) return (mask & (1u<<i)) != 0;
            assert(false); return false;
        });
        const int states[] = {s.q,s.w,s.e,s.a,s.keyS,s.d,s.up,s.down,s.left,s.right};
        for (int i=0;i<10;++i) assert(states[i] == static_cast<int>((mask>>i)&1));
        assert(s.keyboardStateValid == 1);
    }
    captureKeyboard(s, false, [](int) { assert(false); return true; });
    assert(s.keyboardStateValid == 0 && s.w == -1 && s.keyS == -1 && s.left == -1 && s.right == -1);
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
    std::fclose(gFile); gFile = nullptr;
    std::ifstream csv(argv[2]); std::string line; std::vector<std::string> header;
    int rows = 0;
    while (std::getline(csv, line)) {
        if (line.empty() || line[0] == '#') continue;
        const auto cells = split(line);
        assert(cells.size() == 125);
        if (header.empty()) { header = cells; assert(header[115] == "rudder_damage" && header[120] == "key_w" && header[124] == "keyboard_state_valid"); continue; }
        ++rows;
        if (rows == 1) { assert(cells[112] == "31" && cells[113] == "game_memory"); assert(cells[115] == "1" && cells[117] == "3"); }
        if (rows == 3) { assert(cells[112] == "0" && cells[113] == "unknown"); for (int i=114;i<120;++i) assert(cells[i] == "-1"); }
        if (rows == 1) { assert(cells[120] == "1" && cells[121] == "0" && cells[122] == "1" && cells[123] == "0" && cells[124] == "1"); }
        if (rows == 2) { assert(cells[120] == "0" && cells[121] == "1" && cells[122] == "0" && cells[123] == "1" && cells[124] == "1"); }
        if (rows == 3) { for (int i=120;i<124;++i) assert(cells[i] == "-1"); assert(cells[124] == "0"); }
    }
    assert(rows == 3);
    VirtualFree(vehicle, 0, MEM_RELEASE);
    std::puts("PASS: local EXE signatures, damage/keys all 1024 combinations, focus fallback, actual v11 header/rows (125 columns)");
}
