import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyModelVariations,
  mergeIniKeys,
  mergeIniSection,
  MODEL_VARIATIONS_EXTRA_FILE,
  MODEL_VARIATIONS_INI,
  parseIniSections,
  resolvePlaceholders,
} from './model-variations';
import { VEH_MODS_IDE } from './tuning-parts';

/** The tug's file, as the mod ships it (2026-08-19) — the census subject. */
const TUG = `[tug]
Trailers1={{bagboxa}},{{bagboxb}},{{tugstair}}
Global=Trailers1
TrailersSpawnChance=95
`;

/** The plugin's ini as mod 11 ships it: `[Settings]` and nothing else. */
const STOCK_INI = `[Settings]
ChangeCarGenerators=0
ExcludeCarGeneratorModels=492,600
`;

/** The three trailers the tug tows, in the `vehicles.ide` shape. */
const VEHICLES_IDE = `cars
606, bagboxa, bagboxa, car, BAGBOXA, BAGBOXA, null, ignore, 4, 0, 0, -1, 0.7, 0.7, 0
607, bagboxb, bagboxb, car, BAGBOXB, BAGBOXB, null, ignore, 4, 0, 0, -1, 0.7, 0.7, 0
608, tugstair, tugstair, car, TUGSTAIR, TUGSTAIR, null, ignore, 4, 0, 0, -1, 0.7, 0.7, 0
end
`;

/** The tug's file, resolved against {@link VEHICLES_IDE}. */
const TUG_RESOLVED = ['[tug]', 'Trailers1=606,607,608', 'Global=Trailers1', 'TrailersSpawnChance=95'].join('\n');

const noop = (): void => undefined;

let root: string;
let folder: string;
let out: string;

const iniText = (): string => readFileSync(join(out, MODEL_VARIATIONS_INI), 'latin1');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vehicle-installer-mv-'));
  folder = join(root, 'tug - Clark CT-50D Tug - smart');
  out = join(root, 'out');
  mkdirSync(folder, { recursive: true });
  mkdirSync(join(out, 'data', 'maps', 'veh_mods'), { recursive: true });
  writeFileSync(join(out, 'data', 'vehicles.ide'), VEHICLES_IDE);
  writeFileSync(join(out, VEH_MODS_IDE), 'objs\nend\n');
  mkdirSync(join(out, 'modloader', 'Model_Variations'), { recursive: true });
  writeFileSync(join(out, MODEL_VARIATIONS_INI), STOCK_INI);
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('parseIniSections', () => {
  describe('negative cases', () => {
    it('drops lines before the first header — a mod ships sections, not a preamble', () => {
      expect(parseIniSections('Global=1\n[tug]\nTrailersSpawnChance=95\n')).toEqual([
        { lines: ['TrailersSpawnChance=95'], name: 'tug' },
      ]);
    });
  });

  describe('positive cases', () => {
    it('reads one section with its lines', () => {
      expect(parseIniSections(TUG)).toEqual([
        {
          lines: ['Trailers1={{bagboxa}},{{bagboxb}},{{tugstair}}', 'Global=Trailers1', 'TrailersSpawnChance=95'],
          name: 'tug',
        },
      ]);
    });

    it('reads several sections and ignores blank lines', () => {
      expect(parseIniSections('[a]\nx=1\n\n[b]\n\ny=2\n').map(({ name }) => name)).toEqual(['a', 'b']);
    });
  });
});

describe('resolvePlaceholders', () => {
  describe('negative cases', () => {
    it('reports an unknown model and keeps the placeholder — the CALLER decides what to drop', () => {
      const missing: string[] = [];
      const line = resolvePlaceholders('Trailers1={{205veh}}', new Map(), (name) => missing.push(name));

      expect(line).toBe('Trailers1={{205veh}}');
      expect(missing).toEqual(['205veh']);
    });
  });

  describe('positive cases', () => {
    it('substitutes every placeholder with its id, case-insensitively', () => {
      const names = new Map([
        ['bagboxa', 606],
        ['tugstair', 608],
      ]);

      expect(resolvePlaceholders('Trailers1={{BagboxA}},{{tugstair}}', names, noop)).toBe('Trailers1=606,608');
    });
  });
});

describe('mergeIniSection', () => {
  describe('positive cases', () => {
    it('appends a section the file does not have, leaving the rest byte-identical', () => {
      const merged = mergeIniSection(STOCK_INI, { lines: ['Global=Trailers1'], name: 'tug' });

      expect(merged.startsWith(STOCK_INI.trimEnd())).toBe(true);
      expect(merged).toContain('\n[tug]\nGlobal=Trailers1\n');
    });

    it('replaces a section that is already there, and only that section', () => {
      const first = mergeIniSection(`${STOCK_INI}\n[tug]\nGlobal=old\n\n[petro]\nGlobal=kept\n`, {
        lines: ['Global=new'],
        name: 'tug',
      });

      expect(first).toContain('[tug]\nGlobal=new');
      expect(first).not.toContain('Global=old');
      expect(first).toContain('[petro]\nGlobal=kept');
      expect(first).toContain('ExcludeCarGeneratorModels=492,600');
    });

    it('is idempotent — merging the same section twice writes the same bytes', () => {
      const once = mergeIniSection(STOCK_INI, { lines: ['Global=Trailers1'], name: 'tug' });

      expect(mergeIniSection(once, { lines: ['Global=Trailers1'], name: 'tug' })).toBe(once);
    });

    it('keeps the file CRLF when that is what it uses', () => {
      const merged = mergeIniSection('[Settings]\r\nEnableLights=1\r\n', { lines: ['Global=1'], name: 'tug' });

      expect(merged).toBe('[Settings]\r\nEnableLights=1\r\n\r\n[tug]\r\nGlobal=1\r\n');
    });
  });
});

describe('applyModelVariations', () => {
  describe('negative cases', () => {
    it('warns and writes nothing when the plugin is not in the build', () => {
      rmSync(join(out, 'modloader'), { force: true, recursive: true });
      writeFileSync(join(folder, MODEL_VARIATIONS_EXTRA_FILE), TUG);

      const warnings = applyModelVariations(folder, [MODEL_VARIATIONS_EXTRA_FILE], out);

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/ModelVariations 10\.7 is not in this build/);
      expect(existsSync(join(out, MODEL_VARIATIONS_INI))).toBe(false);
    });

    it("refuses to write the plugin's own [Settings] from a mod folder", () => {
      writeFileSync(join(folder, MODEL_VARIATIONS_EXTRA_FILE), '[Settings]\nEnableLights=0\n');

      const warnings = applyModelVariations(folder, [MODEL_VARIATIONS_EXTRA_FILE], out);

      expect(warnings[0]).toMatch(/\[Settings\] is the plugin's own block/);
      expect(iniText()).toBe(STOCK_INI);
    });

    it('drops the trailer no IDE defines and keeps the ones that resolve', () => {
      writeFileSync(join(folder, MODEL_VARIATIONS_EXTRA_FILE), '[petro]\nTrailers1=584,{{petrotr}},{{211veh}}\n');

      const warnings = applyModelVariations(folder, [MODEL_VARIATIONS_EXTRA_FILE], out);

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/Trailers1 drops 'petrotr', '211veh'/);
      expect(iniText()).toContain('Trailers1=584');
      expect(iniText()).not.toContain('{{');
    });

    it('drops a bracket CHAIN whole when one of its links is missing — half a road train is not one', () => {
      writeFileSync(
        join(folder, MODEL_VARIATIONS_EXTRA_FILE),
        '[rdtrain]\nTrailers1=[{{bagboxa}}-{{205veh}}]\nTrailersSpawnChance=80\n',
      );

      const warnings = applyModelVariations(folder, [MODEL_VARIATIONS_EXTRA_FILE], out);

      expect(warnings[0]).toMatch(/Trailers1 names only '205veh'.*the key is dropped/);
      expect(iniText()).not.toContain('Trailers1');
      expect(iniText()).toContain('TrailersSpawnChance=80');
    });

    it('drops a Global reference to a key that went, and Global itself when nothing is left', () => {
      writeFileSync(
        join(folder, MODEL_VARIATIONS_EXTRA_FILE),
        '[rdtrain]\nTrailers1=[{{205veh}}-{{206veh}}]\nGlobal=Trailers1\nTrailersSpawnChance=80\n',
      );

      const warnings = applyModelVariations(folder, [MODEL_VARIATIONS_EXTRA_FILE], out);

      expect(warnings.some((warning) => /Global referenced only dropped key\(s\)/.test(warning))).toBe(true);
      expect(iniText()).not.toContain('Global=');
      expect(iniText()).toContain('TrailersSpawnChance=80');
    });
  });

  describe('positive cases', () => {
    it('does nothing at all when the folder ships no such file', () => {
      expect(applyModelVariations(folder, ['tug.dff'], out)).toEqual([]);
      expect(iniText()).toBe(STOCK_INI);
    });

    it("merges the tug's section with every trailer resolved to its id", () => {
      writeFileSync(join(folder, MODEL_VARIATIONS_EXTRA_FILE), TUG);

      expect(applyModelVariations(folder, [MODEL_VARIATIONS_EXTRA_FILE], out)).toEqual([]);
      expect(iniText()).toContain(TUG_RESOLVED);
      expect(iniText()).toContain('ChangeCarGenerators=0');
    });

    it('keeps a resolving line exactly as authored — spacing included', () => {
      writeFileSync(join(folder, MODEL_VARIATIONS_EXTRA_FILE), '[tug]\nTrailers1=606,  607 , 608\nGlobal=Trailers1\n');

      expect(applyModelVariations(folder, [MODEL_VARIATIONS_EXTRA_FILE], out)).toEqual([]);
      expect(iniText()).toContain('Trailers1=606,  607 , 608');
    });

    it('is idempotent — a rebake over the same mod changes nothing', () => {
      writeFileSync(join(folder, MODEL_VARIATIONS_EXTRA_FILE), TUG);
      applyModelVariations(folder, [MODEL_VARIATIONS_EXTRA_FILE], out);
      const once = iniText();
      applyModelVariations(folder, [MODEL_VARIATIONS_EXTRA_FILE], out);

      expect(iniText()).toBe(once);
    });
  });
});

/** The mod's own file, straight out of `mods-src` (`npm run test:fixtures`) — the shape nothing else proves. */
const REAL_TUG = join(process.cwd(), 'fixtures', 'original', 'vehicles', 'tug-variations.txt');

describe.skipIf(!existsSync(REAL_TUG))('model-variations-extra.txt (the real tug file)', () => {
  describe('positive cases', () => {
    it('is one section addressing its three trailers as placeholders', () => {
      const [section, ...rest] = parseIniSections(readFileSync(REAL_TUG, 'latin1'));

      expect(rest).toEqual([]);
      expect(section.name).toBe('tug');
      expect(section.lines).toContain('Trailers1={{bagboxa}},{{bagboxb}},{{tugstair}}');
      expect(section.lines).toContain('Global=Trailers1');
    });

    it('resolves against the stock ids the game ships those trailers under', () => {
      const names = new Map([
        ['bagboxa', 606],
        ['bagboxb', 607],
        ['tugstair', 608],
      ]);
      const [section] = parseIniSections(readFileSync(REAL_TUG, 'latin1'));
      const lines = section.lines.map((line) => resolvePlaceholders(line, names, noop));

      expect(lines).toContain('Trailers1=606,607,608');
    });
  });
});

describe('a section caption', () => {
  describe('negative cases', () => {
    it('is not added to a section that already exists — only a NEW one is captioned', () => {
      const text = mergeIniKeys('[536]\nGlobal=536\n', '536', new Map([['Global', '536,19110']]), '### blade');

      expect(text).not.toContain('### blade');
      expect(text).toContain('Global=536,19110');
    });
  });

  describe('positive cases', () => {
    it('names the model an ID-keyed section belongs to, so the file stays readable', () => {
      const text = mergeIniKeys('[Settings]\nEnableLights=1\n', '536', new Map([['Global', '536,19110']]), '### blade');

      expect(text).toContain('### blade\n[536]\nGlobal=536,19110');
    });
  });
});
