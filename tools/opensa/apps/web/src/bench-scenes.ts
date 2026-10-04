import type { BenchScene } from '@opensa/game/perf/bench';

/**
 * Fixed benchmark scenes (plan 063) — deterministic camera paths over the SA map, selected via
 * `?bench=<key>` (or `?bench=all` for the full baseline sweep). Coordinates are native GTA (Z-up), the
 * same space the debug teleports use; `anchor` is where the PLAYER teleports (the streaming ring centre),
 * so every path must stay within streaming range of it. Weather indexes follow `WEATHER_NAMES`.
 */
export const BENCH_SCENES: readonly BenchScene[] = [
  {
    // Downtown Los Santos at noon — the draw-call/triangle worst case (skyline + traffic area).
    anchor: [1456, -1400, 30],
    cars: { radius: 500, spacing: 30 },
    durationS: 15,
    hour: 12,
    key: 'ls-noon',
    path: [
      { look: [1456, -1600, 60], pos: [1250, -1250, 90] },
      { look: [1456, -1600, 60], pos: [1456, -1180, 110] },
      { look: [1456, -1600, 40], pos: [1660, -1250, 90] },
    ],
    weather: 1, // SUNNY_LA
  },
  {
    // San Fierro dawn in fog — the fog/atmosphere calibration scene.
    anchor: [-1980, 550, 40],
    cars: { radius: 500, spacing: 30 },
    durationS: 15,
    hour: 7,
    key: 'sf-fog-dawn',
    path: [
      { look: [-1980, 800, 60], pos: [-2100, 300, 120] },
      { look: [-1980, 800, 40], pos: [-1980, 420, 90] },
      { look: [-2100, 800, 40], pos: [-1860, 300, 120] },
    ],
    weather: 9, // FOGGY_SF
  },
  {
    // Las Venturas strip at midnight — corona/lamp/night-emissive worst case.
    anchor: [2035, 1340, 15],
    cars: { radius: 500, spacing: 30 },
    durationS: 15,
    hour: 0,
    key: 'lv-night',
    path: [
      { look: [2035, 1600, 25], pos: [2035, 1100, 45] },
      { look: [2035, 1800, 25], pos: [2035, 1450, 35] },
      { look: [2200, 1900, 25], pos: [2035, 1700, 45] },
    ],
    weather: 11, // EXTRASUNNY_VEGAS (clear night sky)
  },
  {
    // Countryside dusk near Blueberry — long shadows + vegetation.
    anchor: [230, -60, 5],
    cars: { radius: 500, spacing: 90 },
    durationS: 15,
    hour: 19,
    key: 'country-dusk',
    path: [
      { look: [230, 140, 15], pos: [30, -220, 60] },
      { look: [230, 140, 10], pos: [230, -140, 40] },
      { look: [80, 140, 10], pos: [420, -220, 60] },
    ],
    weather: 4, // CLOUDY_LA
  },
  {
    // Santa Maria beach looking out to open sea — the horizon/fog-cut scene (068's regression view).
    // Anchor ON the sand (an over-water anchor drops the player into the sea and the run never settles).
    anchor: [330, -2790, 5],
    durationS: 15,
    hour: 15,
    key: 'ocean-horizon',
    path: [
      { look: [370, -3400, 5], pos: [370, -2820, 25] },
      { look: [200, -3400, 5], pos: [300, -2830, 35] },
      { look: [50, -3300, 5], pos: [220, -2850, 25] },
    ],
    weather: 5, // SUNNY_SF
  },
  {
    // Downtown LS in rain at night — post-fx + wet-look worst case.
    anchor: [1456, -1400, 30],
    cars: { radius: 500, spacing: 30 },
    durationS: 15,
    hour: 21,
    key: 'ls-rain-night',
    path: [
      { look: [1456, -1600, 60], pos: [1250, -1250, 90] },
      { look: [1456, -1600, 60], pos: [1456, -1180, 110] },
      { look: [1456, -1600, 40], pos: [1660, -1250, 90] },
    ],
    weather: 8, // RAINY_SF
  },
  {
    // Ganton at street level, noon — the FREE-PLAY worst case. Added 2026-07-20 because the field kept
    // reporting ~40 fps here on two cars while every existing bench scene reported 60-120: the other
    // paths fly at 90-120 m, where distance culls the near-field detail a player actually drives through.
    // This one stays at 20-30 m over Grove Street, the ground the user actually plays on.
    anchor: [2374, -1660, 13],
    cars: { radius: 500, spacing: 30 },
    durationS: 15,
    hour: 12,
    key: 'ganton-noon',
    path: [
      { look: [2500, -1700, 15], pos: [2280, -1620, 25] },
      { look: [2500, -1750, 15], pos: [2400, -1680, 22] },
      { look: [2620, -1720, 15], pos: [2520, -1700, 28] },
    ],
    weather: 1, // SUNNY_LA
  },
  {
    // South Strip at street level, noon (the Flamingo/Pirate block). Added 2026-07-29: the 093 field
    // round teleported here (`&spawn=1934,1177`) and hit the heaviest cold-load transient seen so far
    // (~20 frames of 110-170 ms, mostly UNATTRIBUTED, plus the known per-type vehicle hitch) — the
    // casino district's density deserves a standing steady-state row like ganton-noon's, and the
    // teleport transient itself is the queued 091 follow-up.
    // The anchor was authored INSIDE the Flamingo (`flamingo01_lvs` stands at 1932.8, 1177.4): the ground
    // probe answered 13.0 from a surface the capsule cannot rest on, so the player fell out of the world on
    // every run of this scene since it was added — cars and all, because residency is anchored to him.
    // Moved 2026-08-09 onto the standable ground south of the building (`teleport-spot.ts flamingo01_lvs`,
    // ring z 17.6) which is also 50 m closer to the camera path this scene actually flies. Every strip-noon
    // row taken before this date measured a falling player and is not comparable — and the move shifted the
    // road-car region with it, so the sweep now places 1219 cars instead of 1196. An anchor is part of what
    // a row MEASURES, not just where it starts.
    anchor: [1933, 1127, 18],
    cars: { radius: 500, spacing: 30 },
    durationS: 15,
    hour: 12,
    key: 'strip-noon',
    path: [
      { look: [2010, 1300, 25], pos: [1850, 1060, 28] },
      { look: [2010, 1250, 20], pos: [1934, 1140, 22] },
      { look: [2100, 1300, 25], pos: [2010, 1080, 30] },
    ],
    weather: 11, // EXTRASUNNY_VEGAS
  },
  {
    // The same Ganton path at night — isolates the day/night delta on identical geometry, which is what
    // the field reported as the loudest difference. Same weather as the noon row on purpose.
    anchor: [2374, -1660, 13],
    cars: { radius: 500, spacing: 30 },
    durationS: 15,
    hour: 22,
    key: 'ganton-night',
    path: [
      { look: [2500, -1700, 15], pos: [2280, -1620, 25] },
      { look: [2500, -1750, 15], pos: [2400, -1680, 22] },
      { look: [2620, -1720, 15], pos: [2520, -1700, 28] },
    ],
    weather: 1, // SUNNY_LA
  },
];
