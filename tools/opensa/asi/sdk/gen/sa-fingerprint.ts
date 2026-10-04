import type { Fingerprint } from './catalogue';

/** The only accepted target: canonical GTA:SA 1.0 US (HOODLUM), 14 383 616 B. Reject the
 *  14,405,632 / `0df50d56…` variant. Anchors are FILE offsets (read from disk) — the version identity
 *  must survive whatever an adjuster has patched in memory. Shared by every SA plugin (perfect-map,
 *  the future city-life). */
export const SA_FINGERPRINT: Fingerprint = {
  anchors: [
    {
      bytes: [0xe9, 0x9b, 0xea, 0x15, 0x01],
      fileOffset: 0x4090,
      name: 'IncludeEntity.entry',
      note: 'va 0x404C90 — jmp 0x1563730 (HOODLUM trampoline)',
    },
    {
      bytes: [0x0f, 0xbf, 0x7b, 0x22],
      fileOffset: 0x3f4a,
      name: 'RemoveIpl.firstBuilding',
      note: 'va 0x404B4A — movsx edi, word[ebx+0x22]',
    },
    {
      bytes: [0x66, 0x8b, 0x43, 0x2a],
      fileOffset: 0x5023,
      name: 'LoadIplBoundingBox.staticIdx',
      note: 'va 0x405C23 — mov ax, word[ebx+0x2a]',
    },
    {
      bytes: [0x89, 0x04, 0x8d, 0xe0, 0xc0, 0xbc, 0x00],
      fileOffset: 0x1b7d38,
      name: 'LoadScene.store',
      note: 'va 0x5B8938 — mov [ecx*4+0xBCC0E0], eax',
    },
  ],
  exeSize: 14383616,
  sha1: '8c23ceffafa9fd88ea567be7926a33413b8e3c00',
};
