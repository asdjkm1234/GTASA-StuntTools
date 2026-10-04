/**
 * Machine-readable patch catalogue — perfect-vehicle's single source of truth, typed against the SDK's
 * interfaces (`@opensa/asi-sdk/catalogue`) and turned into `src/generated/patches.hpp` by
 * [generate.ts](./generate.ts). Values are the RE results read out of the 1.0 US exe (SHA1 `8c23ceff…`) in
 * [plan 001](../docs/plans/001-re-carmods-ceilings.md), which carries the narrative; this file carries the
 * byte-verify BASELINES. Addresses are 1.0 US virtual addresses (image base 0x400000).
 */

import type { CatalogueEntry } from '@opensa/asi-sdk/catalogue';

const RE = 'asi/perfect-vehicle/docs/plans/001 (2026-08-19): objdump census of the shipping exe, every site classified';

export const CATALOGUE: readonly CatalogueEntry[] = [
  {
    id: 'carmods-links',
    provenance: `gta-reversed-modern source/game_sa/Models/VehicleModelInfo.cpp — CLinkedUpgradeList::AddUpgradeLink / FindOtherUpgrade; ${RE}`,
    sites: [
      {
        address: 0x4c74b0,
        bytes: [0x8b, 0x41, 0x78, 0x66, 0x8b, 0x54, 0x24, 0x04],
        name: 'AddUpgradeLink.entry',
        note: 'mov eax,[ecx+0x78] (m_nLinksCount) · mov dx,[esp+4] — the writer, six instructions and no bounds check; replaced outright',
      },
      {
        address: 0x4c74d0,
        bytes: [0x8b, 0x41, 0x78, 0x85, 0xc0, 0x74, 0x1b],
        name: 'FindOtherUpgrade.entry',
        note: 'mov eax,[ecx+0x78] · test eax,eax · je — the reader (5 call sites); replaced outright',
      },
      {
        address: 0x5b6859,
        bytes: [0xb9, 0xd8, 0xe6, 0xb4, 0x00],
        name: 'LoadVehicleUpgrades.link.this',
        note: 'mov ecx,0xb4e6d8 before the only AddUpgradeLink call — verified so an adjuster that repoints the list makes us DEFER instead of writing into a structure we no longer own',
      },
      {
        address: 0x4986bb,
        bytes: [0xe8, 0x10, 0xee, 0x02, 0x00],
        name: 'FindOtherUpgrade.call.4986BB',
        note: 'one of the five readers — verified only, never written',
      },
    ],
    strategy: 'hook',
    summary:
      "CLinkedUpgradeList's 30 link pairs (@0xB4E6D8: m_anUpgrade1[30], m_anUpgrade2[30] at +0x3C, count at +0x78). The 31st pair writes past both arrays — silent static corruption. Both accessor methods are replaced with our own over our own storage, so the ceiling becomes ours; every one of the exe's 7 references to the structure is a `mov reg, imm` before a call to one of the two, which is what makes the replacement complete.",
  },
];
