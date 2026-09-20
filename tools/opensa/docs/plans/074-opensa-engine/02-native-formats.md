# 074·02 — Native formats (`.oscell` / `.ostex` / `.ospak`)

[← chain](readme.md) · prev: [01 architecture](01-framework-architecture.md) · next: [03 converter](../../../tools/opensa-pack/docs/plans/000-converter-tool.md)

GPU-ready by construction: the runtime "codec" is a header parse + `queue.writeBuffer/writeTexture`. Little-endian,
4-byte aligned sections, every file starts `magic u32 | versionMajor u16 | versionMinor u16`. Readers reject unknown
majors loudly; minors only ADD optional sections. v0 is explicitly throwaway.

## `.oscell` — one streamed cell (HD or LOD level)

```
header   magic 'OSC1' | version | flags | boundsSphere f32x4 | channelMask u32 | counts
sections vertexBuffer   — ONE interleaved buffer, final GPU layout (below)
         indexBuffer    — u32 (u16 when the cell fits — flag)
         groupTable     — GroupRecord[] : the DRAW LIST
         objectTable    — ObjectRecord[]: unmergeable objects (timed/breakable/animated/2dfx anchors)
         lightTable     — 2dfx lights/coronas/particle anchors (transplanted by the existing LOD chain)
```

**Vertex layout v0** (stride 40 B; order fixed, presence via `channelMask` — absent channels take a shared
zero-buffer binding, NOT a repack):

| Attr           | Format                                      | Note                                                                                                       |
| -------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| position       | f32x3                                       | world-cell-local (cell origin in header) — full precision; quantization is a v1 experiment                 |
| normal         | snorm8x4                                    | .w unused; oct-encoding is a v1 experiment                                                                 |
| uv             | f32x2                                       | GTA UVs TILE far outside [0,1] — f32 in v0, f16 only after measuring the largest tiling ranges             |
| dayPrelit      | unorm8x4                                    | RGB day prelight (existing bake), A = beam/cone alpha where used                                           |
| nightPrelit    | unorm8x4                                    | RGB night set (existing bake), A = sway weight (wind)                                                      |
| layer+channels | u16 layer, unorm8 aoSkyVis, unorm8 emissive | **per-vertex texture-array layer index** — THE batching enabler; ao/emissive filled by 07, zero until then |

**GroupRecord** (one GPU draw): `pipelineClass u8 (opaque|cutout|blend|beam) | side u8 (front|double) |
textureArrayRef u16 | indexOffset u32 | indexCount u32 | boundsSphere f32x4`. Groups are the unit of
merge: same array + same pipelineClass + same side ⇒ one draw regardless of how many source models/textures.
Group bounds allow sub-cell culling later without a format change.

**ObjectRecord**: `kind u8 (timed|breakable|animated|roadsign) | params (on/off hours, model ref, anim ref) |
own group range | transform f32x12`. These render OUTSIDE the cell bundle.

**PlacementRecord** — `OscellPlacement` in code (minor 6, the debugger's MAPPER — 40 B): `id u32 |
nameRef u16 | txdRef u16 | indexOffset u32 | indexCount u32 | bounds f32x6`, followed by the cell's name
pool. The AABB is **cell-local** on disk, like every other position in the file; the runtime store shifts it
by the cell origin when it parses the table. Merging is the whole
point of a group, and it erases which triangles came from which placed object; this writes that identity back
down so the F2 Map screen can pick, name and hide one. `id` is the SAME FNV-1a placement hash the breakable
table and the physics colliders carry. Rows of one object that ended up adjacent in the final index buffer are
merged offline. **Runtime-optional by design:** the engine parses it (and retains index bytes) only under
`CellStore.debugPicking`, on the estimate that a full map's mapper runs to tens of MB against a 21 MB heap —
an ESTIMATE the user's rebuild is owed a real number for. See 22 phase 8.

## `.ostex` — texture ARRAY container

One file = one `texture2d_array` (all layers same W×H×format — the bucketing unit):

```
header  magic 'OST1' | version | format u8 (BC1|BC3|BC7|RGBA8) | width u16 | height u16 |
        layers u16 | mipCount u8 | flags (premultiplied)
layerTable  per layer: sourceName hash u32 | alphaClass u8 (opaque|cutout|softBlend) |
            cutoutRef unorm8 (A2C reference) | wrap u8
payload  tightly packed: layer-major, mip-minor, each mip 256-B row-aligned for writeTexture
```

Decisions:

- **Arrays, not atlases** — GTA UVs tile; atlases measured −7 % (066). Arrays keep native per-layer wrap.
- **Bucket = exact W×H×format.** SA textures are overwhelmingly pow2; the odd ones (62×62 …) are RESAMPLED to
  the nearest pow2 offline — this also kills the WebGPU BC-alignment problem at the root (073 workaround
  decoded them to RGBA at runtime; gone).
- **Opaque textures pass through** their existing DXT payload (SA data is already BC1/2/3) — no recompress, no
  quality loss, converter stays fast. Only the ALPHA subset + odd sizes go through decode → process → re-encode
  (BC3 in v0; BC7 as a v1 upgrade — encoder options in 03).
- **Premultiplied everywhere alpha exists** + offline mips (alpha-weighted + dilation + per-mip coverage
  preservation) — the [alpha-edge](../../open-issues/fixed/alpha-edge.md) fix lives HERE; see 03 for the pipeline.
- Mip chain is COMPLETE in-file down to 1×1 (or 4×4 for BC) — the runtime never generates mips.

## `.ospak` — the archive (replaces holding a ~1 GB IMG ArrayBuffer in JS)

```
manifest.json  — format versions, cell index {key → offset,len,hash}, texture-array index, totals
world.ospak    — concatenated .oscell/.ostex payloads, 4 KiB-aligned entries
```

- Runtime reads **ranges only** (Cache API / HTTP Range) in a worker; JS never holds the whole pak.
- Content-hash per entry → incremental converter re-runs and cache-friendly delivery.
- HD and LOD levels of a cell are separate entries (streaming swaps them independently, exactly as today).

## Explicit non-goals for v0 (measured before adopted, v1 candidates)

meshopt compression (structure first, bytes later) · position/uv quantization · oct normals · sub-cell chunk
splitting of groups (format supports it via group bounds; the converter knob comes when a bench says so) ·
BC7 for everything · KTX2 container compatibility.

## Tasks

- [~] Freeze the v0 binary layout above as `packages/engine-formats` (pure types + read/write functions shared
      by tool and runtime; ZERO deps) — after chain approval.
- [~] Golden-file round-trip tests (write → read → deep-equal) + hexdump fixtures for one tiny synthetic cell.
- [~] Version/`channelMask` negative tests (unknown major rejected; absent channels get the zero-buffer path).
- [~] Measure & record: bytes/cell HD and LOD (vs today's DFF+TXD slice), groups/cell histogram for the M0
      district (target: HD ≤ 8, LOD ≤ 4 after array grouping).
- [~] Written note per deferred v1 item with the bench number that would justify it.

## Measurement ledger

(bytes/cell, groups/cell, array count/sizes, pak total — filled by 03 runs)
