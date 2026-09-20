import { describe, expect, it } from 'vitest';

import type { CatalogueEntry, Fingerprint } from './catalogue';

import { renderHeader } from './render';

const FP: Fingerprint = {
  anchors: [{ bytes: [0xe9, 0x9b], fileOffset: 0x4090, name: 'a.entry' }],
  exeSize: 14383616,
  sha1: '8c23ceffafa9fd88ea567be7926a33413b8e3c00',
};

const ENTRY: CatalogueEntry = {
  id: 'ipldef-range',
  provenance: 'synthetic fixture',
  sites: [{ address: 0x404b20, bytes: [0xa1, 0xb0], name: 'RemoveIpl.entry' }],
  strategy: 'hook',
  summary: 's',
};

const NS = { namespace: 'pm' };

describe('renderHeader', () => {
  describe('negative cases', () => {
    it('throws when the fingerprint sha1 is not 40 hex chars', () => {
      expect(() => renderHeader([ENTRY], { ...FP, sha1: 'abc' }, NS)).toThrow(/sha1/);
    });

    it('throws when a fingerprint fileOffset is outside the exe', () => {
      expect(() =>
        renderHeader([ENTRY], { ...FP, anchors: [{ bytes: [1], fileOffset: 0x9000000, name: 'x' }] }, NS),
      ).toThrow(/fileOffset/);
    });

    it('throws when a patch-site address is outside the 1.0 US range', () => {
      const bad = { ...ENTRY, sites: [{ address: 0x10, bytes: [1], name: 'x' }] };
      expect(() => renderHeader([bad], FP, NS)).toThrow(/range/);
    });

    it('throws when an anchor has empty bytes', () => {
      const bad = { ...ENTRY, sites: [{ address: 0x404b20, bytes: [], name: 'x' }] };
      expect(() => renderHeader([bad], FP, NS)).toThrow(/empty/);
    });

    it('throws on a byte outside 0..255', () => {
      const bad = { ...ENTRY, sites: [{ address: 0x404b20, bytes: [0x100], name: 'x' }] };
      expect(() => renderHeader([bad], FP, NS)).toThrow(/0\.\.255/);
    });

    it('throws on duplicate catalogue ids', () => {
      expect(() => renderHeader([ENTRY, ENTRY], FP, NS)).toThrow(/duplicate catalogue id/);
    });

    it('throws when two entries share a site name (FindSite would take the first)', () => {
      const other = { ...ENTRY, id: 'other-entry' };

      expect(() => renderHeader([ENTRY, other], FP, NS)).toThrow(/duplicate site name/);
    });

    it('throws when two fingerprint anchors share a name', () => {
      const anchor = { bytes: [0xe9], fileOffset: 0x4090, name: 'a.entry' };

      expect(() => renderHeader([ENTRY], { ...FP, anchors: [anchor, anchor] }, NS)).toThrow(
        /duplicate fingerprint anchor name/,
      );
    });
  });

  describe('positive cases', () => {
    it('emits the fingerprint (file anchors) and a site byte array', () => {
      const hpp = renderHeader([ENTRY], FP, NS);

      expect(hpp).toContain('inline constexpr uint32_t kExeSize = 14383616u;');
      expect(hpp).toContain('"8c23ceffafa9fd88ea567be7926a33413b8e3c00"');
      expect(hpp).toContain('inline constexpr asi::FileAnchor kFingerprint[] = {');
      expect(hpp).toContain('{0xa1, 0xb0}');
      expect(hpp).toContain('inline constexpr uint32_t kFingerprintCount = 1u;');
    });

    it('emits the framework anchor types rather than redeclaring them', () => {
      const hpp = renderHeader([ENTRY], FP, NS);

      expect(hpp).toContain('#include <asi/generated-tables.hpp>');
      expect(hpp).toContain('inline constexpr asi::ByteAnchor kPatchSites[] = {');
      expect(hpp).not.toContain('struct ByteAnchor {');
      expect(hpp).not.toContain('struct FileAnchor {');
    });

    it('emits into the namespace the plugin asked for', () => {
      const hpp = renderHeader([ENTRY], FP, { namespace: 'cl' });

      expect(hpp).toContain('namespace cl::gen {');
      expect(hpp).toContain('}  // namespace cl::gen');
      expect(hpp).not.toContain('pm::gen');
    });
  });
});
