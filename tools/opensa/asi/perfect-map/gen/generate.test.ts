import { renderHeader } from '@opensa/asi-sdk/render';
import { SA_FINGERPRINT } from '@opensa/asi-sdk/sa-fingerprint';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CATALOGUE } from './catalogue';

describe('perfect-map catalogue', () => {
  describe('positive cases', () => {
    it('pins the shared fingerprint to the one accepted exe', () => {
      expect(SA_FINGERPRINT.exeSize).toBe(14383616);
      expect(SA_FINGERPRINT.sha1).toBe('8c23ceffafa9fd88ea567be7926a33413b8e3c00');
    });

    it('renders the real catalogue with one anchor per site', () => {
      const hpp = renderHeader(CATALOGUE, SA_FINGERPRINT, { namespace: 'pm' });
      const siteCount = CATALOGUE.reduce((sum, entry) => sum + entry.sites.length, 0);

      expect(hpp).toContain(`inline constexpr uint32_t kPatchSiteCount = ${siteCount}u;`);
      expect(hpp).toContain('{0x66, 0x8b, 0x43, 0x2a}'); // LoadIplBoundingBox.staticIdx
      expect(hpp).toContain('namespace pm::gen {');
    });

    it('names a gta-reversed-modern source in every provenance line', () => {
      for (const entry of CATALOGUE) {
        expect(entry.provenance).toMatch(/gta-reversed-modern source\/game_sa\//);
      }
    });

    // The fingerprint (SDK) and the catalogue (here) now live in different packages and overlap on four
    // names. A one-nibble typo in either would pass every other check and turn into a relocated garbage
    // instruction in the field. The exe is linked at 0x400000 with a 0xC00 header, hence the fixed delta.
    it('agrees with the shared fingerprint wherever the two tables name the same site', () => {
      const VA_TO_FILE_DELTA = 0x400c00;
      const sites = new Map(CATALOGUE.flatMap((entry) => entry.sites).map((site) => [site.name, site]));
      const overlapping = SA_FINGERPRINT.anchors.filter((anchor) => sites.has(anchor.name));

      expect(overlapping.length).toBeGreaterThan(0);
      for (const anchor of overlapping) {
        const site = sites.get(anchor.name);

        expect(site?.address).toBe(anchor.fileOffset + VA_TO_FILE_DELTA);
        expect(site?.bytes).toEqual(anchor.bytes);
      }
    });

    // Catches the half-edit that `asi::FindSite` cannot: a payload naming a site the catalogue no longer
    // carries compiles, verifies clean, and then dereferences null inside DLL_PROCESS_ATTACH.
    it('carries every site name the payloads look up', () => {
      const names = new Set(CATALOGUE.flatMap((entry) => entry.sites).map((site) => site.name));
      const patchDir = join(import.meta.dirname, '..', 'src', 'patches');
      const quoted = readdirSync(patchDir)
        .filter((file) => file.endsWith('.hpp'))
        .flatMap((file) => [...readFileSync(join(patchDir, file), 'utf8').matchAll(/"([^"\n]*)"/g)])
        .map((match) => match[1])
        .filter((text) => /^\w+(?:\.\w+)+$/.test(text) && !text.endsWith('.log'));

      expect(quoted.length).toBeGreaterThan(0);
      for (const name of new Set(quoted)) {
        expect(names, `payload names "${name}"`).toContain(name);
      }
    });

    // The one check that needs no field round: every declared site is read back off the shipping exe itself
    // (the `gta_sa.exe` fixture is a copy of `game-src/original`, the accepted 1.0 US HOODLUM image — its
    // relocated `IncludeEntity` entry jmp is ON DISK, so the catalogue's `e9 …` bytes are file bytes too).
    // 011's four sites were transcribed from objdump; a mis-typed nibble would pass every test above and
    // make the plugin DEFER in the field with a "site differs" that looks like an adjuster's doing.
    const EXE = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'original', 'gta_sa.exe');
    it.skipIf(!existsSync(EXE))('declares, for every site, exactly the bytes the shipping exe carries', () => {
      const VA_TO_FILE_DELTA = 0x400c00;
      const exe = readFileSync(EXE);

      expect(exe.byteLength).toBe(SA_FINGERPRINT.exeSize);
      for (const site of CATALOGUE.flatMap((entry) => entry.sites)) {
        const offset = site.address - VA_TO_FILE_DELTA;
        const onDisk = [...exe.subarray(offset, offset + site.bytes.length)];

        expect(onDisk, `${site.name} @ 0x${site.address.toString(16)}`).toEqual(site.bytes);
      }
    });
  });
});
