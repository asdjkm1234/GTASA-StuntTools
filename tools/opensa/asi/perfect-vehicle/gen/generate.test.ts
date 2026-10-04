import { renderHeader } from '@opensa/asi-sdk/render';
import { SA_FINGERPRINT } from '@opensa/asi-sdk/sa-fingerprint';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CATALOGUE } from './catalogue';

/** The one accepted exe, as a file — the referee for every byte in the catalogue. */
const EXE = join(process.cwd(), 'fixtures', 'original', 'gta_sa.exe');
/** The exe is linked at 0x400000 with a 0xC00 header, so a VA maps to a file offset by this fixed delta. */
const VA_TO_FILE_DELTA = 0x400c00;

describe('perfect-vehicle catalogue', () => {
  describe('positive cases', () => {
    it('pins the shared fingerprint to the one accepted exe', () => {
      expect(SA_FINGERPRINT.exeSize).toBe(14383616);
      expect(SA_FINGERPRINT.sha1).toBe('8c23ceffafa9fd88ea567be7926a33413b8e3c00');
    });

    it('renders every site into the generated header', () => {
      const hpp = renderHeader(CATALOGUE, SA_FINGERPRINT, { namespace: 'pv' });
      const siteCount = CATALOGUE.reduce((sum, entry) => sum + entry.sites.length, 0);

      expect(hpp).toContain(`inline constexpr uint32_t kPatchSiteCount = ${siteCount}u;`);
      expect(hpp).toContain('namespace pv::gen {');
    });

    it('names a gta-reversed-modern source in every provenance line', () => {
      for (const entry of CATALOGUE) {
        expect(entry.provenance).toMatch(/gta-reversed-modern source\/game_sa\//);
      }
    });
  });
});

/**
 * The check that cannot be argued with: every catalogued byte, read back off the shipping exe. A one-nibble
 * typo would pass every other test in this file and turn into a 5-byte jump written over the middle of an
 * instruction in the field.
 */
describe.skipIf(!existsSync(EXE))('perfect-vehicle catalogue against the real exe', () => {
  describe('positive cases', () => {
    it('finds every site’s bytes exactly where the catalogue says', () => {
      const exe = readFileSync(EXE);
      for (const entry of CATALOGUE) {
        for (const site of entry.sites) {
          const at = site.address - VA_TO_FILE_DELTA;
          expect([site.name, [...exe.subarray(at, at + site.bytes.length)]]).toEqual([site.name, [...site.bytes]]);
        }
      }
    });
  });
});
