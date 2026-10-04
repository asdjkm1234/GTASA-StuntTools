import { describe, expect, it } from 'vitest';

import { layerOf } from './package-layer';

describe('layerOf', () => {
  describe('negative cases', () => {
    // The two real cases the folder rule gets wrong, and gets wrong SILENTLY — a diagram nobody
    // re-derives, showing a node:fs package and an Electron app inside the browser runtime.
    it('does not call a packages/ folder engine when its tag says tool', () => {
      expect(layerOf('packages/validation', ['type:tool'])).toBe('tool');
    });

    it('does not call an apps/ folder app when its tag says tool', () => {
      expect(layerOf('apps/cutscene-converter', ['type:tool'])).toBe('tool');
    });

    it('ignores tags that are not layer tags', () => {
      expect(layerOf('packages/cell-weld', ['scope:osengine'])).toBe('engine');
    });
  });

  describe('positive cases', () => {
    it.each([
      ['apps/web', 'app'],
      ['packages/engine', 'engine'],
      ['tools/opensa-pack', 'tool'],
      ['tools-debug/sa-int16-repro', 'tool'],
      ['asi/perfect-map', 'tool'],
      ['cleo/sdk', 'tool'],
    ])('falls back to the folder for %s when no tag says otherwise', (dir, expected) => {
      expect(layerOf(dir, [])).toBe(expected);
    });

    it('takes the tag over the folder when they agree too', () => {
      expect(layerOf('packages/engine', ['type:engine', 'scope:osengine'])).toBe('engine');
    });
  });
});
