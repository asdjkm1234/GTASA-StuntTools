/**
 * Machine-readable patch catalogue — perfect-map's single source of truth, typed against the SDK's
 * interfaces (`@opensa/asi-sdk/catalogue`) and turned into `src/generated/patches.hpp` by
 * [generate.ts](./generate.ts). Values are the RE results verified against the 1.0 US exe (SHA1
 * `8c23ceff…`); the human narrative lives in [docs/patch-catalogue.md](../docs/patch-catalogue.md), which MUST
 * agree with this file. Addresses are 1.0 US virtual addresses (image base 0x400000).
 *
 * This file carries the byte-verify BASELINES (per-site original bytes); the shared exe identity is the SDK's
 * `SA_FINGERPRINT`. The `apply` logic per patch is hand-written C++ in `src/patches/` — a table cannot express
 * a sidecar hook or an array relocation, so the generator emits DATA only.
 */

import type { CatalogueEntry } from '@opensa/asi-sdk/catalogue';

const PRE_SDK_RE = 'commit unrecorded (pre-SDK RE, 2026-07; bytes confirmed against the exe)';

export const CATALOGUE: readonly CatalogueEntry[] = [
  {
    conflictsWith: ['fla:ipl-entity-index'],
    id: 'ipldef-range',
    provenance: `gta-reversed-modern source/game_sa/IplStore.cpp — CIplStore::IncludeEntity + CIplStore::RemoveIpl; ${PRE_SDK_RE}`,
    sites: [
      {
        address: 0x404c90,
        bytes: [0xe9, 0x9b, 0xea, 0x15, 0x01],
        name: 'IncludeEntity.entry',
        note: 'observe hook (already a jmp→0x1563730): accumulate the int32 building range (pure min/max)',
      },
      {
        address: 0x404b20,
        bytes: [0xa1, 0xb0, 0x3f, 0x8e, 0x00],
        name: 'RemoveIpl.entry',
        note: 'snapshot hook: capture the slot range for the detours, then reset the slot (lifecycle reset)',
      },
      {
        address: 0x404b4a,
        bytes: [0x0f, 0xbf, 0x7b, 0x22],
        name: 'RemoveIpl.firstBuilding',
        note: 'movsx edi,word[ebx+0x22] → detour: edi = gSnapFirst',
      },
      {
        address: 0x404b5d,
        bytes: [0x0f, 0xbf, 0x53, 0x24],
        name: 'RemoveIpl.lastBuilding',
        note: 'movsx edx,word[ebx+0x24] → detour: edx = gSnapLast (initial pre-loop cmp)',
      },
      {
        address: 0x404ba8,
        bytes: [0x0f, 0xbf, 0x53, 0x24],
        name: 'RemoveIpl.lastBuilding.loop',
        note: 'the loop BACK-EDGE re-read of lastBuilding (every iteration) → detour: edx = gSnapLast',
      },
      {
        address: 0x404b54,
        bytes: [0xa1, 0x9c, 0x44, 0xb7, 0x00],
        name: 'RemoveIpl.cont.404B54',
        note: 'mov eax,[0xB7449C] — the firstBuilding detour jumps back HERE; verified so a future adjuster hooking the continuation makes us defer instead of corrupt',
      },
      {
        address: 0x404b63,
        bytes: [0x89, 0x4c, 0x24, 0x14],
        name: 'RemoveIpl.cont.404B63',
        note: 'mov [esp+0x14],ecx — the lastBuilding detour continuation',
      },
      {
        address: 0x404bad,
        bytes: [0x83, 0xc5, 0x38],
        name: 'RemoveIpl.cont.404BAD',
        note: 'add ebp,0x38 — the loop back-edge detour continuation',
      },
    ],
    strategy: 'hook',
    summary:
      'IplDef building pool-range int16 → int32: observe IncludeEntity + snapshot RemoveIpl entry + redirect its THREE lastBuilding/firstBuilding reads (incl. the loop back-edge re-read 0x404BA8) to an int32 sidecar. FLA jmp-hooks the read sites → we overlay it; OLA leaves them stock. WORKS in-game (buildings). The dummy pair is `ipldef-dummy-range` (plan 011).',
  },
  {
    conflictsWith: ['fla:ipl-entity-index'],
    id: 'ipldef-dummy-range',
    provenance:
      'gta-reversed-modern source/game_sa/IplStore.cpp — CIplStore::RemoveIpl dummy pass; bytes read off the 1.0 US exe 2026-08-19 (perfect-map plan 011, steps 2–3)',
    sites: [
      {
        address: 0x404c0f,
        bytes: [0x0f, 0xbf, 0x7b, 0x26, 0x0f, 0xbf, 0x4b, 0x28],
        name: 'RemoveIpl.dummyRange',
        note: 'movsx edi,word[ebx+0x26]; movsx ecx,word[ebx+0x28] — the ADJACENT pre-loop reads of firstDummy/lastDummy; ONE detour covers both: edi = snapFirstDummy, ecx = snapLastDummy',
      },
      {
        address: 0x404c4e,
        bytes: [0x0f, 0xbf, 0x43, 0x28],
        name: 'RemoveIpl.lastDummy.loop',
        note: 'movsx eax,word[ebx+0x28] — the loop BACK-EDGE re-read of lastDummy (every iteration) → detour: eax = snapLastDummy',
      },
      {
        address: 0x404c17,
        bytes: [0x3b, 0xf9, 0x7f, 0x3f],
        name: 'RemoveIpl.cont.404C17',
        note: 'cmp edi,ecx; jg 0x404C5A — the dummyRange detour continuation (the loop is INCLUSIVE: this jg and the back-edge jle)',
      },
      {
        address: 0x404c53,
        bytes: [0x83, 0xc5, 0x38],
        name: 'RemoveIpl.cont.404C53',
        note: 'add ebp,0x38 — the back-edge detour continuation (the clobbered inc edi is re-run inside the detour)',
      },
    ],
    strategy: 'hook',
    summary:
      "IplDef DUMMY pool-range int16 → int32 (plan 011, the 004b half): the same observer/snapshot as ipldef-range, a second sidecar pair, TWO detours over RemoveIpl's dummy pass. Field-proven necessary 2026-08-19: lastDummy wraps negative past 32 767 and the whole dummy pass is skipped, stranding ~17 600 dummies per world entry.",
  },
  {
    conflictsWith: ['fla:inst-entries-per-file'],
    id: 'loaded-buildings',
    provenance: `gta-reversed-modern source/game_sa/FileLoader.cpp — CFileLoader::LoadScene (INST case); ${PRE_SDK_RE}`,
    sites: [
      {
        address: 0x5b8938,
        bytes: [0x89, 0x04, 0x8d, 0xe0, 0xc0, 0xbc, 0x00],
        name: 'LoadScene.store',
        note: 'mov [ecx*4+0xBCC0E0], eax — relocate base + add the missing bound',
      },
      {
        address: 0x5b8940,
        bytes: [0x89, 0x0d, 0xd8, 0xc0, 0xbc, 0x00],
        name: 'LoadScene.count',
        note: 'mov [0xBCC0D8], ecx',
      },
    ],
    strategy: 'relocate',
    summary: 'gpLoadedBuildings CEntity*[4096] @0xBCC0E0 — relocate+enlarge, add the missing LoadScene bound',
  },
  {
    conflictsWith: ['fla:ipl-entity-index'],
    id: 'ipl-entity-index',
    provenance: `gta-reversed-modern source/game_sa/IplStore.cpp — CIplStore::LoadIplBoundingBox + GetNewIplEntityIndexArray; ${PRE_SDK_RE}`,
    sites: [
      {
        address: 0x405c23,
        bytes: [0x66, 0x8b, 0x43, 0x2a],
        name: 'LoadIplBoundingBox.staticIdx',
        note: 'mov ax, word[ebx+0x2a] — staticIdx into IplEntityIndexArrays',
      },
    ],
    strategy: 'relocate',
    summary: 'IplEntityIndexArrays CEntity**[40] @0x8E3F08 — relocate+enlarge, raise the 40-slot ceiling',
  },
  {
    id: 'fx-emitter-uaf',
    provenance: `gta-reversed-modern source/game_sa/Fx/FxSystem.cpp — FxSystem_c::Stop + FxSystem_c::Play (reap path: Fx/FxManager.cpp Update/DestroyFxSystem, Fx/Fx.cpp DestroyEntityFx); ${PRE_SDK_RE}`,
    sites: [
      {
        address: 0x4aa390,
        bytes: [0x56, 0x8b, 0xf1, 0x8b, 0x46, 0x08],
        name: 'FxSystem_c.Stop',
        note: 'push esi;mov esi,ecx;mov eax,[esi+8] — null-guard m_SystemBP (the 2dfx UAF crash 0x004AA3A1)',
      },
      {
        address: 0x4aa2f0,
        bytes: [0x51, 0x56, 0x8b, 0xf1, 0x80, 0x7e, 0x50, 0x02],
        name: 'FxSystem_c.Play',
        note: 'push ecx;push esi;mov esi,ecx;cmp byte[esi+0x50],2 — null-guard m_SystemBP (symmetric path)',
      },
    ],
    strategy: 'hook',
    summary:
      'FxSystem_c::Stop/Play null-blueprint guard — fixes the 2dfx fx-system use-after-free (reaped system Kill()ed on stream-out → null m_SystemBP deref). Lets particle 2dfx ride LOD clones without the crash. Fx zone: no FLA/OLA overlap.',
  },
];
