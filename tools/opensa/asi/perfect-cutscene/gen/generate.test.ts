import { renderHeader } from '@opensa/asi-sdk/render';
import { SA_FINGERPRINT } from '@opensa/asi-sdk/sa-fingerprint';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CATALOGUE } from './catalogue';

const SRC_DIR = join(import.meta.dirname, '..', 'src');

/** Every `.hpp`/`.cpp` under src/, recursively — the payloads that look site names up at runtime. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'generated' ? [] : sourceFiles(path);
    }

    return /\.(?:cpp|hpp)$/.test(entry.name) ? [path] : [];
  });
}

describe('perfect-cutscene catalogue', () => {
  describe('positive cases', () => {
    it('pins the shared fingerprint to the one accepted exe', () => {
      expect(SA_FINGERPRINT.exeSize).toBe(14383616);
      expect(SA_FINGERPRINT.sha1).toBe('8c23ceffafa9fd88ea567be7926a33413b8e3c00');
    });

    it('renders the real catalogue with one anchor per site', () => {
      const hpp = renderHeader(CATALOGUE, SA_FINGERPRINT, { namespace: 'pc' });
      const siteCount = CATALOGUE.reduce((sum, entry) => sum + entry.sites.length, 0);

      expect(hpp).toContain(`inline constexpr uint32_t kPatchSiteCount = ${siteCount}u;`);
      expect(hpp).toContain('{0xa0, 0x58, 0x40, 0xbc, 0x00}'); // SetupCarPipeAtomicsForClump.entry
      expect(hpp).toContain('namespace pc::gen {');
    });

    it('names a gta-reversed-modern source in every provenance line', () => {
      for (const entry of CATALOGUE) {
        expect(entry.provenance).toMatch(/gta-reversed-modern source\/game_sa\//);
      }
    });

    // A site we overwrite with a 5-byte `E9 rel32` must expose at least 5 bytes of WHOLE instructions to
    // relocate; a shorter window would splice a half instruction into the trampoline. The framework cannot
    // check this — the bytes verify pristine either way — so it is checked where the window is authored.
    it('gives every hookable entry/body site a window a 5-byte jmp fits in', () => {
      const hookable = CATALOGUE.flatMap((entry) => entry.sites).filter((site) => /\.(?:body|entry)$/.test(site.name));

      expect(hookable.length).toBeGreaterThan(0);
      for (const site of hookable) {
        expect(site.bytes.length, `site ${site.name}`).toBeGreaterThanOrEqual(5);
      }
    });

    // Catches the half-edit that `asi::FindSite` cannot: a payload naming a site the catalogue no longer
    // carries compiles, verifies clean, and then dereferences null inside DLL_PROCESS_ATTACH.
    it('carries every site name the payloads look up', () => {
      const names = new Set(CATALOGUE.flatMap((entry) => entry.sites).map((site) => site.name));
      const quoted = sourceFiles(SRC_DIR)
        .map((file) => readFileSync(file, 'utf8').replace(/^#include.*$/gm, '')) // "config.hpp" is not a site
        .flatMap((text) => [...text.matchAll(/"([^"\n]*)"/g)])
        .map((match) => match[1])
        .filter((text) => /^\w+(?:\.\w+)+$/.test(text) && !text.endsWith('.log'));

      for (const name of new Set(quoted)) {
        expect(names, `payload names "${name}"`).toContain(name);
      }
    });
  });
});
