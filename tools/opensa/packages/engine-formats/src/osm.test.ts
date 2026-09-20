import { describe, expect, it } from 'vitest';

import {
  decodeOsm,
  encodeOsm,
  OSM_MAGIC,
  OSM_SECTION_ALIGN,
  osmSection,
  OsmSectionTag,
  osmTag,
  osmTagName,
} from './osm';

const desc = new TextEncoder().encode('{"parts":[]}');
const coll = Uint8Array.from([1, 2, 3, 4, 5]);
const geom = Uint8Array.from([9, 8, 7]);

describe('osm', () => {
  describe('negative cases', () => {
    it('rejects bytes that are not a .osm', () => {
      expect(() => decodeOsm(new Uint8Array(16))).toThrow(/not a \.osm file/);
    });

    it('rejects a duplicated section tag', () => {
      expect(() =>
        encodeOsm([
          { bytes: geom, tag: OsmSectionTag.GEOM },
          { bytes: geom, tag: OsmSectionTag.GEOM },
        ]),
      ).toThrow(/duplicate .* GEOM/);
    });

    it('rejects a section table pointing past the end of the file', () => {
      const bytes = encodeOsm([{ bytes: geom, tag: OsmSectionTag.GEOM }]);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      view.setUint32(16, 0xffff, true); // the first entry's length

      expect(() => decodeOsm(bytes)).toThrow(/overruns the file/);
    });

    it('rejects a tag that is not four characters', () => {
      expect(() => osmTag('GEO')).toThrow(/4 characters/);
    });
  });

  describe('positive cases', () => {
    it('round-trips every section byte-for-byte', () => {
      const bytes = encodeOsm([
        { bytes: desc, tag: OsmSectionTag.DESC },
        { bytes: geom, tag: OsmSectionTag.GEOM },
        { bytes: coll, tag: OsmSectionTag.COLL },
      ]);
      const osm = decodeOsm(bytes);

      expect(osm.sections.size).toBe(3);
      expect(osmSection(osm, OsmSectionTag.DESC)).toEqual(desc);
      expect(osmSection(osm, OsmSectionTag.GEOM)).toEqual(geom);
      expect(osmSection(osm, OsmSectionTag.COLL)).toEqual(coll);
    });

    it('reads collision without the geometry section being present', () => {
      // The main-thread physics path: a consumer takes COLL and never looks at GEOM.
      const osm = decodeOsm(
        encodeOsm([
          { bytes: geom, tag: OsmSectionTag.GEOM },
          { bytes: coll, tag: OsmSectionTag.COLL },
        ]),
      );

      expect(osmSection(osm, OsmSectionTag.COLL)).toEqual(coll);
      expect(osmSection(osm, osmTag('NOPE'))).toBeNull();
    });

    it('aligns every section so typed-array views are legal', () => {
      const bytes = encodeOsm([
        { bytes: coll, tag: OsmSectionTag.COLL }, // 5 bytes — forces padding before the next
        { bytes: geom, tag: OsmSectionTag.GEOM },
      ]);
      const osm = decodeOsm(bytes);

      for (const section of osm.sections.values()) {
        expect(section.byteOffset % OSM_SECTION_ALIGN).toBe(0);
      }
    });

    it('keeps the magic and tag names legible', () => {
      const bytes = encodeOsm([{ bytes: geom, tag: OsmSectionTag.GEOM }]);

      expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true)).toBe(OSM_MAGIC);
      expect(osmTagName(OsmSectionTag.GEOM)).toBe('GEOM');
      expect(osmTagName(OsmSectionTag.COLL)).toBe('COLL');
    });

    it('decodes section payloads as views over the source buffer', () => {
      const bytes = encodeOsm([{ bytes: geom, tag: OsmSectionTag.GEOM }]);
      const section = osmSection(decodeOsm(bytes), OsmSectionTag.GEOM);

      expect(section?.buffer).toBe(bytes.buffer);
    });
  });
});
