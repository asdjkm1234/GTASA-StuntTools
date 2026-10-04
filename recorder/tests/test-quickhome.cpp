// Tests the real ASI's H latch, detector and close/writer boundary. No game is launched.
#include "../src/FlightRecorderASI.cpp"
#include <cassert>
#include <fstream>
#include <string>
#include <vector>
#include <algorithm>

using Clock = std::chrono::steady_clock;
const auto origin = Clock::time_point{} + std::chrono::seconds(10);
const auto next = origin + std::chrono::milliseconds(40);

Sample plane() {
    Sample s{};
    s.vehicle = reinterpret_cast<void*>(0x1234);
    s.model = 520; s.health = 1000;
    s.right_x = s.forward_y = s.up_z = 1;
    s.surfaceDamage.valid = 31;
    for (int& state : s.surfaceDamage.states) state = 0;
    return s;
}

void prepare(bool arm = true) {
    gQuickhomeInput = {};
    gPrevious = plane(); gVehicle = gPrevious.vehicle; gHasPrevious = true;
    gPreviousSampleTime = origin; gHasPositionVelocity = true;
    gPreviousPositionVelocity = {};
    gQuickhomeInput.observe(true, false, true, origin);
    if (arm) gQuickhomeInput.observe(true, true, true, origin);
}

std::vector<std::string> cells(const std::string& s) {
    std::vector<std::string> out;
    size_t begin = 0;
    for (;;) {
        const auto end = s.find(',', begin);
        out.push_back(s.substr(begin, end-begin));
        if (end == std::string::npos) return out;
        begin = end+1;
    }
}

std::string contents(const std::string& path) {
    std::ifstream in(path);
    return {(std::istreambuf_iterator<char>(in)), {}};
}

int main(int argc, char** argv) {
    assert(argc == 1 || argc == 3); // optional original, read-only CSV; output prefix
    static_assert(sizeof(void*) == 4);

    prepare(); assert(gQuickhomeInput.armed(next));
    // A short press and release between two 25 Hz samples is retained.
    gQuickhomeInput.observe(true, false, true, origin+std::chrono::milliseconds(5));
    assert(gQuickhomeInput.armed(next));
    gQuickhomeInput.pending = false;
    gQuickhomeInput.observe(true, true, true, next); assert(gQuickhomeInput.pending);
    gQuickhomeInput.pending = false;
    gQuickhomeInput.observe(true, true, true, next); assert(!gQuickhomeInput.pending);
    gQuickhomeInput.observe(false, false, true, next);
    gQuickhomeInput.observe(true, true, true, next); assert(!gQuickhomeInput.pending);
    gQuickhomeInput.observe(true, false, true, next);
    gQuickhomeInput.observe(true, true, false, next); assert(!gQuickhomeInput.pending);
    prepare(); gQuickhomeInput.observe(false, false, true, next); assert(!gQuickhomeInput.pending);
    prepare(); assert(!gQuickhomeInput.armed(origin+std::chrono::milliseconds(2001)));
    gQuickhomeInput.observe(true, true, true, origin+std::chrono::milliseconds(2001));
    assert(gQuickhomeInput.pending && gQuickhomeInput.due(origin+std::chrono::milliseconds(2001)));

    Sample s = plane();
    prepare(false); s.x = 85.35f; assert(!quickhome(s, next));
    prepare(); assert(quickhome(s, next));
    s = plane(); s.x = 1; assert(quickhome(s, next));
    assert(quickhome(s, origin+std::chrono::milliseconds(1500))); // delayed server reset
    s = plane(); assert(!quickhome(s, next)); // wait for an observable reset first
    s.heading = 180; assert(quickhome(s, next)); // same position
    s = plane(); s.up_z = -1; assert(quickhome(s, next)); // roll, unchanged heading
    s = plane(); s.forward_y = -1; assert(quickhome(s, next)); // pitch
    s = plane(); s.up_z = s.forward_y = 0; assert(!quickhome(s, next)); // unavailable axes
    s = plane(); gPrevious.vy = 1.5f; s.vy = -1.5f; assert(quickhome(s, next));
    prepare(); s = plane(); gPrevious.health = 800; assert(quickhome(s, next));
    prepare(); gPrevious.surfaceDamage.states[4] = 1; assert(quickhome(s, next));
    s.surfaceDamage.valid = 0; assert(!quickhome(s, next)); // unknown is not repaired
    prepare(); s = plane(); s.health = 800; s.surfaceDamage.states[4] = 1;
    assert(!quickhome(s, next)); // damage by itself is not a reset
    prepare(); s = plane(); s.heading = 10; gPrevious.heading = 350;
    assert(!quickhome(s, next)); // wraparound, normal 20-degree yaw
    prepare(); s = plane(); gPreviousPositionVelocity.x = 75; s.x = 3;
    assert(!quickhome(s, next));
    s.x = 6; assert(!quickhome(s, origin+std::chrono::milliseconds(80)));
    s.x = 75; assert(!quickhome(s, origin+std::chrono::seconds(1))); // long frame
    s.x = 4; assert(quickhome(s, next)); // one-metre deviation from normal motion
    prepare(); s = plane(); s.x = 85;
    assert(quickhome(s, origin+std::chrono::milliseconds(2001))); // retained H fallback
    prepare(false); s.x = 119.9f; assert(!quickhome(s, next));
    s.x = 120; assert(quickhome(s, next)); // fallback is unchanged
    s.vehicle = reinterpret_cast<void*>(0x5678); assert(!quickhome(s, next));
    s = plane(); gHasPrevious = false; assert(!quickhome(s, next));

    // Completed lap followed by H: every observed field may remain identical.
    // The real close path must still split exactly once, then retain the H latch.
    prepare(); s = plane();
    const auto deadline = origin+std::chrono::seconds(2);
    assert(!quickhome(s, deadline-std::chrono::milliseconds(1)));
    assert(quickhome(s, deadline));
    gFile = std::tmpfile(); assert(gFile);
    gSessionQpc = 100; gQpcFrequency = 1000;
    assert(closeForQuickhome(s, deadline, 2100));
    assert(!gFile && !gHasPrevious && !gQuickhomeInput.pending && gQuickhomeInput.held);
    gQuickhomeInput.observe(true, true, true, deadline+std::chrono::seconds(10));
    assert(!gQuickhomeInput.pending); // holding cannot cut again
    gVehicle = s.vehicle; gPrevious = s; gHasPrevious = true;
    gPreviousSampleTime = deadline+std::chrono::seconds(10);
    assert(!quickhome(s, deadline+std::chrono::seconds(10)+std::chrono::milliseconds(40)));
    gQuickhomeInput.observe(true, false, true, deadline+std::chrono::seconds(10));
    gQuickhomeInput.observe(true, true, true, deadline+std::chrono::seconds(10));
    assert(gQuickhomeInput.pending); // release, then press requests a new split

    // Pending repeat presses cannot extend the first request forever.
    prepare();
    gQuickhomeInput.observe(true, false, true, origin+std::chrono::seconds(1));
    gQuickhomeInput.observe(true, true, true, origin+std::chrono::seconds(1));
    assert(gQuickhomeInput.deadline == deadline && gQuickhomeInput.due(deadline));
    // A stalled callback beyond the deadline must not discard the request.
    prepare();
    gQuickhomeInput.observe(true, false, true, origin+std::chrono::seconds(4));
    assert(quickhome(s, origin+std::chrono::seconds(4)));
    prepare(false); assert(!quickhome(s, origin+std::chrono::seconds(4)));

    if (argc == 1) {
        std::puts("PASS: H edges/focus/hold, retained same-pose request at deadline, no repeated hold split, short/delayed resets, normal motion/long frames, repair validity, 120 m fallback");
        return 0;
    }

    // Re-run every actual row from the user's failed recording, injecting the
    // confirmed H press immediately before its reset. No original file is edited.
    std::ifstream input(argv[1]); assert(input);
    std::vector<std::string> header; std::string line;
    int splits = 0, rows = 0;
    const std::string beforePath = std::string(argv[2])+"-before.csv";
    const std::string afterPath = std::string(argv[2])+"-after.csv";
    gQuickhomeInput = {}; gHasPrevious = false; gHasPositionVelocity = false;
    gVehicle = plane().vehicle; gSessionQpc = 1000000; gQpcFrequency = 1000000;
    gFile = std::fopen(beforePath.c_str(), "wb"); assert(gFile);
    gExplosionWritten = false; gImpactEnvelope = 0; gLastCollisionSeconds = -1e9;
    bool pressed = false;
    while (std::getline(input, line)) {
        if (line.empty() || line[0] == '#') continue;
        if (header.empty()) { header = cells(line); assert(header.size() == 117); continue; }
        const auto row = cells(line); assert(row.size() == 117);
        const auto get = [&](const char* key) {
            const auto index = std::find(header.begin(), header.end(), key)-header.begin();
            assert(index < static_cast<ptrdiff_t>(row.size())); return std::stod(row[index]);
        };
        Sample recorded = plane();
        recorded.x=get("x"); recorded.y=get("y"); recorded.z=get("z");
        recorded.heading=get("heading_deg"); recorded.health=get("health");
        recorded.vx=get("vx"); recorded.vy=get("vy"); recorded.vz=get("vz");
        recorded.right_x=get("right_x"); recorded.right_y=get("right_y"); recorded.right_z=get("right_z");
        recorded.up_x=get("up_x"); recorded.up_y=get("up_y"); recorded.up_z=get("up_z");
        recorded.forward_x=get("forward_x"); recorded.forward_y=get("forward_y"); recorded.forward_z=get("forward_z");
        recorded.surfaceDamage.valid=get("surface_damage_valid");
        const char* damage[] = {"rudder_damage", "elevator_l_damage", "elevator_r_damage", "aileron_l_damage", "aileron_r_damage"};
        for (int i=0; i<5; ++i) recorded.surfaceDamage.states[i]=get(damage[i]);
        const double seconds = get("capture_elapsed_s");
        const auto time = origin+std::chrono::duration_cast<Clock::duration>(std::chrono::duration<double>(seconds));
        const LONGLONG qpc = 1000000+std::llround(seconds*1000000);
        // Held right across the split: must not re-arm or create a third file.
        if (seconds >= 86.224845) pressed = true;
        gQuickhomeInput.observe(true, pressed, true, time);
        if (closeForQuickhome(recorded, time, qpc)) {
            ++splits;
            assert(std::fabs(seconds-86.266561) < 1e-6);
            assert(!gHasPrevious && !gHasPositionVelocity && !gQuickhomeInput.pending);
            assert(gQuickhomeInput.held);
            gFile=std::fopen(afterPath.c_str(), "wb"); assert(gFile);
            gVehicle=recorded.vehicle; gSessionQpc=qpc; gQpcFrequency=1000000;
            writeRecordingHeader(recorded);
        } else if (rows == 0) writeRecordingHeader(recorded);
        writeSample(recorded, time, qpc);
        ++rows;
    }
    closeSession("game_closed");
    assert(splits == 1 && rows > 2300);
    const auto before = contents(beforePath), after = contents(afterPath);
    assert(before.find("# quickhome_detection,86.266561,key_h_confirmed") != std::string::npos);
    assert(before.find("# session_end,quickhome_teleport_detected,") != std::string::npos);
    assert(before.find("86.224845,") != std::string::npos);
    assert(before.find("# event,86.266561,collision") == std::string::npos);
    assert(after.find(",-1983.543091,-1272.223755,98.502167,") != std::string::npos);
    // The capture clock restarts at zero; internal acceleration cannot emit a teleport impact.
    assert(after.find("# event,0.000000,collision") == std::string::npos);
    std::ifstream output(afterPath); int dataRows = 0;
    while (std::getline(output, line)) {
        if (line.empty() || line[0] == '#' || line.rfind("local_timestamp,", 0)==0) continue;
        const auto first = cells(line); assert(first.size() == 101);
        if (++dataRows == 1) {
            assert(first[88]=="0.000000");
        }
    }
    assert(dataRows > 250);

    // A complete square lap returns to its starting point. With no H it remains
    // one session; after H, identical stationary samples must cut at the deadline.
    const std::string loopBeforePath = std::string(argv[2])+"-loop-before.csv";
    const std::string loopAfterPath = std::string(argv[2])+"-loop-after.csv";
    gQuickhomeInput = {}; gHasPrevious = false; gHasPositionVelocity = false;
    s = plane(); s.z = 40; gVehicle = s.vehicle;
    gSessionQpc = 1000000; gQpcFrequency = 1000000;
    gFile = std::fopen(loopBeforePath.c_str(), "wb"); assert(gFile);
    writeRecordingHeader(s);
    const float lap[][2] = {{0,0},{10,0},{10,10},{0,10},{0,0},{0,0}};
    for (int i=0; i<6; ++i) {
        s.x = lap[i][0]; s.y = lap[i][1];
        const auto time = origin+std::chrono::milliseconds(40*i);
        gQuickhomeInput.observe(true, false, true, time);
        assert(!closeForQuickhome(s, time, 1000000+40000*i));
        writeSample(s, time, 1000000+40000*i);
    }
    const auto lapEnd = origin+std::chrono::milliseconds(200);
    gQuickhomeInput.observe(true, true, true, lapEnd);
    int loopSplits = 0;
    for (int i=1; i<=80; ++i) {
        const auto time = lapEnd+std::chrono::milliseconds(40*i);
        const LONGLONG qpc = 1200000+40000*i;
        gQuickhomeInput.observe(true, true, true, time);
        if (closeForQuickhome(s, time, qpc)) {
            assert(i == 50); ++loopSplits;
            gFile = std::fopen(loopAfterPath.c_str(), "wb"); assert(gFile);
            gVehicle=s.vehicle; gSessionQpc=qpc; gQpcFrequency=1000000;
            writeRecordingHeader(s);
        }
        writeSample(s, time, qpc);
    }
    closeSession("game_closed");
    assert(loopSplits == 1);
    const auto loopBefore=contents(loopBeforePath), loopAfter=contents(loopAfterPath);
    assert(loopBefore.find("# quickhome_detection,2.200000,key_h_requested") != std::string::npos);
    assert(loopBefore.find("# session_end,quickhome_teleport_detected,") != std::string::npos);
    assert(loopBefore.find("\n# event,") == std::string::npos && loopAfter.find("\n# event,") == std::string::npos);
    std::ifstream loopOutput(loopAfterPath);
    while (std::getline(loopOutput, line)) {
        if (line.empty() || line[0] == '#' || line.rfind("local_timestamp,", 0)==0) continue;
        const auto first = cells(line); assert(first.size() == 101);
        assert(first[88] == "0.000000");
        break;
    }
    std::puts("PASS: real writer complete lap + same-pose H -> one timeout split, held H creates no extra file, unconfirmed request metadata, zero-clock next segment");
    std::printf("PASS: H edges/focus/hold, retained same-pose request at deadline, short/delayed resets, normal motion/long frames, repair validity, 120 m fallback; %d actual rows -> exactly two fixtures at 86.266561, no false teleport collision\n", rows);
}
