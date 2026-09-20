/**
 * Zone/GXT data loaders shared by BOTH game hosts (074/10 reuse-not-duplicate): the three CanvasHost and
 * the own-engine EngineCanvasHost read the same `info.zon` districts and `american.gxt` names.
 */
import { type CityBox, cityFromLevel } from '@opensa/game/zones/city';
import { type AssetFileSystem, type MapZone, parseGxt, parseZones } from '@opensa/renderware';

/** Read map.zon and map its boxes to city AABBs ([] when absent → everything classifies as Countryside). */
export function loadCityBoxes(fs: AssetFileSystem, name: string): CityBox[] {
  const text = fs.getText(name);
  if (text === null) {
    return [];
  }

  return parseZones(text).flatMap((zone) => {
    const city = cityFromLevel(zone.level);

    return city ? [{ city, max: zone.max, min: zone.min }] : [];
  });
}

/** Parse a `.gxt` text archive into a `hash → text` map (null when absent). */
export function loadGxt(fs: AssetFileSystem, name: string): Map<number, string> | null {
  const buffer = fs.get(name);

  return buffer ? parseGxt(buffer) : null;
}

/** Read info.zon's zones ([] when absent). Drives both the desert boxes (by name) and the zone-name HUD. */
export function loadInfoZones(fs: AssetFileSystem, name: string): MapZone[] {
  const text = fs.getText(name);

  return text === null ? [] : parseZones(text);
}
