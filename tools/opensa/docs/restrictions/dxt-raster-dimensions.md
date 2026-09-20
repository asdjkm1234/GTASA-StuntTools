# DXT raster dimensions — a texture the `sa` target ships must be block-aligned, and ours are powers of two

**The rule:** every DXT-compressed texture that reaches the real game (`build/<game>/opensa` for the `sa`
target — stock, a mod's own dictionary, or one we generate) has a top level whose width AND height are
multiples of 4. Anything we ENCODE ourselves is a power of two on both sides. A DXT raster that breaks the
first half never loads — and it takes its WHOLE dictionary down with it, so every model pointing at that TXD is
never drawn (a model whose TXD is not loaded is never marked loaded).

## Where it came from (open issue [`sa-lod-visibility-budget.md`](../open-issues/fixed/sa-lod-visibility-budget.md), rounds 1–16)

The "LODs that never draw" issue was opened on this and spent nine hypotheses before the data said it: the ~6
building LODs missing all over the city sat on exactly the five clone dictionaries (of 995) that carried a DXT
texture with a side not divisible by 4 — and the sources were MODS shipping textures at 250×250 (uncompressed
A8R8G8B8, which SA takes) or 896×828 (DXT1, 4-aligned, fine); halved to 62×62 / 224×207 and DXT-compressed
by us, the same textures became fatal. Stock ships 26 004 textures across 2 759 dictionaries and **not one
that is not a power of two**, so nothing in R\*'s content could ever hit this.

Field-measured 2026-08-17 on `build/original/sa`, one dictionary swapped at a time (`img-patch.ts set`),
everything else in the tree identical:

| texture | dictionary | dims / format | loads? | what it took down |
| --- | --- | --- | --- | --- |
| `marinadoor1_256` (mod 39, our clone) | `salod0424` | 62×62 DXT1, 6 mips | **no** | `lodxhospital1`, `lodxhospground1` |
| `pizzalogo` (mod 62, our clone) | `salod0433` | 64×38 DXT3 | **no** | `lod711block02` |
| `Mich_Rmke` (mod 64, our clone) | `salod0176` | 224×207 DXT1 | **no** | `lodtainercrane_03/04` — the container cranes |
| `goldengates` (mod 57, **the mod's own file**) | `airwelcomesign_sfse` | 932×358 DXT1 | **no** | the SFSE airport sign HD |
| the same four, resampled to 64×64 / 64×32 / 256×256 / 1024×512 | — | pow2 | **yes** | all of them back |
| `Mich_Rmke` (mod 64, the HD file) | `cranes_dyn2_cj` | 896×828 DXT1 | yes | — (4-aligned NPOT is fine) |
| `pizzatext` (mod 62, our clone) | `salod0433` | 700×52 DXT3 | yes\* | \*it shared the dictionary with `pizzalogo`; 4-aligned |
| ten `awning*`/`chtown_*` clones | `salod0135` | 128×48, 60×128 … DXT1 | yes | 4-aligned NPOT, LODs render |

So the fatal property is **a side that is not a multiple of 4** — the DXT block size — not "not a power of
two". Whether the refusal is D3D9's `CreateTexture` (compressed formats want block-aligned top levels), Wine's
wined3d check ("compressed texture dimensions not multiple of block size") or RenderWare's own raster
create was not separated and does not need to be: the target install is CrossOver, and the field is the
verdict.

## What implements it, and what catches a violation

- **`tools/lod-common/src/encode-txd.ts`** (`encodeHalvedTxd`, `encodeLodTxd` — every clone/cell/procobj
  dictionary we generate): after the size reduction, every level is resampled to the nearest power of two per
  side (`resampleToPow2` from `@opensa/cell-weld/alpha`, bilinear, floor 4). Powers of two rather than "next
  multiple of 4" because that is the shape 100 % of stock occupies AND it keeps every mip level block-aligned
  for free. Test: `encode-txd.test.ts` ("never emits a DXT raster whose side is not a power of two").
- **`tools/map-optimizer/src/adapters/gta-sa/textures.ts`** (`optimizeTxd`, the pass over EVERY dictionary of
  the built tree, mods included): a DXT texture that is not block-aligned is decoded, resampled to the power of
  two **rounded UP** (an author's texels are never reduced), given a full mip chain and written back in the
  same DXT format from a fresh header — `resized` in the run summary. 4-aligned NPOT textures are left as the
  author shipped them (they load; honour the data). Test: `textures.test.ts` ("never leaves a DXT raster whose
  top level is not a multiple of 4").
- **Caught:** in code by the two unit tests, and by construction — the two writers above are the only paths a
  DXT raster takes into the `sa` tree (`img-patch.ts set` bypasses both: a hand-patched TXD is on its own). Census
  on a built tree: `scripts/debug/txd-dimension-census.ts` lists every DXT texture that is not block-aligned
  (0 on a build made after 2026-08-17). **Named at INSTALL time** since 2026-08-17: mod-installer warns
  `<mod> ships <txd>: <texture> WxH <fmt> — not a multiple of 4, the real game refuses the whole dictionary
  (map-optimizer will resample it)` for every such raster a mod brings — a `.txd` it injects into an archive
  or the Modloader baker collects, a loose `.txd` overlay, or a texture folder whose PNG our encoder turned
  into a non-aligned DXT (mod-installer plan 014; the bytes are still installed as shipped). **SILENT at
  runtime**: the game logs nothing, our engine draws the
  same bytes fine, and the symptom is a building whose LOD (or HD) is simply not there.

## What it does NOT say

- Uncompressed rasters (8888/565/1555) at odd sizes load — the mods prove it (250×250 A8R8G8B8 hospital
  door). This rule is about DXT.
- OpenSA's own pak (`opensa-pack`) already resamples to pow2 for WebGPU BC alignment (`cell-weld/alpha.ts`,
  the very same 62×62 case) — a different consumer, the same fix.
