import type { Vec3 } from '@opensa/game';
import type { AssetLoaderKind } from '@opensa/loaders';
/**
 * Runtime game catalogue (plan 056). Each key is a game the menu can launch; the value is its full
 * configuration — replaces the old single-game `.env` setup. Data-only, except `disclaimer` which is JSX
 * (hence `.tsx`). The selected game drives the loader, the manifest URL, and the world/player setup.
 */
import type { ReactNode } from 'react';

import { IS_DEV } from './dev-mode';
import { selectGameIds } from './game-config.select';

/** Everything needed to launch and run one game. */
export interface GameConfig {
  /** Loader: `fetch` (download chunk archives) or `local` (read a user-picked raw install). */
  assetLoader: AssetLoaderKind;
  /** Dev-only: dropped from production builds (kept under `npm run dev`). Used for `fetch` demos that would
   *  otherwise distribute mod content from the CDN — see {@link GAME_IDS}. */
  devOnly?: boolean;
  /** Greyed out in the menu when true. */
  disable?: boolean;
  /** Why the game is disabled (shown under it in the menu). */
  disabledNote?: string;
  /** Shown in a popup before launch (fetch: with an OK button; local: inside the folder prompt). */
  disclaimer: ReactNode;
  /** Far draw distance (m) — the LOD streaming ring + fog cap, ONE knob (074/21). `?draw=` overrides.
   *  SA's continuous city reads fine at 1200; an island TC needs the next island inside the ring. */
  drawDistance: number;
  /** Menu button text. */
  label: string;
  /** Initial collision-zone radius / clock (minutes since midnight) / weather (a `WEATHER_NAMES` entry). */
  loadGame: { radius: number; startMinutes: number; weather: string };
  /** Player ped model name (resolved via `peds.ide`). */
  mainCharacter: string;
  /** Player collision-box half-extents (Z-up); defaults to the human box. */
  playerHalfExtents?: Vec3;
  /** Single source for where the player starts: seeds the capsule AND the initial collision zone. */
  playerSpawn: Vec3;
  /** Debug "Position" teleport list ([] / omitted → no Position tab). */
  teleports?: Teleport[];
}

/** A debug "Position" teleport target (native GTA Z-up world coords). */
export interface Teleport {
  coords: Vec3;
  label: string;
}

const SA_TELEPORTS: readonly Teleport[] = [
  { coords: [2495, -1675, 16], label: 'LS - Ganton' },
  { coords: [1481.0, -1744.0, 13.5], label: 'LS - Downtown' },
  { coords: [2860.28, -1887.01, 10.86], label: 'LS - Long Beach' },
  { coords: [342.0, -1803.0, 4.8], label: 'LS - Santa Maria Beach' },
  { coords: [2020.0, 1007.0, 10.86], label: 'LV - City Center' },
  { coords: [2031.09, 1539.7, 10.74], label: 'LV - Pirate' },
  { coords: [2019.8, 1007.7, 10.86], label: 'LV - Four Dragons' },
  { coords: [1697.0, 1447.0, 10.86], label: 'LV - Airport' },
  { coords: [-1905.0, 277.0, 41.0], label: 'SF - Doherty' },
  { coords: [-1988.0, 138.0, 27.5], label: 'SF - City Center' },
  { coords: [-1420.0, -287.0, 14.1], label: 'SF - Airport' },
  { coords: [-1045.0, -1620.0, 76.4], label: "Country - Truth's Farm" },
  { coords: [-1696.8, -748.0, 100.0], label: 'Country - Flint Hills' },
  { coords: [1139.0, -1490.0, 18.5], label: 'LS - Escalators' },
  // Animated map objects (074/08 B7·b): the Burger Shot's sign SPINS — and the diner itself is the building
  // that once vanished when anim defs were skipped wholesale ("the blue hole", plan 041).
  { coords: [815.0, -1613.0, 20.0], label: 'LS - Burger Shot (spinning sign)' },
  { coords: [-1494.0, 1941.0, 58.0], label: 'Country - Windmill' },
  // UV-scroll animation (074/18 B7·c): the actual placed scrollers (found by scanning the map for models whose
  // DFF carries a UVAnimDict — the plan's skull sign `visagesign04` turned out to have ZERO world placements).
  { coords: [2370.1, 2164.7, 12.8], label: 'LV - Scrolling sign (UV-scroll)' },
  { coords: [2088.0, 1901.5, 13.5], label: 'LV - Vegas waterfall (UV-scroll)' },
  { coords: [2105.5, 1916.3, 14.9], label: 'LV - Mirage sign (UV-scroll)' },
  // Procedural clutter (074/19-20): a DENSE field of breakable cacti (sjmcacti2, ~5.3 m tall — unmissable,
  // unlike the ~1 m rocks a car drives over) in Bone County desert (cell 0,9, ~150 of them at z 15.3). Spawn is
  // just west of the field; the Admiral (6 m east) faces a wall of cacti — drive in to smash them.
  { coords: [5.0, 2415.0, 17.0], label: 'Desert - Breakable cacti' },
  // Animated radars (085 row G): the two LS airport ap_radar1_01 towers @ (1663.6|1709.4, -2362.7) — the
  // spinning dish is an anim object; a `[anim-objects] ap_radar1_01 failed to build` console warn names the root.
  { coords: [1686.0, -2380.0, 14.0], label: 'LS - Airport radars (anim 085 G)' },
  // Normals batch (map-optimizer plans 020-022) field-check spots: a road junction for the angle weighting,
  // the doubled curved shells for the twin-quad smoothing.
  { coords: [2493.0, -1667.0, 16.0], label: 'LS - Ganton junction (normals 021)' },
  { coords: [-1348.0, -15.0, 12.0], label: 'SF - Airport car park ramp (normals 022)' },
  { coords: [2165.0, 1275.0, 12.0], label: 'LV - Sphinx (normals 022)' },
  // Alpha-class controls (plan 092 — a texture that is an alpha MASK now draws in the depth-writing cutout
  // pass instead of the blend pass). Both spots were picked from the census + the built map, not by eye:
  //   GLASS, the class that must NOT move: a bus shelter's panes are `cj_frame_glass`, and **91 % of its
  //   texels sit BELOW the alpha test** with nothing above it — a one-sided film, soft-blend by the rule.
  //   Alpha-testing it would erase almost the whole pane, so "the shelter still has glass" is the check.
  //   Pick a shelter, not a facade: SA's airport/office windows are painted onto OPAQUE textures (the LV
  //   terminal's `marinawindow1_256` has no alpha channel at all) and cannot exercise the rule.
  { coords: [-2284.0, 557.3, 34.7], label: 'SF - Bus stop glass (alpha class 092)' },
  //   CANOPIES, the class the vegetation rule already sharpens: the densest cluster of hi-poly MOD canopies
  //   in the built map — 45 within 60 m, 18 of them `veg_palm04` (105× the triangles of the stock model),
  //   plus sm_bevhiltree/sm_veg_tree4/6. Look for the 2026-07-13 symptom: a uniform screen-door stipple over
  //   a crown, worst at range. Local ground z 51.1–52.3.
  { coords: [235.5, -1380.3, 53.0], label: 'LS - Verdant hillside canopies (alpha class 092)' },
];

/** A launchable game id. */
export type GameId = 'carcer' | 'gostown' | 'original';

export const GAME_CONFIG: Record<GameId, GameConfig> = {
  carcer: {
    assetLoader: 'local',
    devOnly: true,
    disclaimer: null,
    // Islands: the far side of the 5.2×4.5 km archipelago must sit inside the LOD ring (field, 2026-07-23).
    drawDistance: 1500,
    label: 'Run Carcer City [local]',
    loadGame: { radius: 400, startMinutes: 720, weather: 'EXTRASUNNY_SMOG_LA' },
    // The ped installed from mods-src/gostown/peds (peds.ide 144) — the TC ships no BMYPOL1/male01 model.
    mainCharacter: 'bmycg',
    playerSpawn: [168.6, 728.0, 150.605202],
    teleports: [{ coords: [1531.15, -1271.89, 581.74], label: 'Downtown' }],
  },
  gostown: {
    assetLoader: 'fetch',
    disable: false,
    disabledNote: 'Demo is temporarily unavailable',
    disclaimer: (
      <>
        <p>
          <strong>GosTown Paradise</strong> is a free, non-commercial community total-conversion mod, served here for a
          technical demo. Not affiliated with Rockstar Games or Take-Two.
        </p>
        <p>Game data is downloaded and cached in your browser (Cache Storage); analytics only count visitors.</p>
        <div className="sa-credits">
          <p className="sa-credits__title">The mod</p>
          <ul>
            <li>
              <a
                href="https://www.mixmods.com.br/2021/04/gostown-paradise-repack-modloader/"
                rel="noreferrer"
                target="_blank"
              >
                MixMods — Gostown Paradise repack (modloader)
              </a>
            </li>
            <li>
              <a href="https://www.moddb.com/mods/gostown-paradise-v6" rel="noreferrer" target="_blank">
                ModDB — Gostown Paradise v6
              </a>
            </li>
          </ul>
          <p className="sa-credits__title">Special thanks</p>
          <ul>
            <li>
              <strong>mad_driver</strong> — vehicles for the demo
            </li>
            <li>
              <strong>Artur$MD</strong> — player model author
            </li>
          </ul>
        </div>
      </>
    ),
    // Islands: the far side of the 5.2×4.5 km archipelago must sit inside the LOD ring (field, 2026-07-23).
    drawDistance: 1500,
    label: 'Run Gostown Paradise [web]',
    loadGame: { radius: 400, startMinutes: 720, weather: 'EXTRASUNNY_SMOG_LA' },
    // The ped installed from mods-src/gostown/peds (peds.ide 144) — the TC ships no BMYPOL1/male01 model.
    mainCharacter: 'bmycg',
    playerSpawn: [1531.15, -1271.89, 591.74],
    teleports: [{ coords: [1531.15, -1271.89, 581.74], label: 'Downtown' }],
  },
  original: {
    assetLoader: 'local',
    devOnly: true,
    disclaimer: (
      <>
        <p>
          <strong>GTA: San Andreas</strong> assets can&rsquo;t be shipped — play from your own legitimate copy. Select
          your installed game folder; nothing is uploaded, files are read locally in your browser.
        </p>
        <p>Analytics only count visitors.</p>
      </>
    ),
    drawDistance: 1200,
    label: 'Run San Andreas [local only]',
    // 22:00 — the night boot the engine host always used (vehicle lamps/coronas visible on boot).
    loadGame: { radius: 400, startMinutes: 1320, weather: 'EXTRASUNNY_SMOG_LA' },
    mainCharacter: 'bmycg',
    playerSpawn: [2495.0, -1675.0, 16.0], // LS - Ganton (default). Debug teleports below cover feature spots.
    teleports: [...SA_TELEPORTS],
  },
};

/** Launchable game ids, in menu order. `devOnly` games (fetch demos that would distribute mod content from
 *  the CDN) are dropped from production builds, so a deployed site offers only the bring-your-own-files
 *  titles (San Andreas). They remain available under `npm run dev`. */
export const GAME_IDS = selectGameIds(GAME_CONFIG, IS_DEV);

/** Default player collision-box half-extents (Z-up) — a human; per-game `playerHalfExtents` overrides it. */
export const HUMAN_HALF_EXTENTS: Vec3 = [0.3, 0.3, 0.9];
