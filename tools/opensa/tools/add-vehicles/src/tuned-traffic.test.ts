import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ADDED_VEHICLES_DIR } from './loose-files';
import {
  CONFIG_FILE,
  countPaintjobs,
  DEFAULT_TUNED_TRAFFIC,
  readTunedTrafficConfig,
  registerTunedTraffic,
} from './tuned-traffic';

const INI = join('modloader', 'Model_Variations', 'ModelVariations_Vehicles.ini');
const CARMODS = 'mods\nblade, nto_b_l, exh_lr_bl1\npolice, nto_b_l\nend\n';
const IDS = new Map([
  ['bare', 400],
  ['blade', 536],
  ['police', 596],
]);

let root: string;
let game: string;

const iniText = (): string => readFileSync(join(game, INI), 'latin1');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tuned-traffic-'));
  game = join(root, 'game');
  mkdirSync(join(game, 'modloader', 'Model_Variations'), { recursive: true });
  mkdirSync(join(game, 'data'), { recursive: true });
  writeFileSync(join(game, INI), '[Settings]\nEnableLights=1\n', 'latin1');
  writeFileSync(join(game, 'data', 'carmods.dat'), CARMODS, 'latin1');
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('readTunedTrafficConfig', () => {
  describe('negative cases', () => {
    it('is the defaults when the source root has no config', () => {
      expect(readTunedTrafficConfig(root)).toEqual(DEFAULT_TUNED_TRAFFIC);
    });

    it('fills in every field the config leaves out', () => {
      writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ tuningChance: 10 }));

      expect(readTunedTrafficConfig(root)).toEqual({ ...DEFAULT_TUNED_TRAFFIC, tuningChance: 10 });
    });
  });

  describe('positive cases', () => {
    it('folds the exclude list, so a model matches however it was typed', () => {
      writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ exclude: ['POLICE'] }));

      expect(readTunedTrafficConfig(root).exclude).toEqual(['police']);
    });
  });
});

describe('registerTunedTraffic', () => {
  describe('negative cases', () => {
    it('writes nothing when the plugin is not in the build', () => {
      rmSync(join(game, 'modloader'), { recursive: true });

      expect(registerTunedTraffic(game, DEFAULT_TUNED_TRAFFIC, IDS)).toBe(0);
    });

    it('skips a model with neither a paint job nor a part — there is nothing to tune', () => {
      registerTunedTraffic(game, DEFAULT_TUNED_TRAFFIC, IDS);

      expect(iniText()).not.toContain('[bare]');
    });

    it('skips an excluded model', () => {
      registerTunedTraffic(game, { ...DEFAULT_TUNED_TRAFFIC, exclude: ['police'] }, IDS);

      expect(iniText()).not.toContain('[police]');
      expect(iniText()).toContain('[blade]');
    });

    it('skips a car whose whole line is NITRO — nothing it would show is left', () => {
      // `police, nto_b_l` is the shape half the stock table has (`comet, nto_b_l, nto_b_s, nto_b_tw`).
      expect(registerTunedTraffic(game, DEFAULT_TUNED_TRAFFIC, IDS)).toBe(1);

      expect(iniText()).not.toContain('[police]');
    });
  });

  describe('positive cases', () => {
    it("writes the model's own id, its parts and the three keys", () => {
      expect(registerTunedTraffic(game, DEFAULT_TUNED_TRAFFIC, IDS)).toBe(1);
      expect(iniText()).toContain('Global=536,exh_lr_bl1');
      expect(iniText()).toContain('TuningChance=75');
      expect(iniText()).toContain('TuningFullBodykit=1');
      expect(iniText()).toContain('ChangeOnlyParked=0');
    });

    it('keeps the added-car ids a base section already carries — one section, both writers', () => {
      writeFileSync(join(game, INI), '[Settings]\nEnableLights=1\n\n[blade]\nGlobal=536,19001\n', 'latin1');
      registerTunedTraffic(game, DEFAULT_TUNED_TRAFFIC, IDS);

      expect(iniText()).toContain('Global=536,19001,exh_lr_bl1');
    });

    it('leaves the NITRO upgrades out of Global — they show nothing from outside the car', () => {
      registerTunedTraffic(game, DEFAULT_TUNED_TRAFFIC, IDS);

      expect(iniText()).toContain('[blade]');
      expect(iniText()).not.toContain('nto_');
    });

    it('KEEPS a nitro-only car that has paint jobs — the paint is what it shows', () => {
      // The rule, in his words: no section when only nitro is left, but paint jobs are a reason on their own.
      mkdirSync(join(game, ADDED_VEHICLES_DIR), { recursive: true });
      writeFileSync(join(game, ADDED_VEHICLES_DIR, 'police1.txd'), Uint8Array.of(1));

      expect(registerTunedTraffic(game, DEFAULT_TUNED_TRAFFIC, IDS)).toBe(2);
      expect(iniText()).toContain('[police]');
      expect(iniText()).toContain('Global=596,paintjob1');
      expect(iniText()).not.toContain('nto_');
    });

    it('is idempotent', () => {
      registerTunedTraffic(game, DEFAULT_TUNED_TRAFFIC, IDS);
      const once = iniText();
      registerTunedTraffic(game, DEFAULT_TUNED_TRAFFIC, IDS);

      expect(iniText()).toBe(once);
    });

    it('takes a changed config on the next run without touching anything else', () => {
      registerTunedTraffic(game, DEFAULT_TUNED_TRAFFIC, IDS);
      registerTunedTraffic(game, { ...DEFAULT_TUNED_TRAFFIC, tuningChance: 10 }, IDS);

      expect(iniText()).toContain('TuningChance=10');
      expect(iniText()).not.toContain('TuningChance=75');
      expect(iniText()).toContain('Global=536,exh_lr_bl1');
    });
  });
});

describe('an added car gets its OWN section', () => {
  describe('positive cases', () => {
    it("counts a paintjob dictionary that ships LOOSE, which is where an added car's are", () => {
      // 13 of the fleet ship 46 of these; before this they were counted in the archives only, so 19 were
      // never offered and four cars lost all of theirs (their base has none).
      mkdirSync(join(game, ADDED_VEHICLES_DIR), { recursive: true });
      for (const name of ['059veh1.txd', '059veh2.txd', '059veh3.txd']) {
        writeFileSync(join(game, ADDED_VEHICLES_DIR, name), Uint8Array.of(1));
      }

      expect(countPaintjobs(game, ['059veh']).get('059veh')).toBe(3);
    });
  });
});

describe("an added car's section is keyed by ID", () => {
  describe('positive cases', () => {
    it('writes [<id>] under a `### <slot>` caption, where a name binds to nothing', () => {
      // Field 2026-08-20: `[059veh]` left the car untuned in traffic while Transfender tuned it fine. The
      // plugin resolves a section header to a model, and an added car's NAME does not exist yet when it
      // does — the row that gives it one is merged by Mod Loader out of modloader/added-vehicles/.
      writeFileSync(join(game, 'data', 'carmods.dat'), 'mods\n059veh, exh_a_l_059\nend\n', 'latin1');

      registerTunedTraffic(game, DEFAULT_TUNED_TRAFFIC, new Map([['059veh', 19_050]]), new Set(['059veh']));

      const text = iniText();
      expect(text).toContain('### 059veh');
      expect(text).toContain('[19050]');
      expect(text).not.toContain('[059veh]');
    });

    it('leaves a STOCK car keyed by its name — that one resolves, and the file stays readable', () => {
      writeFileSync(join(game, 'data', 'carmods.dat'), 'mods\nblade, exh_lr_bl1\nend\n', 'latin1');

      registerTunedTraffic(game, DEFAULT_TUNED_TRAFFIC, new Map([['blade', 536]]), new Set(['059veh']));

      expect(iniText()).toContain('[blade]');
    });
  });
});
