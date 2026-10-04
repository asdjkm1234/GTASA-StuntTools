import { describe, expect, it } from 'vitest';

import type { PackOptions } from './pack';

import { buildRecipe, readGitCommit } from './build-recipe';

const META = { appVersion: '0.4.0', at: '2026-08-07 12:00', commit: 'abc1234', game: 'original' };
const BASE: PackOptions = { gameDir: './game-src/original', outDir: './build/phone' };

describe('buildRecipe', () => {
  describe('negative cases', () => {
    it('records an empty subset as null, so "no names given" cannot read as "convert nothing"', () => {
      const recipe = buildRecipe({ ...BASE, peds: [], platforms: [], vehicles: [] }, META);

      expect(recipe.peds).toBeNull();
      expect(recipe.platforms).toBeNull();
      expect(recipe.vehicles).toBeNull();
    });

    it('keeps a flag that was never passed FALSE rather than null, so off and unset stay distinct', () => {
      const recipe = buildRecipe(BASE, META);

      expect(recipe.bakeCollision).toBe(false);
      expect(recipe.mapObjectsInRect).toBe(false);
      expect(recipe.rgba8).toBe(false);
      expect(recipe.maxTexture).toBe(0);
      expect(recipe.rect).toBeNull();
    });

    it('defaults the two options that are ON unless asked otherwise', () => {
      const recipe = buildRecipe(BASE, META);

      expect(recipe.ao).toBe(true);
      expect(recipe.models).toBe(true);
    });

    it('returns null for a commit when the directory is not a git checkout', () => {
      expect(readGitCommit('/')).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('records the knobs a field run is judged on', () => {
      const recipe = buildRecipe(
        {
          ...BASE,
          ao: false,
          bakeCollision: true,
          forceRgba8: true,
          mapObjectsInRect: true,
          maxTextureSize: 256,
          models: true,
          peds: ['bmycg', 'wmycr'],
          platforms: ['mobile'],
          rect: [9, -7, 10, -6],
          vehicles: ['admiral'],
        },
        META,
      );

      expect(recipe).toEqual({
        ao: false,
        appVersion: '0.4.0',
        at: '2026-08-07 12:00',
        bakeCollision: true,
        commit: 'abc1234',
        game: 'original',
        lodOnly: false,
        mapObjectsInRect: true,
        maxTexture: 256,
        models: true,
        peds: ['bmycg', 'wmycr'],
        platforms: ['mobile'],
        rect: [9, -7, 10, -6],
        rgba8: true,
        textures: 'rgba8',
        vehicles: ['admiral'],
      });
    });

    it('distinguishes the baked 3D city map from the full world — one tier is not two', () => {
      // 201/6-01. The two paks are the same game, the same rect and the same flags otherwise, and one of
      // them carries half the tiers. A folder listing cannot tell them apart, and `phone.sh` reuses a pak by
      // comparing its recipe — so an unrecorded `--lod-only` is a run served the wrong world.
      const map = buildRecipe({ ...BASE, lodOnly: true }, META);
      const full = buildRecipe(BASE, META);

      expect(map.lodOnly).toBe(true);
      expect(full.lodOnly).toBe(false);
      expect(map).not.toEqual(full);
    });

    it('distinguishes the two sides of the collision A/B, which is the whole point of recording it', () => {
      const baked = buildRecipe({ ...BASE, bakeCollision: true }, META);
      const plain = buildRecipe({ ...BASE, bakeCollision: false }, META);

      expect(baked.bakeCollision).not.toBe(plain.bakeCollision);
    });

    it('distinguishes the texture A/B too — `rgba8` alone reads false for ASTC and for BC alike', () => {
      const astc = buildRecipe({ ...BASE, textures: 'astc' }, META);
      const plain = buildRecipe({ ...BASE, textures: 'rgba8' }, META);

      expect(astc.textures).toBe('astc');
      expect(plain.textures).toBe('rgba8');
      expect(astc.rgba8).toBe(plain.rgba8);
    });

    it('reads the older spelling as the format it always meant', () => {
      expect(buildRecipe({ ...BASE, forceRgba8: true }, META).textures).toBe('rgba8');
      expect(buildRecipe(BASE, META).textures).toBe('bc');
    });
  });
});
