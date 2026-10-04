import type {
  BloomConfig,
  CameraConfig,
  City,
  CloudsConfig,
  EffectsConfig,
  EventBus,
  GameEvents,
  HeadlightConfig,
  LightsConfig,
  MoonConfig,
  NightConfig,
  ProcObjCategory,
  ProcObjConfig,
  ProcObjTypeConfig,
  ShadowsConfig,
  SkyConfig,
  SsaoConfig,
  StarsConfig,
  StreamingConfig,
  Vec3,
  VehicleReflectionConfig,
  WaterConfig,
  WorldLightConfig,
} from '@opensa/game';
import type { ToneMappingModeName } from '@opensa/game/interfaces/config.interface';
import type { PerfStats } from '@opensa/game/perf/perf-monitor';

import { PRESETS } from '@opensa/game/plugins/vehicle-reflection/presets';
import { GameClock } from '@opensa/game/time/game-clock';
import { PLATE_TEXT_LENGTH } from '@opensa/game/vehicle/plate-raster';
import { type ReactElement, useCallback, useEffect, useState } from 'react';

import type { Teleport } from '../../game-config';
import type { DebugCapabilities, Screen } from './debug-capabilities';
import type { MapGame } from './map-inspector';

import { CleoPanel, type CleoReadout } from './cleo-panel';
import {
  ALL_DEBUG_CAPABILITIES,
  cameraControlsFor,
  menuFor,
  skyControlsFor,
  worldLightControlsFor,
} from './debug-capabilities';
import { styles } from './debug-styles';
import { MapInspector } from './map-inspector';
import { DebugToggle, PerfPanel, PipelineToggle, SkyModelToggle, ToneMappingModeSelector } from './perf-panel';
import { PhysicsPanel, type PhysicsReadout } from './physics-panel';

/** Quick time-of-day presets for the debugger (label → minutes since midnight). */
const TIME_PRESETS: [string, number][] = [
  ['00:00', 0],
  ['06:00', 360],
  ['12:00', 720],
  ['18:00', 1080],
  ['21:00', 1260],
];

/** Gameplay debug actions (GTA-specific) the F2 panel triggers; wired in canvas-host. */
export interface DebugActions {
  /** Current bloom tuning. */
  bloom(): BloomConfig;
  /** Smash the nearest breakable prop to the player (plan 045) — debugger trigger. No-op when none near. */
  breakNearest(): void;
  /** Current follow-camera tuning (distance / angle / responsiveness / zoom range). */
  camera(): CameraConfig;
  /** Live follow distance (includes wheel zoom) — polled for the "current" readout. */
  cameraDistance(): number;
  /** The city the player is currently in (Los Santos / San Fierro / Las Venturas / Countryside). */
  city(): City;
  /** The CLEO screen's live readout (engine host only, plan 097/07); null = no scripts in the build. */
  cleoReadout?(): CleoReadout | null;
  /** Dispatch ONE instruction on the named CLEO thread (the F2 step affordance). */
  cleoStep?(thread: string): void;
  /** The CLEO trace ring's lines — all threads, or one thread's story. */
  cleoTraceLines?(thread?: string): readonly string[];
  /** Current cloud tuning. */
  clouds(): CloudsConfig;
  /** Current world 2dfx particle-effects tuning (plan 044). */
  effects(): EffectsConfig;
  /** Own-engine Perf rows (`[label, value]`, pre-formatted). Absent on the three host — see PerfPanelActions. */
  engineStats?(): readonly (readonly [string, string])[];
  /** Flip the occupied car (on wheels → roof, on roof → wheels). No-op on foot. */
  flipVehicle(): void;
  /** Current fog distance (world units to full fog). */
  fogDistance(): number;
  /** Current in-game time (minutes since midnight). */
  gameTime(): number;
  /** Whether the god-rays post-effect is on. */
  godrays(): boolean;
  /** Current god-rays light-source size (shaft strength). */
  godraysSize(): number;
  /** EMA GPU pass timings (label → ms); empty when the timer extension is unavailable. */
  gpuTimings(): readonly (readonly [string, number])[];
  /** The rendering-overhaul master switch (plan 063). */
  graphicsPipeline(): 'classic' | 'modern';
  /** Current vehicle-headlight config (lamp corona size + brightness). */
  headlights(): HeadlightConfig;
  /** Whether the debug fly mode is currently on. */
  isFlying(): boolean;
  /** Current night-lights (street-lamp coronas) config. */
  lights(): LightsConfig;
  /** Whether the missing-texture highlight (magenta stand-ins) is on (engine host only; default = dev). */
  missingTextureHighlight?(): boolean;
  /** Current night-moon config (size/glow/elevation). */
  moon(): MoonConfig;
  /** Current night ambient/atmosphere config (brightness/tint). */
  night(): NightConfig;
  /** Whether the own engine draws its on-screen HUD (engine host only; default = development build). */
  perfHud?(): boolean;
  /** Whether the own engine logs a CPU breakdown for slow frames (engine host only). */
  perfLogs?(): boolean;
  /** Rolling perf stats; `null` until sampling produced a frame (see setPerfEnabled). */
  perfStats(): null | PerfStats;
  /** The shared vehicle tuning as `[label, value]` rows (Physics screen; engine host only — plan 081/01). */
  physicsConstants?(): readonly (readonly [string, number])[];
  /** The driven car's latest telemetry frame; null on foot or before the capture produced a step. */
  physicsReadout?(): null | PhysicsReadout;
  /** Live player position (native Z-up). */
  playerCoords(): Vec3;
  /** Current procedural-clutter tuning (per category; plan 042). */
  procObj(): ProcObjConfig;
  /** Re-drop the player at their current spot (to unstick). */
  respawnPlayer(): void;
  /** Tune bloom (enabled/intensity/threshold). */
  setBloom(patch: Partial<BloomConfig>): void;
  /** Tune the follow camera (distance / angle / responsiveness / zoom range). */
  setCamera(patch: Partial<CameraConfig>): void;
  /** Run/pause the CLEO script runner (writes `config.cleo.enabled`). */
  setCleoEnabled?(enabled: boolean): void;
  /** Start/stop the CLEO tracer — off costs one boolean per instruction. */
  setCleoTracing?(enabled: boolean): void;
  /** Tune clouds (coverage/opacity). */
  setClouds(patch: Partial<CloudsConfig>): void;
  /** Tune world 2dfx particle effects (enabled/drawDistance; plan 044). */
  setEffects(patch: Partial<EffectsConfig>): void;
  /** Toggle the debug fly mode (off → drop the player to the ground beneath them). */
  setFlyMode(on: boolean): void;
  /** Set the fog distance (world units to full fog). */
  setFogDistance(distance: number): void;
  /** Set the in-game time (minutes since midnight). */
  setGameTime(minutes: number): void;
  /** Toggle the god-rays post-effect. */
  setGodrays(enabled: boolean): void;
  /** Set the god-rays light-source size (shaft strength). */
  setGodraysSize(size: number): void;
  /** Flip the rendering-pipeline master switch (plan 063; no visual change until 064+ land). */
  setGraphicsPipeline(pipeline: 'classic' | 'modern'): void;
  /** Tune vehicle headlights (lamp corona size + brightness). */
  setHeadlights(patch: Partial<HeadlightConfig>): void;
  /** Toggle night street-lamp lights (coronas). */
  setLights(patch: Partial<LightsConfig>): void;
  /** Repaint missing-texture stand-in layers magenta/off (engine host only; plan 085 row B). */
  setMissingTextureHighlight?(enabled: boolean): void;
  /** Tune the night moon (size/glow/elevation). */
  setMoon(patch: Partial<MoonConfig>): void;
  /** Tune night ambient/atmosphere (brightness/tint). */
  setNight(patch: Partial<NightConfig>): void;
  /** Enable/disable perf sampling (the Perf panel turns it on only while open). */
  setPerfEnabled(enabled: boolean): void;
  /** Show/hide the own engine's on-screen HUD (engine host only). */
  setPerfHud?(enabled: boolean): void;
  /** Enable/disable the own engine's slow-frame console breakdown (engine host only). */
  setPerfLogs?(enabled: boolean): void;
  /** Run the vehicle telemetry sampler — the Physics screen turns it on only while open (plan 081/01). */
  setPhysicsCapture?(enabled: boolean): void;
  /** Tune one procedural-clutter category (enabled/drawDistance/density). */
  setProcObj(category: ProcObjCategory, patch: Partial<ProcObjTypeConfig>): void;
  /** Toggle sun shadows. */
  setShadows(patch: Partial<ShadowsConfig>): void;
  /** Toggle the debug wireframe view (scene-wide wireframe override, bypasses post-FX). */
  /** Toggle the debug normals view (scene-wide normal-colour override, bypasses post-FX). */
  setShowNormals(enabled: boolean): void;
  /** Tune the god-rays shader (density/exposure/weight). */
  setSky(patch: Partial<SkyConfig>): void;
  /** Sky model switch (plan 067): classic gradient dome ↔ Preetham PBR sky. */
  setSkyModel(model: 'classic' | 'pbr'): void;
  /** Tune SSAO (enabled/intensity/radius). */
  setSsao(patch: Partial<SsaoConfig>): void;
  /** Toggle night stars. */
  setStars(patch: Partial<StarsConfig>): void;
  /** Tune the map streaming draw distances (HD / LOD rings). */
  setStreaming(patch: Partial<StreamingConfig>): void;
  /** Set the sun disc base size (world units). */
  setSunSize(size: number): void;
  /** Toggle ACES tone mapping. */
  setToneMapping(enabled: boolean): void;
  /** Colour-spike selector (plan 063): move tone mapping between the post pass and the renderer. */
  setToneMappingMode(mode: ToneMappingModeName): void;
  /** Tune vehicle reflections (preset/intensity). */
  setVehicleReflection(patch: Partial<VehicleReflectionConfig>): void;
  /** Tune the water shader (glint/reflection). */
  setWater(patch: Partial<WaterConfig>): void;
  /** Switch the active timecyc weather (index into WEATHER_NAMES). */
  setWeather(index: number): void;
  /** Tune the SA prelit world lighting (plan 038 day/night tints + shadow strength). */
  setWorldLight(patch: Partial<WorldLightConfig>): void;
  /** Whether sun shadows are on. */
  shadows(): ShadowsConfig;
  /** Current god-rays shader tuning. */
  sky(): SkyConfig;
  /** Active sky model (plan 067). */
  skyModel(): 'classic' | 'pbr';
  /** Spawn a car (by model name) just in front of the player. `plate` overrides the deterministic
   *  number the placement would otherwise resolve to (plan 082/04); omit for the generated one. */
  spawnVehicle(model: string, plate?: string): Promise<void>;
  /** Current SSAO tuning. */
  ssao(): SsaoConfig;
  /** Whether night stars are on. */
  stars(): StarsConfig;
  /** Current map streaming draw distances (HD / LOD rings). */
  streaming(): StreamingConfig;
  /** Current sun disc base size (world units). */
  sunSize(): number;
  /** Teleport the player to a world position (native Z-up). */
  teleport(coords: Vec3): void;
  /** Teleport the player back to Ganton. */
  teleportToGanton(): void;
  /** Whether ACES tone mapping is on. */
  toneMapping(): boolean;
  /** Active tone-mapping placement/curve (plan 063 colour spike). */
  toneMappingMode(): ToneMappingModeName;
  /** Snap the map-inspector camera back to top-down (undo a right-drag orbit). */
  topDownView(): void;
  /** Spawnable car model names of the loaded game (from `vehicles.ide`) — for the spawn list. */
  vehicleModels(): readonly string[];
  /** Current vehicle-reflection tuning (preset + intensity). */
  vehicleReflection(): VehicleReflectionConfig;
  /** Current water shader tuning. */
  water(): WaterConfig;
  /** Active timecyc weather index. */
  weather(): number;
  /** Selectable weathers (index + label), rain/storm excluded. */
  weatherList(): readonly { index: number; label: string }[];
  /** Current SA prelit world-lighting calibration. */
  worldLight(): WorldLightConfig;
}

/**
 * The overlay's whole view of the game object: the typed event bus (city crossings). Everything else it needs
 * goes through {@link DebugActions} — so a non-three host (the own engine, plan 074/22) can mount the same
 * debugger. The three `Game` satisfies this structurally, so prod passes `game` unchanged.
 */
export interface DebugGame {
  readonly events: Pick<EventBus<GameEvents>, 'on'>;
}

/** Reflection preset cycle order for the debug selector (Off + the registry keys). */
const REFLECTION_PRESETS = ['off', ...Object.keys(PRESETS)];

/** Display label per city token. */
const CITY_LABEL: Record<City, string> = {
  COUNTRYSIDE: 'Countryside',
  DESERT: 'Desert (Bone County)',
  LA: 'Los Santos',
  SF: 'San Fierro',
  VEGAS: 'Las Venturas',
};

/** ProcObj screen rows — display order for the clutter categories (plan 042). */
const PROCOBJ_CATEGORIES: readonly ProcObjCategory[] = [
  'grass',
  'flowers',
  'bushes',
  'cacti',
  'trees',
  'rocks',
  'underwater',
];

/**
 * In-game debugger (toggle with **F2**). A multi-level menu of gameplay debug
 * actions; opening it has **no** effect on the simulation — only the Map screen's
 * "Activate Map Viewer" enters the map-viewer mode (and leaving it exits cleanly).
 */
export function DebugOverlay({
  actions,
  buildTime,
  capabilities = ALL_DEBUG_CAPABILITIES,
  game,
  mapGame,
  suppressed = false,
  teleports,
}: {
  actions: DebugActions;
  /** The pak's build time (opensa manifest `buildTime`) — a grey stamp under the title so the running pak
   *  version is visible. Absent for a pak built before the field existed. */
  buildTime?: string;
  /** Which controls this host can honour; defaults to everything. */
  capabilities?: DebugCapabilities;
  game: DebugGame;
  /** The Map screen's wider host surface — omitted by a host that cannot drive the map viewer. */
  mapGame?: MapGame;
  /** Hide the panel WITHOUT closing it — the photo camera takes the screen, and leaving it must give the
   *  debugger back exactly as it was. Suppressing rather than closing is what keeps that promise. */
  suppressed?: boolean;
  teleports: Teleport[];
}): null | ReactElement {
  const menu = menuFor(capabilities, __DEBUGGER_HIDE__);
  const [visible, setVisible] = useState(false);
  const [screen, setScreen] = useState<Screen>('root');
  const [flying, setFlying] = useState(() => actions.isFlying());
  const [showCoords, setShowCoords] = useState(false);
  const [coords, setCoords] = useState<Vec3>([0, 0, 0]);
  const [city, setCity] = useState<City>(() => actions.city());
  const [mapActive, setMapActive] = useState(false);
  const [normals, setNormals] = useState(false);
  const [time, setTime] = useState(() => actions.gameTime());
  const [godrays, setGodrays] = useState(() => actions.godrays());
  const [godraysSize, setGodraysSize] = useState(() => actions.godraysSize());
  const [bloom, setBloom] = useState<BloomConfig>(() => actions.bloom());
  const [camera, setCamera] = useState<CameraConfig>(() => actions.camera());
  const [cameraZoom, setCameraZoom] = useState(() => actions.cameraDistance());
  const [clouds, setClouds] = useState<CloudsConfig>(() => actions.clouds());
  const [pipeline, setPipeline] = useState(() => actions.graphicsPipeline());
  const [skyModel, setSkyModel] = useState(() => actions.skyModel());
  const [toneMode, setToneMode] = useState(() => actions.toneMappingMode());
  const [toneMapping, setToneMapping] = useState(() => actions.toneMapping());
  const [water, setWater] = useState<WaterConfig>(() => actions.water());
  const [reflectionCfg, setReflectionCfg] = useState<VehicleReflectionConfig>(() => actions.vehicleReflection());
  const [ssao, setSsao] = useState<SsaoConfig>(() => actions.ssao());
  const [shadows, setShadows] = useState<ShadowsConfig>(() => actions.shadows());
  const [stars, setStars] = useState<StarsConfig>(() => actions.stars());
  const [lights, setLights] = useState<LightsConfig>(() => actions.lights());
  const [headlights, setHeadlights] = useState<HeadlightConfig>(() => actions.headlights());
  const [moon, setMoon] = useState<MoonConfig>(() => actions.moon());
  const [night, setNight] = useState<NightConfig>(() => actions.night());
  const [worldLight, setWorldLight] = useState<WorldLightConfig>(() => actions.worldLight());
  const [procObj, setProcObj] = useState<ProcObjConfig>(() => actions.procObj());
  const [effects, setEffects] = useState<EffectsConfig>(() => actions.effects());
  const [sky, setSky] = useState<SkyConfig>(() => actions.sky());
  const [sunSize, setSunSize] = useState(() => actions.sunSize());
  const [weather, setWeather] = useState(() => actions.weather());

  const resetTo = useCallback(
    (next: Screen): void => {
      setScreen(next);
      setShowCoords(false);
      setMapActive(false); // navigating away leaves the map viewer (the inspector's unmount cleans up)
      setNormals(false);
      actions.setShowNormals(false); // leaving the screen / closing always drops the debug overrides
    },
    [actions],
  );

  // Close the panel: reset navigation (leave the map viewer, reopen at root) and end fly mode (drops the player
  // to the ground beneath them) — so the debugger never leaves the player floating.
  const close = useCallback((): void => {
    resetTo('root');
    setVisible(false);
    if (actions.isFlying()) {
      actions.setFlyMode(false);
      setFlying(false);
    }
  }, [actions, resetTo]);

  const toggleFly = useCallback((): void => {
    const next = !actions.isFlying();
    actions.setFlyMode(next);
    setFlying(next);
  }, [actions]);

  // F2 toggles the panel. While SUPPRESSED it does nothing here: the host reads the same key to leave the
  // photo camera, and the panel reappearing in the state the player left it is the point of suppressing.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'F2' || suppressed) {
        return;
      }
      e.preventDefault();
      if (visible) {
        close();
      } else {
        setVisible(true);
      }
    }
    window.addEventListener('keydown', handleKeyDown);

    return (): void => window.removeEventListener('keydown', handleKeyDown);
  }, [visible, close, suppressed]);

  // Keep the shown coords live while the Position screen displays them.
  useEffect(() => {
    if (!visible || screen !== 'position' || !showCoords) {
      return;
    }
    const id = setInterval(() => setCoords(actions.playerCoords()), 200);

    return (): void => clearInterval(id);
  }, [actions, visible, screen, showCoords]);

  // Keep the city label live — updates on city crossings (event-driven, no polling).
  useEffect(() => game.events.on('city', ({ city: next }) => setCity(next)), [game]);

  // Keep the live clock label ticking while the Time screen is open.
  useEffect(() => {
    if (!visible || screen !== 'time') {
      return;
    }
    const id = setInterval(() => setTime(actions.gameTime()), 500);

    return (): void => clearInterval(id);
  }, [actions, visible, screen]);

  // Keep the live follow-distance (wheel zoom) readout updating while the Camera screen is open.
  useEffect(() => {
    if (!visible || screen !== 'camera') {
      return;
    }
    const id = setInterval(() => setCameraZoom(actions.cameraDistance()), 200);

    return (): void => clearInterval(id);
  }, [actions, visible, screen]);

  if (!visible || suppressed) {
    return null;
  }

  return (
    <div style={styles.panel}>
      <button onClick={close} style={styles.close} type="button">
        ×
      </button>
      <div style={styles.title}>DEBUG</div>
      <BuildStamp buildTime={buildTime} />

      {screen === 'root' ? (
        <div style={styles.group}>
          {menu.map((item) => (
            <button key={item.screen} onClick={() => resetTo(item.screen)} style={styles.menuButton} type="button">
              {item.label} <span>›</span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <button onClick={() => resetTo('root')} style={styles.backButton} type="button">
            ‹ back
          </button>

          {screen === 'player' && (
            <div style={styles.group}>
              <button onClick={toggleFly} style={styles.actionButton} type="button">
                Fly Mode {flying ? 'Off' : 'On'}
              </button>
              <div style={styles.divider} />
              <button onClick={() => actions.respawnPlayer()} style={styles.actionButton} type="button">
                Respawn
              </button>
              <button onClick={() => actions.teleportToGanton()} style={styles.actionButton} type="button">
                To Ganton
              </button>
              <button onClick={() => actions.breakNearest()} style={styles.actionButton} type="button">
                Break nearest prop
              </button>
            </div>
          )}

          {screen === 'vehicles' && <VehicleScreen actions={actions} />}

          {screen === 'position' && (
            <div style={styles.group}>
              <div style={styles.groupLabel}>CITY: {CITY_LABEL[city]}</div>
              <button
                onClick={() => {
                  setCoords(actions.playerCoords());
                  setShowCoords(true);
                }}
                style={styles.actionButton}
                type="button"
              >
                Show coords
              </button>
              {showCoords && (
                <>
                  <div style={styles.info}>{coords.map((n) => n.toFixed(2)).join(', ')}</div>
                  <button
                    onClick={() => void navigator.clipboard.writeText(coords.map((n) => n.toFixed(2)).join(', '))}
                    style={styles.actionButton}
                    type="button"
                  >
                    Copy Coords
                  </button>
                </>
              )}

              {teleports.length > 0 && (
                <>
                  <div style={styles.groupLabel}>TELEPORT</div>
                  {teleports.map((t) => (
                    <button
                      key={t.label}
                      onClick={() => actions.teleport(t.coords)}
                      style={styles.actionButton}
                      type="button"
                    >
                      {t.label}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}

          {screen === 'time' && (
            <div style={styles.group}>
              <div style={styles.groupLabel}>TIME: {GameClock.format(time)}</div>
              <div style={styles.presetRow}>
                {TIME_PRESETS.map(([label, minutes]) => (
                  <button
                    key={label}
                    onClick={() => {
                      setTime(minutes);
                      actions.setGameTime(minutes);
                    }}
                    style={styles.actionButton}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input
                max={1439}
                min={0}
                onChange={(e) => {
                  const minutes = Number(e.target.value);
                  setTime(minutes);
                  actions.setGameTime(minutes);
                }}
                step={15}
                type="range"
                value={time}
              />
            </div>
          )}

          {screen === 'atmosphere' && (
            <div style={styles.group}>
              <div style={styles.groupLabel}>NIGHT LIGHTING FADE (windows + tonemap)</div>
              {(
                [
                  ['duskStart', 'DUSK START'],
                  ['duskEnd', 'DUSK END'],
                  ['dawnStart', 'DAWN START'],
                  ['dawnEnd', 'DAWN END'],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <div style={styles.groupLabel}>
                    {label}: {night.litFade[key].toFixed(1)}h
                  </div>
                  <input
                    max={24}
                    min={0}
                    onChange={(e) => {
                      const litFade = { ...night.litFade, [key]: Number(e.target.value) };
                      setNight((prev) => ({ ...prev, litFade }));
                      actions.setNight({ litFade });
                    }}
                    step={0.5}
                    type="range"
                    value={night.litFade[key]}
                  />
                </div>
              ))}
              {capabilities.dynamicObjectsFill && (
                <>
                  <div style={styles.groupLabel}>DYNAMIC NIGHT FILL (player + cars)</div>
                  {(
                    [
                      ['strength', 'NIGHT FILL', 2],
                      ['rim', 'NIGHT FILL RIM', 2],
                    ] as const
                  ).map(([key, label, max]) => (
                    <div key={key}>
                      <div style={styles.groupLabel}>
                        {label}: {night.dynamicObjectsFill[key].toFixed(2)}
                      </div>
                      <input
                        max={max}
                        min={0}
                        onChange={(e) => {
                          const dynamicObjectsFill = { ...night.dynamicObjectsFill, [key]: Number(e.target.value) };
                          setNight((prev) => ({ ...prev, dynamicObjectsFill }));
                          actions.setNight({ dynamicObjectsFill });
                        }}
                        step={0.05}
                        type="range"
                        value={night.dynamicObjectsFill[key]}
                      />
                    </div>
                  ))}
                </>
              )}
              {capabilities.cloudCover && (
                <>
                  <div style={styles.groupLabel}>CLOUD COVER: {clouds.coverage.toFixed(2)}</div>
                  <input
                    max={1}
                    min={0}
                    onChange={(e) => {
                      const coverage = Number(e.target.value);
                      setClouds((prev) => ({ ...prev, coverage }));
                      actions.setClouds({ coverage });
                    }}
                    step={0.01}
                    type="range"
                    value={clouds.coverage}
                  />
                </>
              )}
              <div style={styles.groupLabel}>CLOUD OPACITY: {clouds.opacity.toFixed(2)}</div>
              <input
                max={1}
                min={0}
                onChange={(e) => {
                  const opacity = Number(e.target.value);
                  setClouds((prev) => ({ ...prev, opacity }));
                  actions.setClouds({ opacity });
                }}
                step={0.01}
                type="range"
                value={clouds.opacity}
              />
              {capabilities.volumetricClouds && (
                <DebugToggle
                  checked={clouds.volumetric}
                  label="Volumetric clouds (067 Stage B — heavy)"
                  onToggle={(volumetric) => {
                    setClouds((prev) => ({ ...prev, volumetric }));
                    actions.setClouds({ volumetric });
                  }}
                />
              )}
              {capabilities.starsToggle && (
                <label style={styles.label}>
                  <input
                    checked={stars.enabled}
                    onChange={() => {
                      const enabled = !stars.enabled;
                      setStars({ enabled });
                      actions.setStars({ enabled });
                    }}
                    style={styles.radio}
                    type="checkbox"
                  />
                  <span style={stars.enabled ? styles.optionActive : styles.option}>Night stars</span>
                </label>
              )}
              {capabilities.lampsToggle && (
                <label style={styles.label}>
                  <input
                    checked={lights.enabled}
                    onChange={() => {
                      const enabled = !lights.enabled;
                      setLights((prev) => ({ ...prev, enabled }));
                      actions.setLights({ enabled });
                    }}
                    style={styles.radio}
                    type="checkbox"
                  />
                  <span style={lights.enabled ? styles.optionActive : styles.option}>Night lights (lamps)</span>
                </label>
              )}
              {capabilities.moonRig && (
                <>
                  <div style={styles.groupLabel}>MOON SIZE: {moon.size.toFixed(0)}</div>
                  <input
                    max={400}
                    min={40}
                    onChange={(e) => {
                      const size = Number(e.target.value);
                      setMoon((prev) => ({ ...prev, size }));
                      actions.setMoon({ size });
                    }}
                    step={5}
                    type="range"
                    value={moon.size}
                  />
                  <div style={styles.groupLabel}>MOON ELEVATION: {moon.elevationDeg.toFixed(0)}°</div>
                  <input
                    max={80}
                    min={2}
                    onChange={(e) => {
                      const elevationDeg = Number(e.target.value);
                      setMoon((prev) => ({ ...prev, elevationDeg }));
                      actions.setMoon({ elevationDeg });
                    }}
                    step={1}
                    type="range"
                    value={moon.elevationDeg}
                  />
                </>
              )}
              <div style={styles.groupLabel}>MOON BRIGHTNESS: {moon.brightness.toFixed(2)}</div>
              <input
                max={3}
                min={0}
                onChange={(e) => {
                  const brightness = Number(e.target.value);
                  setMoon((prev) => ({ ...prev, brightness }));
                  actions.setMoon({ brightness });
                }}
                step={0.05}
                type="range"
                value={moon.brightness}
              />
              {capabilities.coronaDistance && (
                <>
                  <div style={styles.groupLabel}>CORONA DISTANCE: {night.coronaDrawDistance.toFixed(0)}</div>
                  <input
                    max={400}
                    min={20}
                    onChange={(e) => {
                      const coronaDrawDistance = Number(e.target.value);
                      setNight((prev) => ({ ...prev, coronaDrawDistance }));
                      actions.setNight({ coronaDrawDistance });
                    }}
                    step={5}
                    type="range"
                    value={night.coronaDrawDistance}
                  />
                </>
              )}
              <div style={styles.groupLabel}>NIGHT EMISSIVE (071): {night.emissiveBoost.toFixed(2)}</div>
              <input
                max={4}
                min={0}
                onChange={(e) => {
                  const emissiveBoost = Number(e.target.value);
                  setNight((prev) => ({ ...prev, emissiveBoost }));
                  actions.setNight({ emissiveBoost });
                }}
                step={0.05}
                type="range"
                value={night.emissiveBoost}
              />
              {capabilities.skyGlow && (
                <>
                  <div style={styles.groupLabel}>NIGHT SKY GLOW (067): {night.skyGlow.toFixed(2)}</div>
                  <input
                    max={3}
                    min={0}
                    onChange={(e) => {
                      const skyGlow = Number(e.target.value);
                      setNight((prev) => ({ ...prev, skyGlow }));
                      actions.setNight({ skyGlow });
                    }}
                    step={0.05}
                    type="range"
                    value={night.skyGlow}
                  />
                </>
              )}
              <div style={styles.groupLabel}>NIGHT SKYLIGHT: {night.skylight.toFixed(2)}</div>
              <input
                max={2}
                min={0}
                onChange={(e) => {
                  const skylight = Number(e.target.value);
                  setNight((prev) => ({ ...prev, skylight }));
                  actions.setNight({ skylight });
                }}
                step={0.05}
                type="range"
                value={night.skylight}
              />
              {capabilities.windowGlow && (
                <>
                  <div style={styles.groupLabel}>NIGHT WINDOW GLOW: {night.windowGlow.toFixed(2)}</div>
                  <input
                    max={3}
                    min={0}
                    onChange={(e) => {
                      const windowGlow = Number(e.target.value);
                      setNight((prev) => ({ ...prev, windowGlow }));
                      actions.setNight({ windowGlow });
                    }}
                    step={0.05}
                    type="range"
                    value={night.windowGlow}
                  />
                </>
              )}
              <div style={styles.groupLabel}>WORLD LIGHT (SA prelit map — plan 038)</div>
              {worldLightControlsFor(capabilities).map(([key, label, min, max, step]) => (
                <div key={key}>
                  <div style={styles.groupLabel}>
                    {label}: {worldLight[key].toFixed(2)}
                  </div>
                  <input
                    max={max}
                    min={min}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setWorldLight((prev) => ({ ...prev, [key]: value }));
                      actions.setWorldLight({ [key]: value });
                    }}
                    step={step}
                    type="range"
                    value={worldLight[key]}
                  />
                </div>
              ))}
            </div>
          )}

          {screen === 'procobj' && (
            <div style={styles.group}>
              <div style={styles.groupLabel}>PROCEDURAL CLUTTER (procobj.dat — plan 042)</div>
              {PROCOBJ_CATEGORIES.map((category) => {
                const patch = (value: Partial<ProcObjTypeConfig>): void => {
                  setProcObj((prev) => ({ ...prev, [category]: { ...prev[category], ...value } }));
                  actions.setProcObj(category, value);
                };

                return (
                  <div key={category}>
                    <label style={styles.label}>
                      <input
                        checked={procObj[category].enabled}
                        onChange={() => patch({ enabled: !procObj[category].enabled })}
                        style={styles.radio}
                        type="checkbox"
                      />
                      <span style={procObj[category].enabled ? styles.optionActive : styles.option}>
                        {category.toUpperCase()}
                      </span>
                    </label>
                    <div style={styles.groupLabel}>DRAW DISTANCE: {procObj[category].drawDistance.toFixed(0)}</div>
                    <input
                      max={300}
                      min={10}
                      onChange={(e) => patch({ drawDistance: Number(e.target.value) })}
                      step={10}
                      type="range"
                      value={procObj[category].drawDistance}
                    />
                    <div style={styles.groupLabel}>DENSITY: {procObj[category].density.toFixed(1)}</div>
                    <input
                      max={3}
                      min={0}
                      onChange={(e) => patch({ density: Number(e.target.value) })}
                      step={0.1}
                      type="range"
                      value={procObj[category].density}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {screen === 'camera' && (
            <div style={styles.group}>
              <div style={styles.groupLabel}>FOLLOW CAMERA (mouse looks; auto-trails when you change direction)</div>
              <div style={styles.groupLabel}>CURRENT ZOOM: {cameraZoom.toFixed(1)}</div>
              {cameraControlsFor(capabilities).map(([key, label, min, max, step]) => (
                <div key={key}>
                  <div style={styles.groupLabel}>
                    {/* A fine-step row (look speed is radians per PIXEL) reads 0.00 at two decimals. */}
                    {label}: {camera[key].toFixed(step < 0.01 ? 4 : 2)}
                  </div>
                  <input
                    max={max}
                    min={min}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setCamera((prev) => ({ ...prev, [key]: value }));
                      actions.setCamera({ [key]: value });
                    }}
                    step={step}
                    type="range"
                    value={camera[key]}
                  />
                </div>
              ))}
              <CameraToggle
                checked={camera.followZoom}
                label="Wheel zoom"
                onToggle={(followZoom) => {
                  setCamera((prev) => ({ ...prev, followZoom }));
                  actions.setCamera({ followZoom });
                }}
              />
              <CameraToggle
                checked={camera.reducedMotion}
                label="Reduced motion (no bob / dip / shake / FOV kicks)"
                onToggle={(reducedMotion) => {
                  setCamera((prev) => ({ ...prev, reducedMotion }));
                  actions.setCamera({ reducedMotion });
                }}
              />
            </div>
          )}

          {screen === 'graphics' && (
            <div style={styles.group}>
              <div style={styles.groupLabel}>GRAPHICS</div>
              <label style={styles.label}>
                <input
                  checked={godrays}
                  onChange={() => {
                    const next = !godrays;
                    setGodrays(next);
                    actions.setGodrays(next);
                  }}
                  style={styles.radio}
                  type="checkbox"
                />
                <span style={godrays ? styles.optionActive : styles.option}>God rays</span>
              </label>
              {capabilities.godrayShader && (
                <>
                  <div style={styles.groupLabel}>RAYS SIZE: {godraysSize}</div>
                  <input
                    max={120}
                    min={5}
                    onChange={(e) => {
                      const size = Number(e.target.value);
                      setGodraysSize(size);
                      actions.setGodraysSize(size);
                    }}
                    step={1}
                    type="range"
                    value={godraysSize}
                  />
                </>
              )}
              {capabilities.sunSize && (
                <>
                  <div style={styles.groupLabel}>SUN SIZE: {sunSize}</div>
                  <input
                    max={120}
                    min={5}
                    onChange={(e) => {
                      const size = Number(e.target.value);
                      setSunSize(size);
                      actions.setSunSize(size);
                    }}
                    step={1}
                    type="range"
                    value={sunSize}
                  />
                </>
              )}
              {skyControlsFor(capabilities).map((key) => (
                <div key={key}>
                  <div style={styles.groupLabel}>
                    {key.toUpperCase()}: {sky[key].toFixed(2)}
                  </div>
                  <input
                    max={1}
                    min={0}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setSky((prev) => ({ ...prev, [key]: value }));
                      actions.setSky({ [key]: value });
                    }}
                    step={0.01}
                    type="range"
                    value={sky[key]}
                  />
                </div>
              ))}
              <label style={styles.label}>
                <input
                  checked={bloom.enabled}
                  onChange={() => {
                    const enabled = !bloom.enabled;
                    setBloom((prev) => ({ ...prev, enabled }));
                    actions.setBloom({ enabled });
                  }}
                  style={styles.radio}
                  type="checkbox"
                />
                <span style={bloom.enabled ? styles.optionActive : styles.option}>Bloom</span>
              </label>
              <div style={styles.groupLabel}>INTENSITY: {bloom.intensity.toFixed(2)}</div>
              <input
                max={3}
                min={0}
                onChange={(e) => {
                  const intensity = Number(e.target.value);
                  setBloom((prev) => ({ ...prev, intensity }));
                  actions.setBloom({ intensity });
                }}
                step={0.05}
                type="range"
                value={bloom.intensity}
              />
              <div style={styles.groupLabel}>THRESHOLD: {bloom.threshold.toFixed(2)}</div>
              <input
                max={1}
                min={0}
                onChange={(e) => {
                  const threshold = Number(e.target.value);
                  setBloom((prev) => ({ ...prev, threshold }));
                  actions.setBloom({ threshold });
                }}
                step={0.01}
                type="range"
                value={bloom.threshold}
              />
              {capabilities.ssao && (
                <>
                  <label style={styles.label}>
                    <input
                      checked={ssao.enabled}
                      onChange={() => {
                        const enabled = !ssao.enabled;
                        setSsao((prev) => ({ ...prev, enabled }));
                        actions.setSsao({ enabled });
                      }}
                      style={styles.radio}
                      type="checkbox"
                    />
                    <span style={ssao.enabled ? styles.optionActive : styles.option}>SSAO</span>
                  </label>
                  <div style={styles.groupLabel}>AO INTENSITY: {ssao.intensity.toFixed(2)}</div>
                  <input
                    max={4}
                    min={0}
                    onChange={(e) => {
                      const intensity = Number(e.target.value);
                      setSsao((prev) => ({ ...prev, intensity }));
                      actions.setSsao({ intensity });
                    }}
                    step={0.1}
                    type="range"
                    value={ssao.intensity}
                  />
                  <div style={styles.groupLabel}>AO RADIUS: {ssao.radius.toFixed(2)}</div>
                  <input
                    max={1}
                    min={0.01}
                    onChange={(e) => {
                      const radius = Number(e.target.value);
                      setSsao((prev) => ({ ...prev, radius }));
                      actions.setSsao({ radius });
                    }}
                    step={0.01}
                    type="range"
                    value={ssao.radius}
                  />
                </>
              )}
              {capabilities.shadows && (
                <>
                  <label style={styles.label}>
                    <input
                      checked={shadows.enabled}
                      onChange={() => {
                        const enabled = !shadows.enabled;
                        setShadows((prev) => ({ ...prev, enabled }));
                        actions.setShadows({ enabled });
                      }}
                      style={styles.radio}
                      type="checkbox"
                    />
                    <span style={shadows.enabled ? styles.optionActive : styles.option}>Sun shadows</span>
                  </label>
                  <div style={styles.groupLabel}>CSM DISTANCE (065, modern): {shadows.distance}</div>
                  <input
                    max={1500}
                    min={200}
                    onChange={(e) => {
                      const distance = Number(e.target.value);
                      setShadows((prev) => ({ ...prev, distance }));
                      actions.setShadows({ distance });
                    }}
                    step={50}
                    type="range"
                    value={shadows.distance}
                  />
                </>
              )}
              {capabilities.worldEffects && (
                <WorldEffectsControls
                  effects={effects}
                  onPatch={(patch) => {
                    setEffects((prev) => ({ ...prev, ...patch }));
                    actions.setEffects(patch);
                  }}
                />
              )}
              {capabilities.headlightSliders && (
                <>
                  {(
                    [
                      ['beamIntensity', 'BEAM POWER (070)', 0, 6, 0.1],
                      ['beamRange', 'BEAM RANGE (070)', 10, 60, 1],
                      ['brakeIntensity', 'BRAKE POOL (070)', 0, 5, 0.1],
                    ] as const
                  ).map(([key, label, min, max, step]) => (
                    <div key={key}>
                      <div style={styles.groupLabel}>
                        {label}: {headlights[key].toFixed(2)}
                      </div>
                      <input
                        max={max}
                        min={min}
                        onChange={(e) => {
                          const value = Number(e.target.value);
                          setHeadlights((prev) => ({ ...prev, [key]: value }));
                          actions.setHeadlights({ [key]: value });
                        }}
                        step={step}
                        type="range"
                        value={headlights[key]}
                      />
                    </div>
                  ))}
                  <div style={styles.groupLabel}>HEADLIGHT GLOW: {headlights.intensity.toFixed(2)}</div>
                  <input
                    max={4}
                    min={0}
                    onChange={(e) => {
                      const intensity = Number(e.target.value);
                      setHeadlights((prev) => ({ ...prev, intensity }));
                      actions.setHeadlights({ intensity });
                    }}
                    step={0.1}
                    type="range"
                    value={headlights.intensity}
                  />
                  <div style={styles.groupLabel}>HEADLIGHT CORONA POWER: {headlights.coronaIntensity.toFixed(2)}</div>
                  <input
                    max={1}
                    min={0}
                    onChange={(e) => {
                      const coronaIntensity = Number(e.target.value);
                      setHeadlights((prev) => ({ ...prev, coronaIntensity }));
                      actions.setHeadlights({ coronaIntensity });
                    }}
                    step={0.02}
                    type="range"
                    value={headlights.coronaIntensity}
                  />
                  <div style={styles.groupLabel}>HEADLIGHT CORONA SIZE: {headlights.coronaSize.toFixed(2)}</div>
                  <input
                    max={1}
                    min={0.05}
                    onChange={(e) => {
                      const coronaSize = Number(e.target.value);
                      setHeadlights((prev) => ({ ...prev, coronaSize }));
                      actions.setHeadlights({ coronaSize });
                    }}
                    step={0.01}
                    type="range"
                    value={headlights.coronaSize}
                  />
                </>
              )}
              <label style={styles.label}>
                <input
                  checked={toneMapping}
                  onChange={() => {
                    const next = !toneMapping;
                    setToneMapping(next);
                    actions.setToneMapping(next);
                  }}
                  style={styles.radio}
                  type="checkbox"
                />
                <span style={toneMapping ? styles.optionActive : styles.option}>Tone map (ACES)</span>
              </label>
              {capabilities.pipelineSwitch && (
                <PipelineToggle
                  onChange={(next) => actions.setGraphicsPipeline(next)}
                  pipeline={pipeline}
                  setPipeline={setPipeline}
                />
              )}
              {capabilities.toneMappingModes && (
                <ToneMappingModeSelector
                  mode={toneMode}
                  onChange={(next) => actions.setToneMappingMode(next)}
                  setMode={setToneMode}
                />
              )}
              {capabilities.skyModelToggle && (
                <SkyModelToggle
                  model={skyModel}
                  onChange={(next) => actions.setSkyModel(next)}
                  setModel={setSkyModel}
                />
              )}
              {capabilities.water && (
                <>
                  {(
                    [
                      ['waves', 'WATER WAVES (069)', 0, 3, 0.05],
                      ['foam', 'WATER FOAM (069)', 0, 3, 0.05],
                      ['shoreDepth', 'SHORE DEPTH (069)', 1, 20, 0.5],
                      ['shoreClarity', 'SHORE CLARITY (069)', 0, 1, 0.05],
                    ] as const
                  ).map(([key, label, min, max, step]) => (
                    <div key={key}>
                      <div style={styles.groupLabel}>
                        {label}: {water[key].toFixed(2)}
                      </div>
                      <input
                        max={max}
                        min={min}
                        onChange={(e) => {
                          const value = Number(e.target.value);
                          setWater((prev) => ({ ...prev, [key]: value }));
                          actions.setWater({ [key]: value });
                        }}
                        step={step}
                        type="range"
                        value={water[key]}
                      />
                    </div>
                  ))}
                  <div style={styles.groupLabel}>WATER GLINT: {water.glint.toFixed(2)}</div>
                  <input
                    max={5}
                    min={0}
                    onChange={(e) => {
                      const glint = Number(e.target.value);
                      setWater((prev) => ({ ...prev, glint }));
                      actions.setWater({ glint });
                    }}
                    step={0.1}
                    type="range"
                    value={water.glint}
                  />
                  <div style={styles.groupLabel}>WATER REFLECTION: {water.reflection.toFixed(2)}</div>
                  <input
                    max={1}
                    min={0}
                    onChange={(e) => {
                      const reflection = Number(e.target.value);
                      setWater((prev) => ({ ...prev, reflection }));
                      actions.setWater({ reflection });
                    }}
                    step={0.01}
                    type="range"
                    value={water.reflection}
                  />
                  <div style={styles.groupLabel}>WATER DARKNESS: {water.darkness.toFixed(2)}</div>
                  <input
                    max={1}
                    min={0}
                    onChange={(e) => {
                      const darkness = Number(e.target.value);
                      setWater((prev) => ({ ...prev, darkness }));
                      actions.setWater({ darkness });
                    }}
                    step={0.01}
                    type="range"
                    value={water.darkness}
                  />
                </>
              )}
              {capabilities.reflectionPresets && (
                <button
                  onClick={() => {
                    const next =
                      REFLECTION_PRESETS[
                        (REFLECTION_PRESETS.indexOf(reflectionCfg.preset) + 1) % REFLECTION_PRESETS.length
                      ];
                    setReflectionCfg((prev) => ({ ...prev, preset: next }));
                    actions.setVehicleReflection({ preset: next });
                  }}
                  style={styles.actionButton}
                  type="button"
                >
                  Car reflect: {PRESETS[reflectionCfg.preset]?.label ?? 'Off'}
                </button>
              )}
              <div style={styles.groupLabel}>REFLECT INTENSITY: {reflectionCfg.intensity.toFixed(2)}</div>
              <input
                max={3}
                min={0}
                onChange={(e) => {
                  const intensity = Number(e.target.value);
                  setReflectionCfg((prev) => ({ ...prev, intensity }));
                  actions.setVehicleReflection({ intensity });
                }}
                step={0.05}
                type="range"
                value={reflectionCfg.intensity}
              />
            </div>
          )}

          {screen === 'perf' && <PerfPanel actions={actions} />}

          {screen === 'physics' && capabilities.physicsScreen && <PhysicsPanel actions={actions} />}

          {screen === 'cleo' && capabilities.cleoScreen && <CleoPanel actions={actions} />}

          {screen === 'weather' && (
            <div style={styles.group}>
              {actions.weatherList().map((w) => (
                <button
                  key={w.index}
                  onClick={() => {
                    setWeather(w.index);
                    actions.setWeather(w.index);
                  }}
                  style={styles.actionButton}
                  type="button"
                >
                  {weather === w.index ? '● ' : ''}
                  {w.label}
                </button>
              ))}
            </div>
          )}

          {screen === 'map' && capabilities.mapScreen && mapGame && (
            <MapScreen
              actions={actions}
              game={mapGame}
              mapActive={mapActive}
              meshOverrides={capabilities.meshOverrides}
              normals={normals}
              setMapActive={setMapActive}
              setNormals={setNormals}
            />
          )}
        </>
      )}
    </div>
  );
}

function BuildStamp({ buildTime }: { buildTime?: string }): null | ReactElement {
  return buildTime ? <div style={styles.buildTime}>build {buildTime}</div> : null;
}

/** The pak build-time stamp under the title — a small grey line, or nothing when the pak predates the field. */
/** One boolean row on the Camera screen: a checkbox whose label lights up when it is on. */
function CameraToggle({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: (next: boolean) => void;
}): ReactElement {
  return (
    <label style={styles.label}>
      <input checked={checked} onChange={() => onToggle(!checked)} style={styles.radio} type="checkbox" />
      <span style={checked ? styles.optionActive : styles.option}>{label}</span>
    </label>
  );
}

/** The Map debug screen: normals override + the map viewer (extracted to keep the panel's render simple). */
function MapScreen({
  actions,
  game,
  mapActive,
  meshOverrides,
  normals,
  setMapActive,
  setNormals,
}: {
  actions: DebugActions;
  game: MapGame;
  mapActive: boolean;
  meshOverrides: boolean;
  normals: boolean;
  setMapActive: (update: (previous: boolean) => boolean) => void;
  setNormals: (value: boolean) => void;
}): ReactElement {
  // Missing-texture highlight (plan 085 row B): repaints the pak's stand-in layers magenta. Engine host
  // only — seeded from the host so the button reflects the dev-build default.
  const [missingTex, setMissingTex] = useState(() => actions.missingTextureHighlight?.() ?? false);

  return (
    <div style={styles.group}>
      <button onClick={() => setMapActive((previous) => !previous)} style={styles.actionButton} type="button">
        {mapActive ? 'Deactivate Map Viewer' : 'Activate Map Viewer'}
      </button>
      {meshOverrides ? (
        <button
          onClick={() => {
            const next = !normals;
            setNormals(next);
            actions.setShowNormals(next);
          }}
          style={styles.actionButton}
          type="button"
        >
          {normals ? 'Hide Normals' : 'Show Normals'}
        </button>
      ) : null}
      {actions.setMissingTextureHighlight ? (
        <button
          onClick={() => {
            const next = !missingTex;
            setMissingTex(next);
            actions.setMissingTextureHighlight?.(next);
          }}
          style={styles.actionButton}
          type="button"
        >
          {missingTex ? 'Missing Textures: magenta ON' : 'Missing Textures: magenta OFF'}
        </button>
      ) : null}
      {!mapActive && <DrawDistanceControls actions={actions} />}
      {mapActive && (
        <button onClick={() => actions.topDownView()} style={styles.actionButton} type="button">
          Top (reset view)
        </button>
      )}
      {mapActive && <MapInspector game={game} />}
    </div>
  );
}

/** The Vehicles screen: filter + one spawn button per model, and the spawn ERROR the button used to eat. */
function VehicleScreen({ actions }: { actions: DebugActions }): ReactElement {
  const [filter, setFilter] = useState('');
  const [plate, setPlate] = useState('');
  const [error, setError] = useState<null | string>(null);

  return (
    <div style={styles.group}>
      <input
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter…"
        style={styles.filterInput}
        type="text"
        value={filter}
      />
      {/* Blank = the placement's own deterministic plate. A value here rides the placement, so a LOD
          respawn re-applies it (plan 082/04) — the eight cells a plate has, longer text is cut. */}
      <input
        maxLength={PLATE_TEXT_LENGTH}
        onChange={(e) => setPlate(e.target.value.toUpperCase())}
        placeholder="Plate (blank = auto)"
        style={styles.filterInput}
        type="text"
        value={plate}
      />
      {actions
        .vehicleModels()
        .filter((model) => model.includes(filter.trim().toLowerCase()))
        .map((model) => (
          <button
            key={model}
            onClick={() => {
              // Never `void` this promise: a spawn failure (a missing `.osm` section, no vehicles.ide row, a
              // model the pack could not convert) used to vanish into an unhandled rejection, and the button
              // simply did nothing. This panel is the only place the user can see why.
              setError(null);
              actions.spawnVehicle(model, plate.trim() || undefined).catch((cause: unknown) => {
                setError(`${model}: ${cause instanceof Error ? cause.message : String(cause)}`);
              });
            }}
            style={styles.actionButton}
            type="button"
          >
            {model.charAt(0).toUpperCase() + model.slice(1)} Spawn
          </button>
        ))}
      {error === null ? null : <div style={styles.info}>⚠ {error}</div>}
      <button onClick={() => actions.flipVehicle()} style={styles.actionButton} type="button">
        Flip vehicle
      </button>
    </div>
  );
}

/** Fog fully saturates at ~1.25× its distance, so pinning fog at lod × this hides the LOD cull edge
 *  (no skyline poking through). Raising draw distance moves fog out with it; the fog slider can only
 *  pull it closer (thicker), never past this — so the edge always stays hidden. */
const FOG_TO_LOD = 0.8;

/** Map draw-distance controls: one Draw Distance slider that drives the LOD ring + couples fog to
 *  hide its cull edge, plus HD-ring and Fog fine-tuning. Reads live config on mount. */
function DrawDistanceControls({ actions }: { actions: DebugActions }): ReactElement {
  const initial = actions.streaming();
  const [lod, setLod] = useState(initial.lodDrawDistance);
  const [hd, setHd] = useState(initial.hdDrawDistance);
  const [fog, setFog] = useState(() => actions.fogDistance());
  const fogMax = Math.round(lod * FOG_TO_LOD);

  return (
    <>
      <div style={styles.groupLabel}>DRAW DISTANCE: {lod} m</div>
      <input
        max={4000}
        min={500}
        onChange={(e) => {
          const next = Number(e.target.value);
          const nextHd = Math.min(hd, next);
          const nextFog = Math.round(next * FOG_TO_LOD);
          setLod(next);
          setHd(nextHd);
          setFog(nextFog);
          actions.setStreaming({ hdDrawDistance: nextHd, lodDrawDistance: next });
          actions.setFogDistance(nextFog); // keep fog saturating at the new cull edge
        }}
        step={100}
        type="range"
        value={lod}
      />
      <div style={styles.groupLabel}>HD DISTANCE: {hd} m</div>
      <input
        max={lod}
        min={100}
        onChange={(e) => {
          const next = Number(e.target.value);
          setHd(next);
          actions.setStreaming({ hdDrawDistance: next });
        }}
        step={50}
        type="range"
        value={hd}
      />
      <div style={styles.groupLabel}>FOG: {fog} m</div>
      <input
        max={fogMax}
        min={100}
        onChange={(e) => {
          const next = Number(e.target.value);
          setFog(next);
          actions.setFogDistance(next);
        }}
        step={50}
        type="range"
        value={fog}
      />
    </>
  );
}

/** Graphics-screen block for the world 2dfx particle effects (plan 044): master toggle + the multiplier
 *  over the distance each system is shipped with (its authored CULLDIST; plan 100/04). */
function WorldEffectsControls(props: {
  effects: EffectsConfig;
  onPatch: (patch: Partial<EffectsConfig>) => void;
}): ReactElement {
  const { effects, onPatch } = props;

  return (
    <>
      <label style={styles.label}>
        <input
          checked={effects.enabled}
          onChange={() => onPatch({ enabled: !effects.enabled })}
          style={styles.radio}
          type="checkbox"
        />
        <span style={effects.enabled ? styles.optionActive : styles.option}>World effects</span>
      </label>
      <div style={styles.groupLabel}>EFFECTS DISTANCE: ×{effects.drawDistanceScale.toFixed(2)}</div>
      <input
        max={4}
        min={0.25}
        onChange={(e) => onPatch({ drawDistanceScale: Number(e.target.value) })}
        step={0.25}
        type="range"
        value={effects.drawDistanceScale}
      />
    </>
  );
}

/** Fog fully saturates at ~1.25× its distance, so pinning fog at lod × this hides the LOD cull edge
 *  (no skyline poking through). Raising draw distance moves fog out with it; the fog slider can only
 *  pull it closer (thicker), never past this — so the edge always stays hidden. */
