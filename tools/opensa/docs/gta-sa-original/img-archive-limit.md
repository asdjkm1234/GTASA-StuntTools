# The IMG-archive limit, and how a third-party adjuster lifts it

What the ceiling actually is, and the mechanism a working reference implementation uses — studied so our own
ASI can lift it deliberately rather than by imitation. The rule a design must satisfy is in
[`restrictions/sa-target.md`](../restrictions/sa-target.md); the install's numbers are in
[reference-install.md](reference-install.md).

> **NOT NEEDED TODAY, and the reason matters (2026-08-15, the user's field run).** The shipped layout fits
> the stock table **exactly**: `splitBuckets: ['vehicles']` puts the mod car set into `vehicles.img` + one
> spill sibling, so the built `gta.dat` carries 5 `IMG` lines against 3 hardcoded archives — **8 of 8**. The
> game launched and played with no adjuster work at all.
> **Read that verdict precisely**: it does not show the ceiling is lifted on that install, it shows we never
> reached it. From the outside the two are indistinguishable, and only one of them survives a ninth archive.
> **What makes the lift below real work again**, any one of: a bucket beyond vehicles getting its own archive
> (the classifier already produces peds and weapons); the vehicle payload growing past two files, or the map
> bucket needing a spill sibling (it sits at 1.64 GB against a 1.75 GiB cap); any other stage wanting a
> `models/*.img` of its own.

## The ceiling has TWO halves, and only one of them is `ms_files`

- **`CStreaming::ms_files` — 8 entries.** Derived from gta-reversed `Streaming.h` (2026-08-15): the array is
  at `0x8E48D8`, the next static `ms_bLoadingBigModel` at `0x8E4A58`, a `0x180` gap over a
  `tStreamingFileDesc` the header size-asserts at `0x30`. GTAMods corroborates: three hardcoded
  (`gta3`/`gta_int`/`player`) plus five from `gta.dat`.
- **The CdStream side.** The file handles and per-stream state the reader uses live in their own tables, in
  the `CdStream` code region around `0x406A20` (`CdStreamRead`) and `0x4083xx`–`0x4084xx`. This is the half
  fastman92's separate *IMG & Stream Limit Adjuster* advertises as `MAX_NUMBER_OF_STREAM_HANDLES = 400`
  beside `MAX_NUMBER_OF_IMG_ARCHIVES = 127`.

**Raising the archive count means moving both.** A plan that budgets only for `ms_files` has budgeted for half
the work. (The exact CdStream function names are not confirmed here — only the addresses the adjuster
touches, listed below.)

## The mechanism, read out of `SimpleLimitAdjuster_IMGfiles.asi`

A 97 920 B MSVC-built PE32 DLL, no ini and no configuration strings — every address is hardcoded. Its
imports are the whole story of what it does: `VirtualProtect`, `GetModuleHandleA/W`, `HeapAlloc`.

It **relocates the table into its own allocation and rewrites the instructions that referenced the old one.**
The repeated block, verbatim in shape:

```asm
push  eax                 ; &oldProtect
push  0x40                ; PAGE_EXECUTE_READWRITE
mov   esi, 0x4083C1       ; the address of an OPERAND inside a game instruction
push  0x4                 ; 4 bytes
push  esi
call  [VirtualProtect]
lea   eax, [ebx+0x2C]     ; ebx = the plugin's new table base
mov   DWORD PTR [esi], eax ; the instruction now reads OUR table
call  [VirtualProtect]    ; protection restored
```

This is why the old array address never appears anywhere in the file — searched for as an absolute and as an
RVA, zero hits. **It patches the operand SLOT, not the value**: it already knows where each instruction's
4-byte immediate sits, and writes `newBase + fieldOffset` into it.

The fifteen sites it opens:

| Address | Size | What it does |
| --- | --- | --- |
| `0x406A20` | 1 B | **Read, not written** — probes whether `CdStreamRead` already starts with `0xE9` (a JMP), i.e. whether another plugin has hooked it, and adapts |
| `0x40757F` | 4 B | operand → `newBase + 0x2C` |
| `0x4083C1` | 4 B | operand → `newBase + 0x2C` |
| `0x4083DE` | 4 B | operand → `newBase + 0x62C` |
| `0x4083E9` | 4 B | operand → new base |
| `0x4083FA` | 4 B | operand → `newBase + 0x600` |
| `0x40840B` | 4 B | operand → new base |
| `0x40841A` | 4 B | operand → `newBase + 0x600` |
| `0x40843B` | 4 B | operand → new base |
| `0x40845B` | 4 B | operand → `newBase + 0x2C` |
| `0x408461` | 4 B | operand → `newBase + 0x28` |
| `0x408479` | 4 B | operand → new base |
| `0x4084A2` | 4 B | operand → `newBase + 0x2C` |
| `0x4084A8` | 4 B | operand → `newBase + 0x28` |
| `0x409D5A` | 4 B | operand → `newBase + 0x2C` |

The `0x28` / `0x2C` and `0x600` / `0x62C` offsets are two structures inside one allocation, each referenced
by a base and a base+4 field.

It also compares against game addresses such as `0x8245B0` before patching — an identity check on the loaded
image rather than a real fingerprint.

## What we take, and what we do differently

- **Take the technique.** Relocate + rewrite operands is the right shape: nothing hooks a function, nothing
  trampolines, and the game's own code keeps running unmodified apart from where it looks. Fifteen sites is a
  small, auditable surface.
- **Take the coexistence probe.** Reading `CdStreamRead`'s first byte to notice an existing hook is exactly
  the check our target needs — it already runs OLA + FLA + `perfect-map.asi`, and this limit is one
  **nothing else on that install owns** (FLA's ini patches ID pools, not the archive count).
- **Do NOT take its trust model.** The operand rewrites go in blind: the plugin does not verify what it is
  overwriting. Our SDK's rule is the opposite — every address and expected byte is declared once in the
  catalogue and verified before anything is applied (`asi/sdk`, and the fingerprint gate that goes with it),
  which is what makes a wrong exe a loud no-op instead of a corrupted process.

**Source:** `NO_COMMIT/img-limits/SimpleLimitAdjuster_IMGfiles.asi`, studied 2026-08-15 with
`i686-w64-mingw32-objdump`. `NO_COMMIT/` is temporary; this file is what has to survive it.
