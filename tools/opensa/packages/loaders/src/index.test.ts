import { describe, expect, it } from 'vitest';

import { AssetFetchLoader } from './asset-fetch-loader';
import { AssetHttpDirLoader, AssetLocalLoader } from './asset-local-loader';
import { createAssetLoader } from './index';

const base = { game: 'original', manifestUrl: 'http://x/manifest.json', version: '1' };

describe('createAssetLoader', () => {
  describe('negative cases', () => {
    it('throws when http-dir has no served base URL', () => {
      expect(() => createAssetLoader({ ...base, assetLoader: 'http-dir' })).toThrow(/served game-dir base URL/);
    });
  });

  describe('positive cases', () => {
    it('builds an AssetHttpDirLoader for http-dir with a base', () => {
      expect(createAssetLoader({ ...base, assetLoader: 'http-dir', base: 'http://host/build/x' })).toBeInstanceOf(
        AssetHttpDirLoader,
      );
    });

    it('builds an AssetLocalLoader for local', () => {
      expect(createAssetLoader({ ...base, assetLoader: 'local' })).toBeInstanceOf(AssetLocalLoader);
    });

    it('builds an AssetFetchLoader for fetch', () => {
      expect(createAssetLoader({ ...base, assetLoader: 'fetch' })).toBeInstanceOf(AssetFetchLoader);
    });
  });
});
