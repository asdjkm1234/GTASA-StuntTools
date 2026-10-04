import { describe, expect, it } from 'vitest';

import { formatFeatureTable, parseFeatures } from './features';
import { decodeSettings } from './settings';

describe('parseFeatures', () => {
  describe('negative cases', () => {
    it('returns nothing for an empty file or one that is all comments', () => {
      expect(parseFeatures('')).toEqual([]);
      expect(parseFeatures('# a 1986 Starion\n// by mad_driver\n')).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('reads the tokens a mod declares, upper-cased and de-duplicated', () => {
      expect(parseFeatures('UP/DOWN_LIGHTS\nup/down_lights\n')).toEqual(['UP/DOWN_LIGHTS']);
    });

    it('takes several tokens off one line and ignores a trailing comment', () => {
      expect(parseFeatures('UP/DOWN_LIGHTS, SPOILER  # what this model can do')).toEqual(['UP/DOWN_LIGHTS', 'SPOILER']);
    });
  });
});

describe('parseFeatures + decodeSettings', () => {
  describe('positive cases', () => {
    it('reads a features file saved as UTF-16, like the settings file beside it', () => {
      const bytes = Buffer.from(`\ufeffUP/DOWN_LIGHTS\r\n`, 'utf16le');

      expect(parseFeatures(decodeSettings(bytes))).toEqual(['UP/DOWN_LIGHTS']);
    });
  });
});

describe('formatFeatureTable', () => {
  describe('negative cases', () => {
    it('writes only the header when no model declared anything', () => {
      const text = formatFeatureTable(new Map([['previon', []]]));

      expect(text.split('\n').filter((line) => line !== '' && !line.startsWith('#'))).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('sorts models and their features, so a rebuild is byte-identical', () => {
      const text = formatFeatureTable(
        new Map([
          ['previon', ['SPOILER', 'UP/DOWN_LIGHTS']],
          ['zr350', ['UP/DOWN_LIGHTS']],
        ]),
      );

      expect(text.split('\n').filter((line) => line !== '' && !line.startsWith('#'))).toEqual([
        'previon SPOILER UP/DOWN_LIGHTS',
        'zr350 UP/DOWN_LIGHTS',
      ]);
    });
  });
});
