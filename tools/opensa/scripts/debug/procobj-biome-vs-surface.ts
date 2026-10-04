import type { MapDefinitions } from '@opensa/renderware/parsers/text/types';

import { Vector3 } from '@opensa/math';
import { buildColliders } from '@opensa/renderware/collision/build-colliders';
import { buildCollisionIndex } from '@opensa/renderware/collision/collision-index';
import { groupRulesBySurface } from '@opensa/renderware/map/procobj-scatter';
import { parseProcObj } from '@opensa/renderware/parsers/text/procobj.parser';
import { parseSurfaceNames } from '@opensa/renderware/parsers/text/surfinfo.parser';
import { parseZones } from '@opensa/renderware/parsers/text/zon.parser';
import { readFileSync } from 'node:fs';

import { gameDir, loadMapDefs, openGameArchive } from '../lib/game';

/**
 * **Does BIOME tell the scatter anything SURFACE does not already say?** The go/no-go for plan 011: its rules
 * are keyed by surface, and if a surface's collision area lives in one region anyway then a biome axis is a
 * second name for the same fact. Also prices the slope half separately (face normal.z per surface).
 */
const archive = openGameArchive('original');
const { catalog, instances } = loadMapDefs('original', archive);
const defs: MapDefinitions = { catalog, imgDirs: [], instances, timedCatalog: new Map() };
const index = buildCollisionIndex(archive);
const rules = groupRulesBySurface(parseProcObj(readFileSync(gameDir('original', 'data', 'procobj.dat'), 'utf8')));
const surfaceNames = parseSurfaceNames(readFileSync(gameDir('original', 'data', 'surfinfo.dat'), 'utf8'));
const cities = parseZones(readFileSync(gameDir('original', 'data', 'map.zon'), 'utf8'));
const districts = parseZones(readFileSync(gameDir('original', 'data', 'info.zon'), 'utf8'));

const CITY = ['countryside', 'los santos', 'san fierro', 'las venturas'];
const cityAt = (x: number, y: number): string => {
  for (const zone of cities) {
    if (x >= zone.min[0] && x <= zone.max[0] && y >= zone.min[1] && y <= zone.max[1]) {
      return CITY[zone.level] ?? 'countryside';
    }
  }

  return 'countryside';
};
const districtAt = (x: number, y: number): string => {
  for (const zone of districts) {
    if (x >= zone.min[0] && x <= zone.max[0] && y >= zone.min[1] && y <= zone.max[1]) {
      return zone.label;
    }
  }

  return '(none)';
};

interface SurfaceStat {
  area: number;
  byCity: Map<string, number>;
  byDistrict: Map<string, number>;
  steepArea: number; // normal.z < 0.85 — roughly steeper than 32 degrees
}
const stats = new Map<string, SurfaceStat>();
const add = (map: Map<string, number>, key: string, value: number): void => {
  map.set(key, (map.get(key) ?? 0) + value);
};

const colliders = buildColliders(index, defs, { center: [0, 0, 0], radius: Infinity });
const a = new Vector3();
const b = new Vector3();
const c = new Vector3();
const ab = new Vector3();
const ac = new Vector3();
const normal = new Vector3();
for (const collider of colliders) {
  const { faces, vertices } = collider.col;
  for (const transform of collider.transforms) {
    for (const face of faces) {
      const surface = surfaceNames[face.material];
      if (surface === undefined || !rules.has(surface)) {
        continue;
      }
      a.fromArray(vertices, face.a * 3).applyMatrix4(transform);
      b.fromArray(vertices, face.b * 3).applyMatrix4(transform);
      c.fromArray(vertices, face.c * 3).applyMatrix4(transform);
      normal.copy(ab.subVectors(b, a)).cross(ac.subVectors(c, a));
      const area = normal.length() / 2;
      if (area < 1e-6) {
        continue;
      }
      normal.normalize();
      const slope = Math.abs(normal.z);
      const x = (a.x + b.x + c.x) / 3;
      const y = (a.y + b.y + c.y) / 3;
      let stat = stats.get(surface);
      if (!stat) {
        stat = { area: 0, byCity: new Map(), byDistrict: new Map(), steepArea: 0 };
        stats.set(surface, stat);
      }
      stat.area += area;
      if (slope < 0.85) {
        stat.steepArea += area;
      }
      add(stat.byCity, cityAt(x, y), area);
      add(stat.byDistrict, districtAt(x, y), area);
    }
  }
}

const pct = (part: number, whole: number): string => `${((100 * part) / Math.max(1e-9, whole)).toFixed(1)} %`;
const ranked = [...stats].sort((left, right) => right[1].area - left[1].area);
console.log(`\n${ranked.length} rule-bearing surfaces with collision area, by area:\n`);
console.log('surface              area (m2)   dominant region        top districts (share of the surface)   steep');
for (const [surface, stat] of ranked) {
  const city = [...stat.byCity].sort((l, r) => r[1] - l[1]);
  const top = [...stat.byDistrict]
    .sort((l, r) => r[1] - l[1])
    .slice(0, 3)
    .map(([label, area]) => `${label} ${pct(area, stat.area)}`)
    .join(', ');
  console.log(
    `${surface.padEnd(20)} ${stat.area.toFixed(0).padStart(9)}   ` +
      `${(city[0]?.[0] ?? '-').padEnd(13)} ${pct(city[0]?.[1] ?? 0, stat.area).padStart(6)}   ${top.padEnd(38)} ${pct(stat.steepArea, stat.area)}`,
  );
}

console.log('\nThe reverse question — what each region is MADE OF (share of its rule-bearing area):\n');
const byCity = new Map<string, Map<string, number>>();
for (const [surface, stat] of stats) {
  for (const [city, area] of stat.byCity) {
    const row = byCity.get(city) ?? new Map<string, number>();
    add(row, surface, area);
    byCity.set(city, row);
  }
}
for (const [city, row] of [...byCity].sort(
  (l, r) => [...r[1].values()].reduce((s, v) => s + v, 0) - [...l[1].values()].reduce((s, v) => s + v, 0),
)) {
  const total = [...row.values()].reduce((sum, v) => sum + v, 0);
  const top = [...row]
    .sort((l, r) => r[1] - l[1])
    .slice(0, 5)
    .map(([surface, area]) => `${surface} ${pct(area, total)}`)
    .join(' · ');
  console.log(`  ${city.padEnd(13)} ${total.toFixed(0).padStart(10)} m2   ${top}`);
}
