import type * as Renderware from '@opensa/renderware';

import { encodeOscol } from '@opensa/engine-formats';
import { Matrix4 } from '@opensa/math';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BakedCollisionSource } from './baked-collision';

import { GtaSaWorldAdapter, toModelColliders, tyreAdhesionPerMaterial } from './gta-sa-world.adapter';

/** The map `resolveMap` is stubbed to return — mutable so a test can place a different catalog. */
const map = vi.hoisted(() => ({ current: null as null | Renderware.MapDefinitions }));

function defaultMap(): Renderware.MapDefinitions {
  return {
    carGenerators: [
      {
        alarm: 0,
        angle: 1,
        doorLock: 0,
        forceSpawn: 0,
        id: 400,
        position: [10, 20, 3],
        primaryColor: -1,
        secondaryColor: -1,
      },
      {
        alarm: 0,
        angle: 2,
        doorLock: 0,
        forceSpawn: 0,
        id: -1,
        position: [-50, -50, 5],
        primaryColor: -1,
        secondaryColor: -1,
      },
    ],
    catalog: new Map([[1, { drawDistance: 300, flags: 0, id: 1, modelName: 'house', txdName: 'txd' }]]),
    imgDirs: [],
    instances: [{ id: 1, interior: 0, lod: -1, modelName: '', position: [10, 10, 0], rotation: [0, 0, 0, 1] }],
  };
}

// Stub the map resolution; keep grid/cell builders real. The adapter reads everything from the VFS now.
vi.mock('@opensa/renderware', async (importActual) => {
  const actual = await importActual<typeof Renderware>();

  return {
    ...actual,
    resolveMap: (): Renderware.MapDefinitions => map.current ?? defaultMap(),
  };
});

afterEach(() => {
  map.current = null;
});

function cfg(): ConstructorParameters<typeof GtaSaWorldAdapter>[0] {
  return { cellSize: 250, fs: fakeFs() };
}

function colModel(partial: Partial<Renderware.ColModel>): Renderware.ColModel {
  return {
    bounds: { center: [0, 0, 0], max: [0, 0, 0], min: [0, 0, 0], radius: 0 },
    boxes: [],
    faces: [],
    modelId: 0,
    name: 'col',
    spheres: [],
    version: 2,
    vertices: new Float32Array(),
    ...partial,
  };
}

/** Empty asset file system — the map comes from the mocked resolveMap; optional data files are absent. */
function fakeFs(): Renderware.AssetFileSystem {
  return { get: () => null, getText: () => null, has: () => false, names: [] };
}

const SURFACE = { brightness: 0, flag: 0, light: 0, material: 0 };

/** A file system serving the three vehicle-data files `ensureVehicleData` requires. */
function vehicleFs(carcols: string): Renderware.AssetFileSystem {
  const files: Record<string, string> = {
    'data/carcols.dat': carcols,
    'data/handling.cfg': '',
    'data/vehicles.ide': '',
  };

  return { get: () => null, getText: (name) => files[name] ?? null, has: (name) => name in files, names: [] };
}

describe('GtaSaWorldAdapter.vehicleColourCombos', () => {
  const CARCOLS = [
    'col',
    '0,0,0',
    '10,20,30',
    '40,50,60',
    'end',
    'car',
    'testcar, 1,2, 2,1',
    'end',
    'car4',
    'quadcar, 0,1,2,1',
    'end',
  ].join('\n');
  const adapter = (): GtaSaWorldAdapter => new GtaSaWorldAdapter({ cellSize: 250, fs: vehicleFs(CARCOLS) });

  describe('negative cases', () => {
    it('returns empty for a car with no carcols entry', async () => {
      expect(await adapter().vehicleColourCombos('nope')).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('returns the car own 2-colour combos in order (case-insensitive)', async () => {
      expect(await adapter().vehicleColourCombos('TestCar')).toEqual([
        [1, 2],
        [2, 1],
      ]);
    });

    it('includes 4-colour combos', async () => {
      expect(await adapter().vehicleColourCombos('quadcar')).toEqual([[0, 1, 2, 1]]);
    });
  });
});

describe('toModelColliders', () => {
  describe('negative cases', () => {
    it('produces empty shape arrays for a model with no geometry', () => {
      const result = toModelColliders({ col: colModel({}), name: 'empty', transforms: [] });

      expect(result.name).toBe('empty');
      expect(result.shape.indices).toHaveLength(0);
      expect(result.shape.boxes).toEqual([]);
      expect(result.shape.spheres).toEqual([]);
      expect(result.transforms).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('flattens faces into a triangle index array and passes vertices through', () => {
      const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
      const col = colModel({
        faces: [
          { a: 0, b: 1, c: 2, light: 0, material: 0 },
          { a: 2, b: 3, c: 0, light: 0, material: 0 },
        ],
        vertices,
      });

      const result = toModelColliders({ col, name: 'wall', transforms: [new Matrix4()] });
      expect(Array.from(result.shape.indices)).toEqual([0, 1, 2, 2, 3, 0]);
      expect(result.shape.vertices).toBe(vertices); // passthrough, not copied
      expect(result.transforms).toHaveLength(1);
    });

    it('maps box and sphere primitives, each keeping its own surface id', () => {
      const col = colModel({
        boxes: [{ max: [1, 1, 1], min: [-1, -1, -1], surface: { ...SURFACE, material: 26 } }],
        spheres: [{ center: [0, 0, 2], radius: 0.5, surface: { ...SURFACE, material: 33 } }],
      });

      const result = toModelColliders({ col, name: 'prop', transforms: [] });
      expect(result.shape.boxes).toEqual([{ material: 26, max: [1, 1, 1], min: [-1, -1, -1] }]);
      expect(result.shape.spheres).toEqual([{ center: [0, 0, 2], material: 33, radius: 0.5 }]);
    });

    it('carries one surface id per TRIANGLE, in index order (plan 081/10)', () => {
      const col = colModel({
        faces: [
          { a: 0, b: 1, c: 2, light: 0, material: 1 }, // tarmac
          { a: 2, b: 3, c: 0, light: 0, material: 33 }, // sand_beach
        ],
        vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]),
      });

      const result = toModelColliders({ col, name: 'road', transforms: [] });

      expect(Array.from(result.shape.materials ?? [])).toEqual([1, 33]);
      expect(result.shape.materials).toHaveLength(result.shape.indices.length / 3);
    });
  });
});

describe('GtaSaWorldAdapter.modelIndex', () => {
  describe('negative cases', () => {
    it('is null before prepare — there are no definitions to search yet', () => {
      expect(new GtaSaWorldAdapter(cfg()).modelIndex()).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('searches the same definitions the map was built from, and is built once', async () => {
      const adapter = new GtaSaWorldAdapter(cfg());
      await adapter.prepare();

      const index = adapter.modelIndex();
      expect(index?.search('hou')).toEqual([{ count: 1, name: 'house' }]);
      expect(adapter.modelIndex()).toBe(index);
    });
  });
});

describe('GtaSaWorldAdapter cell streaming', () => {
  describe('negative cases', () => {
    it('throws when loadCellColliders is called before prepare', async () => {
      await expect(new GtaSaWorldAdapter(cfg()).loadCellColliders(0, 0)).rejects.toThrow();
    });
  });

  describe('positive cases', () => {
    it('exposes the configured cell size', () => {
      expect(new GtaSaWorldAdapter(cfg()).cellSize).toBe(250);
    });

    it('caches a cell’s colliders (same array on repeat loads)', async () => {
      const adapter = new GtaSaWorldAdapter(cfg());
      await adapter.prepare();

      const first = await adapter.loadCellColliders(0, 0);
      const second = await adapter.loadCellColliders(0, 0);

      expect(second).toBe(first);
    });
  });
});

describe('GtaSaWorldAdapter baked collision (200/3-01)', () => {
  /** One baked cell, as the pak would hand it over: a region no COL in this fixture could produce, so a
   *  collider named `baked_road` proves the bytes came from the pak and not from a parse. */
  const bakedCell = (): Uint8Array =>
    encodeOscol({
      regions: [
        {
          boxes: [],
          indices: Uint32Array.from([0, 1, 2]),
          materials: Uint8Array.from([13]),
          name: 'baked_road',
          spheres: [],
          transforms: [Float32Array.from(new Matrix4().setPosition(4, 5, 6).elements)],
          vertices: Float32Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0]),
        },
      ],
    });

  function source(overrides: Partial<BakedCollisionSource> = {}): BakedCollisionSource & { reads: string[] } {
    const reads: string[] = [];

    return {
      cellSize: 250,
      has: (): boolean => true,
      read: async (cx, cy): Promise<null | Uint8Array> => {
        reads.push(`${cx},${cy}`);

        return Promise.resolve(bakedCell());
      },
      reads,
      ...overrides,
    };
  }

  describe('negative cases', () => {
    it('refuses a bake keyed on a different grid than collision streams on', () => {
      // The silent trap: 250 vs 256 hands back a NEIGHBOURING cell's colliders, and the world still renders.
      expect(() => new GtaSaWorldAdapter({ ...cfg(), bakedCollision: source({ cellSize: 256 }) })).toThrow(
        /256-unit grid but collision streams on 250/,
      );
    });

    it('never reads the pak for a cell the bake does not cover', async () => {
      const baked = source({ has: (): boolean => false });
      const adapter = new GtaSaWorldAdapter({ ...cfg(), bakedCollision: baked });
      await adapter.prepare();

      expect(await adapter.loadCellColliders(0, 0)).toEqual([]);
      expect(baked.reads).toEqual([]);
    });

    it('falls back to parsing COL when the read fails, rather than leaving the cell without collision', async () => {
      const baked = source({ read: async (): Promise<null> => Promise.resolve(null) });
      const adapter = new GtaSaWorldAdapter({ ...cfg(), bakedCollision: baked });
      await adapter.prepare();

      expect(await adapter.loadCellColliders(0, 0)).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('builds the cell from the pak’s bake instead of the archive', async () => {
      const baked = source();
      const adapter = new GtaSaWorldAdapter({ ...cfg(), bakedCollision: baked });
      await adapter.prepare();

      const models = await adapter.loadCellColliders(2, -3);

      expect(models.map((model) => model.name)).toEqual(['baked_road']);
      expect(models[0].shape.materials).toEqual(Uint8Array.from([13]));
      expect(models[0].transforms[0].elements.slice(12, 15)).toEqual([4, 5, 6]);
      expect(baked.reads).toEqual(['2,-3']);
    });

    it('never opens the archive for a baked cell — the bake already decided what shatters', async () => {
      // The breakable gate is the last archive read the collision path had (it parses a model's DFF looking
      // for a shatter mesh). On a baked cell it must not happen at all, or the bake buys a parse and pays
      // for it with another.
      const opened: string[] = [];
      const fs: Renderware.AssetFileSystem = {
        get: (name) => {
          opened.push(name);

          return null;
        },
        getText: () => null,
        has: () => false,
        names: [],
      };
      const adapter = new GtaSaWorldAdapter({ bakedCollision: source(), cellSize: 250, fs });
      await adapter.prepare();
      opened.length = 0;

      await adapter.loadCellColliders(0, 0);

      expect(opened).toEqual([]);
    });

    it('reads a cell ONCE even when two callers ask while the pak read is in flight', async () => {
      const baked = source();
      const adapter = new GtaSaWorldAdapter({ ...cfg(), bakedCollision: baked });
      await adapter.prepare();

      const [first, second] = await Promise.all([adapter.loadCellColliders(0, 0), adapter.loadCellColliders(0, 0)]);

      expect(second).toBe(first);
      expect(baked.reads).toEqual(['0,0']);
    });
  });
});

const VEHICLES_IDE = [
  'cars',
  '400, landstal, landstal, car, LANDSTAL, LANDSTAL, null, normal, 10, 0, 0, 169, 0.82, 0.82, -1',
  '489, rancher, rancher, car, RANCHER, RANCHER, null, normal, 7, 0, 0, 191, 0.85, 0.85, -1',
  'end',
].join('\n');

/** cargrp with the 18 `POPCYCLE_GROUP_*` lines; the Workers group (index 0) holds `rancher`. */
function cargrpText(): string {
  const names = [
    'WORKERS',
    'BUSINESS',
    'CLUBBERS',
    'FARMERS',
    'BEACHFOLK',
    'PARKFOLK',
    'CASUAL_RICH',
    'CASUAL_AVERAGE',
    'CASUAL_POOR',
    'PROSTITUTES',
    'CRIMINALS',
    'GOLFERS',
    'SERVANTS',
    'AIRCREW',
    'ENTERTAINERS',
    'OUT_OF_TOWN_FACTORY',
    'DESERT_FOLK',
    'AIRCREW_RUNWAY',
  ];

  return names.map((name, i) => `${i === 0 ? 'rancher' : `car${i}`}  # POPCYCLE_GROUP_${name}`).join('\n');
}

/** A file system serving vehicles.ide/carcols/handling, plus any extra data files (popcycle/cargrp). */
function dataFs(extra: Record<string, string> = {}): Renderware.AssetFileSystem {
  const files: Record<string, string> = {
    'data/carcols.dat': '',
    'data/handling.cfg': '',
    'data/vehicles.ide': VEHICLES_IDE,
    ...extra,
  };

  return { get: () => null, getText: (name) => files[name] ?? null, has: (name) => name in files, names: [] };
}

/** popcycle with a COUNTRYSIDE block whose weekday slot 0 weights only the Workers group (index 0). */
function popcycleText(): string {
  const weights = Array.from({ length: 18 }, (_, i) => (i === 0 ? 100 : 0)).join(' ');

  return ['//////', '// COUNTRYSIDE', '//////', '// Weekday', `  2 6 100 100 100 100  ${weights}  // Midnight`].join(
    '\n',
  );
}

describe('GtaSaWorldAdapter.mapCarGenerators', () => {
  describe('negative cases', () => {
    it('returns only the specific-model generators when popcycle/cargrp are absent', async () => {
      const adapter = new GtaSaWorldAdapter({ cellSize: 250, fs: dataFs() });
      await adapter.prepare();

      const out = await adapter.mapCarGenerators({ cityAt: () => 'COUNTRYSIDE', hour: 0 });

      expect(out.map((placement) => placement.model)).toEqual(['landstal']); // id 400 → landstal; id=-1 dropped
      expect(out[0].heading).toBe(1); // heading from the IPL angle
    });
  });

  describe('positive cases', () => {
    it('resolves specific + random (popcycle → cargrp) generators', async () => {
      const adapter = new GtaSaWorldAdapter({
        cellSize: 250,
        fs: dataFs({ 'data/cargrp.dat': cargrpText(), 'data/popcycle.dat': popcycleText() }),
      });
      await adapter.prepare();

      const out = await adapter.mapCarGenerators({ cityAt: () => 'COUNTRYSIDE', hour: 0 });

      // id 400 → landstal (specific); id -1 in COUNTRYSIDE → Workers group → rancher (random).
      expect(out.map((placement) => placement.model).sort()).toEqual(['landstal', 'rancher']);
    });
  });
});

/** A text-only file system serving exactly the given loose data files. */
function textFs(files: Record<string, string>): Renderware.AssetFileSystem {
  return {
    get: () => null,
    getText: (name) => files[name] ?? null,
    has: (name) => name in files,
    names: Object.keys(files),
  };
}

describe('GtaSaWorldAdapter.animatedPlacements', () => {
  describe('negative cases', () => {
    it('reports nothing before prepare resolved the map', () => {
      expect(new GtaSaWorldAdapter(cfg()).animatedPlacements()).toEqual([]);
    });

    it('skips placed objects whose catalog def carries no anim (the map is mostly static)', async () => {
      const adapter = new GtaSaWorldAdapter(cfg());
      await adapter.prepare();

      expect(adapter.animatedPlacements()).toEqual([]); // the default map's `house` has no anim
    });
  });

  describe('positive cases', () => {
    it('reports every anim-carrying placement with its IPL pose verbatim (no axis change here)', async () => {
      map.current = {
        catalog: new Map([
          [1, { anim: 'windmill', drawDistance: 300, flags: 0, id: 1, modelName: 'mill', txdName: 'millt' }],
          [2, { drawDistance: 300, flags: 0, id: 2, modelName: 'house', txdName: 'txd' }],
        ]),
        imgDirs: [],
        instances: [
          { id: 1, interior: 0, lod: -1, modelName: 'mill', position: [1, 2, 3], rotation: [0, 0, 0.5, 0.5] },
          { id: 2, interior: 0, lod: -1, modelName: 'house', position: [9, 9, 9], rotation: [0, 0, 0, 1] },
        ],
      };
      const adapter = new GtaSaWorldAdapter(cfg());
      await adapter.prepare();

      expect(adapter.animatedPlacements()).toEqual([
        { anim: 'windmill', modelName: 'mill', position: [1, 2, 3], rotation: [0, 0, 0.5, 0.5], txdName: 'millt' },
      ]);
    });
  });
});

describe('GtaSaWorldAdapter.txdOf', () => {
  describe('negative cases', () => {
    it('is undefined before prepare (nothing is catalogued yet)', () => {
      expect(new GtaSaWorldAdapter(cfg()).txdOf('house')).toBeUndefined();
    });

    it('is undefined for a model the catalog does not know', async () => {
      const adapter = new GtaSaWorldAdapter(cfg());
      await adapter.prepare();

      expect(adapter.txdOf('nosuchmodel')).toBeUndefined();
    });
  });

  describe('positive cases', () => {
    it('resolves a model TXD case-insensitively (shard texturing reads it by render name)', async () => {
      const adapter = new GtaSaWorldAdapter(cfg());
      await adapter.prepare();

      expect(adapter.txdOf('HOUSE')).toBe('txd');
    });
  });
});

describe('GtaSaWorldAdapter cleo model resolution', () => {
  describe('negative cases', () => {
    it('is null before prepare and for an id nothing carries', async () => {
      expect(new GtaSaWorldAdapter(cfg()).cleoModelById(1)).toBeNull();
      const adapter = new GtaSaWorldAdapter(cfg());
      await adapter.prepare();

      expect(adapter.cleoModelById(99999)).toBeNull();
      expect(adapter.cleoModelIdByName('nosuchmodel')).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('resolves an IDE object id to its model + txd + draw distance', async () => {
      const adapter = new GtaSaWorldAdapter(cfg());
      await adapter.prepare();

      expect(adapter.cleoModelById(1)).toEqual({ drawDistance: 300, modelName: 'house', txdName: 'txd' });
    });

    it('resolves a model NAME to its id case-insensitively (GET_MODEL_BY_NAME gives names)', async () => {
      const adapter = new GtaSaWorldAdapter(cfg());
      await adapter.prepare();

      expect(adapter.cleoModelIdByName('HOUSE')).toBe(1);
    });
  });
});

describe('GtaSaWorldAdapter.breakableInfo', () => {
  const OBJECT_DAT = 'lamppost1, 200.0, 300.0, 0.99, 0.1, 20.0, 240.0, 0.5, 200, 0, 0';

  describe('negative cases', () => {
    it('is undefined when object.dat is absent (props still break at the default threshold)', async () => {
      const adapter = new GtaSaWorldAdapter(cfg());
      await adapter.prepare();

      expect(adapter.breakableInfo('lamppost1')).toBeUndefined();
    });

    it('is undefined for a model object.dat does not tune', async () => {
      const adapter = new GtaSaWorldAdapter({ cellSize: 250, fs: textFs({ 'data/object.dat': OBJECT_DAT }) });
      await adapter.prepare();

      expect(adapter.breakableInfo('bin1')).toBeUndefined();
    });
  });

  describe('positive cases', () => {
    it('reports the uproot limit and damage effect case-insensitively', async () => {
      const adapter = new GtaSaWorldAdapter({ cellSize: 250, fs: textFs({ 'data/object.dat': OBJECT_DAT }) });
      await adapter.prepare();

      const entry = adapter.breakableInfo('LampPost1');
      expect(entry?.uprootLimit).toBe(240);
      expect(entry?.colDamageEffect).toBe(200);
    });
  });
});

describe('GtaSaWorldAdapter.loadTimecyc', () => {
  describe('negative cases', () => {
    it('throws naming all three candidates when none ships (the table is mandatory)', async () => {
      await expect(new GtaSaWorldAdapter(cfg()).loadTimecyc()).rejects.toThrow(
        'asset not found: data/timecyc_24h.dat / data/timecyc24h.dat / data/timecyc.dat',
      );
    });
  });
});

describe('GtaSaWorldAdapter.invalidateColliderCache', () => {
  describe('positive cases', () => {
    it('forces the next load to REBUILD, so a clutter-density change reaches physics', async () => {
      const adapter = new GtaSaWorldAdapter(cfg());
      await adapter.prepare();
      const first = await adapter.loadCellColliders(0, 0);

      adapter.invalidateColliderCache();

      expect(await adapter.loadCellColliders(0, 0)).not.toBe(first);
    });
  });
});

describe('GtaSaWorldAdapter.cellClutter', () => {
  describe('negative cases', () => {
    it('is empty before prepare', () => {
      expect(new GtaSaWorldAdapter(cfg()).cellClutter(0, 0)).toEqual([]);
    });

    it('is empty when the procobj data files are absent (nothing scatters)', async () => {
      const adapter = new GtaSaWorldAdapter(cfg());
      await adapter.prepare();

      expect(adapter.cellClutter(0, 0)).toEqual([]);
    });
  });
});

describe('GtaSaWorldAdapter.prepare', () => {
  describe('positive cases', () => {
    it('is idempotent and still reports completion on a repeat call (debug reload)', async () => {
      const adapter = new GtaSaWorldAdapter(cfg());
      const progress: number[] = [];

      await adapter.prepare((fraction) => progress.push(fraction));
      const cells = adapter.listCells();
      await adapter.prepare((fraction) => progress.push(fraction));

      expect(progress).toEqual([1, 1]);
      expect(adapter.listCells()).toEqual(cells); // the grid was not rebuilt from scratch
    });
  });
});

describe('GtaSaWorldAdapter.vehiclePaint', () => {
  const CARCOLS = [
    'col',
    '0,0,0',
    '10,20,30',
    '40,50,60',
    'end',
    'car',
    'testcar, 1,2',
    'end',
    'car4',
    'quadcar, 0,1,2,1',
    'end',
  ].join('\n');
  const adapter = (): GtaSaWorldAdapter => new GtaSaWorldAdapter({ cellSize: 250, fs: vehicleFs(CARCOLS) });

  describe('negative cases', () => {
    it('paints a car with no carcols entry plain white in every slot', async () => {
      expect(await adapter().vehiclePaint('nope')).toEqual({
        primary: [1, 1, 1],
        quaternary: [1, 1, 1],
        secondary: [1, 1, 1],
        tertiary: [1, 1, 1],
      });
    });

    it('ignores a non-numeric colour string and falls back to the car own carcols combo', async () => {
      const paint = await adapter().vehiclePaint('testcar', 'red,blue');

      expect(paint.primary).toEqual([10 / 255, 20 / 255, 30 / 255]); // palette 1, the first combo
    });
  });

  describe('positive cases', () => {
    it('scales carcols bytes into the engine 0..1 space, defaulting 3rd/4th to palette 0', async () => {
      expect(await adapter().vehiclePaint('TestCar')).toEqual({
        primary: [10 / 255, 20 / 255, 30 / 255],
        quaternary: [0, 0, 0],
        secondary: [40 / 255, 50 / 255, 60 / 255],
        tertiary: [0, 0, 0],
      });
    });

    it('an explicit colour string overrides the car own combo', async () => {
      const paint = await adapter().vehiclePaint('testcar', ' 2 , 1 ');

      expect(paint.primary).toEqual([40 / 255, 50 / 255, 60 / 255]); // palette 2
      expect(paint.secondary).toEqual([10 / 255, 20 / 255, 30 / 255]); // palette 1
    });

    it('falls back to the 4-colour table for a car listed only under car4', async () => {
      expect(await adapter().vehiclePaint('quadcar')).toEqual({
        primary: [0, 0, 0],
        quaternary: [10 / 255, 20 / 255, 30 / 255],
        secondary: [10 / 255, 20 / 255, 30 / 255],
        tertiary: [40 / 255, 50 / 255, 60 / 255],
      });
    });
  });
});

describe('GtaSaWorldAdapter.loadVehicleData', () => {
  describe('negative cases', () => {
    it('names the model when vehicles.ide has no such car', async () => {
      const adapter = new GtaSaWorldAdapter({ cellSize: 250, fs: dataFs() });

      await expect(adapter.loadVehicleData('delorean')).rejects.toThrow(/No vehicle definition/);
    });

    it('names the model when the roster lists a car this build never converted', async () => {
      const adapter = new GtaSaWorldAdapter({ cellSize: 250, fs: dataFs() });

      await expect(adapter.loadVehicleData('landstal')).rejects.toThrow("'landstal.osm' is missing");
    });

    it('throws a named error when a required data file is missing entirely', async () => {
      const adapter = new GtaSaWorldAdapter(cfg());

      await expect(adapter.vehicleColourCombos('landstal')).rejects.toThrow('asset not found: data/vehicles.ide');
    });
  });
});

describe('tyreAdhesionPerMaterial', () => {
  const SURFACE_DAT =
    ';        Rubber  Hard  Road  Loose  Sand  Wet\nRubber 6.0\nHard 3.6 2.0\nRoad 4.5 3.0 6.0\nLoose 3.2 3.5 2.0 1.0\nSand 3.0 4.0 2.0 1.0 1.0\nWet 2.8 2.0 1.0 1.0 1.0 0.5\n';
  const row = (adhesionGroup: string): Renderware.SurfaceInfo =>
    ({ adhesionGroup, name: adhesionGroup, skidmark: 'default', tyreGrip: 1, wetGrip: 0 }) as Renderware.SurfaceInfo;

  describe('negative cases', () => {
    it('answers null when the world ships no adhesion matrix — never a made-up one', () => {
      expect(tyreAdhesionPerMaterial([row('road')], null)).toBeNull();
    });

    it('falls back to ROAD for a surface whose group is not in the matrix', () => {
      const table = tyreAdhesionPerMaterial([row('road'), row('quicksand')], SURFACE_DAT);

      expect(table?.perMaterial[1]).toBe(4.5); // the unmapped surface drives exactly like tarmac
    });
  });

  describe('positive cases', () => {
    it('resolves SA rubber row per material id, and reports the road cell it is judged against', () => {
      const table = tyreAdhesionPerMaterial([row('road'), row('loose'), row('sand'), row('wet')], SURFACE_DAT);

      expect(table?.road).toBe(4.5);
      // Float32Array, so the cells come back at float precision — the values are SA's, the rounding is ours.
      const cells = Array.from(table?.perMaterial ?? []);
      expect(cells).toHaveLength(4);
      [4.5, 3.2, 3, 2.8].forEach((expected, index) => expect(cells[index]).toBeCloseTo(expected, 5));
    });
  });
});

describe('GtaSaWorldAdapter.plateSources', () => {
  describe('negative cases', () => {
    it('returns null when the game ships no generic vehicle dictionary', () => {
      expect(new GtaSaWorldAdapter({ cellSize: 250, fs: fakeFs() }).plateSources()).toBeNull();
    });

    it('does not re-read the dictionary on every call — plates resolve on a SPAWN path', () => {
      let reads = 0;
      const fs: Renderware.AssetFileSystem = {
        get: (): null => {
          reads += 1;

          return null;
        },
        getText: () => null,
        has: () => false,
        names: [],
      };
      const adapter = new GtaSaWorldAdapter({ cellSize: 250, fs });

      adapter.plateSources();
      adapter.plateSources();

      // A null result must be cached too, or a game without the dictionary pays the lookup per car.
      expect(reads).toBe(1);
    });
  });
});
