import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkDefinitionOrder, formatLateDefinition } from './dat-order';

let dir: string;

/** An `objs` IDE defining one model. */
function ide(id: number, name: string): string {
  return ['objs', `${id}, ${name}, ${name}s, 300, 0`, 'end', ''].join('\n');
}

/** An `inst` IPL placing each id once. */
function ipl(ids: readonly number[]): string {
  return ['inst', ...ids.map((id, index) => `${id}, model${index}, 0, 1, 2, 3, 0, 0, 0, 1, -1`), 'end', ''].join('\n');
}

/** A game tree whose `gta.dat` lists `lines`, over the named `data/maps` files. */
function tree(lines: readonly string[], files: Readonly<Record<string, string>>): string {
  const game = join(dir, 'game');
  mkdirSync(join(game, 'data', 'maps'), { recursive: true });
  writeFileSync(join(game, 'data', 'gta.dat'), `${lines.join('\n')}\n`);
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(game, 'data', 'maps', name), text);
  }

  return game;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dat-order-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe('checkDefinitionOrder', () => {
  describe('negative cases', () => {
    it('reports nothing when every IDE is listed before the IPL that places its ids', () => {
      const game = tree(['IDE DATA\\MAPS\\town.ide', 'IPL DATA\\MAPS\\town.ipl'], {
        'town.ide': ide(100, 'house'),
        'town.ipl': ipl([100]),
      });

      expect(checkDefinitionOrder(game)).toEqual({ checked: 1, late: [] });
    });

    it('leaves an id NOTHING defines to the dangling-model check — this one is about order only', () => {
      const game = tree(['IPL DATA\\MAPS\\town.ipl'], { 'town.ipl': ipl([9999]) });

      expect(checkDefinitionOrder(game).late).toEqual([]);
    });

    it('takes the FIRST definition of an id, so a later redefinition is not a finding', () => {
      const game = tree(['IDE DATA\\MAPS\\town.ide', 'IPL DATA\\MAPS\\town.ipl', 'IDE DATA\\MAPS\\mod.ide'], {
        'mod.ide': ide(100, 'houseremastered'),
        'town.ide': ide(100, 'house'),
        'town.ipl': ipl([100]),
      });

      expect(checkDefinitionOrder(game).late).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('reports a row placed before the IDE that defines it, naming both positions', () => {
      const game = tree(['IPL DATA\\MAPS\\las.ipl', 'IDE DATA\\MAPS\\relit.ide'], {
        'las.ipl': ipl([7394]),
        'relit.ide': ide(7394, 'exteriorlit'),
      });

      const report = checkDefinitionOrder(game);

      expect(report.checked).toBe(1);
      expect(report.late).toEqual([
        {
          count: 1,
          definedBy: 'DATA\\MAPS\\relit.ide',
          definedLine: 2,
          id: 7394,
          modelName: 'exteriorlit',
          placedBy: 'las.ipl',
          placedLine: 1,
        },
      ]);
      expect(formatLateDefinition(report.late[0])).toContain('exteriorlit (id 7394) — 1 row(s) in las.ipl');
    });

    it('counts every row of the same id in one IPL as a single finding', () => {
      const game = tree(['IPL DATA\\MAPS\\las.ipl', 'IDE DATA\\MAPS\\relit.ide'], {
        'las.ipl': ipl([7394, 7394, 7394]),
        'relit.ide': ide(7394, 'exteriorlit'),
      });

      const report = checkDefinitionOrder(game);

      expect(report.late).toHaveLength(1);
      expect(report.late[0].count).toBe(3);
    });

    it('sorts the worst first', () => {
      const game = tree(['IPL DATA\\MAPS\\las.ipl', 'IDE DATA\\MAPS\\mod.ide'], {
        'las.ipl': ipl([100, 200, 200]),
        'mod.ide': `${ide(100, 'one')}${ide(200, 'two')}`,
      });

      expect(checkDefinitionOrder(game).late.map((row) => [row.id, row.count])).toEqual([
        [200, 2],
        [100, 1],
      ]);
    });
  });
});

// The invariant on the real thing: stock SA never places a model before defining it, so any finding on a built
// tree is OURS — the same property that makes `assertLodLinks` usable as a build guard.
const STOCK = 'game-src/original';

describe.skipIf(!existsSync(join(STOCK, 'data', 'gta.dat')))('checkDefinitionOrder (stock game tree)', () => {
  describe('negative cases', () => {
    it('finds nothing in the stock tree, over thousands of rows', () => {
      const report = checkDefinitionOrder(STOCK);

      expect(report.checked).toBeGreaterThan(5000);
      expect(report.late).toEqual([]);
    });
  });
});
