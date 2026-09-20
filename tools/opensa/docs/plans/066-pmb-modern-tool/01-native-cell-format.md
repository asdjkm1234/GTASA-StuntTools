# 066·01 — Native cell format (foundation)

[← chain](readme.md) · next: [02 batching](02-static-batching.md)

The foundation the rest of the chain rides on: a lean, versioned, opensa-native per-cell binary emitted **beside**
DFF/TXD, with the runtime preferring it when present and falling back otherwise. No new lighting yet — this plan is the
container, the compression, and the round-trip, so later plans have somewhere to write batched geometry (02) and baked
channels (03/04).

## Context

- pmb's `opensa` target emits **DFF/TXD/IMG** today — one baked DFF per grid cell into `models/lods.img`
  (`opensa-lod-generator/finalize.ts`), parsed at runtime by our own worker-offloaded parser (plan 060). map-optimizer
  already welds vertices, computes smooth-group normals, seam-welds prelit, and compacts buffers — that welded cell mesh
  is the natural input here.
- We own the writers/readers and a VFS. DFF/TXD were never a great runtime container (TXD DXT is re-encoded on load;
  DFF carries chunk overhead we don't use). A custom binary lets us pick GPU-friendly encodings.

## Decisions

1. **Versioned header** (small, JSON-ish or fixed struct): format version, cell bounds, material table, per-buffer
   offsets/lengths, flags (has-sunVis, has-skyVis, has-emissive, is-batched). Version gate = forward-safe fallback.
2. **Geometry**: meshopt-compressed vertex + index buffers (position, UV, normal, prelit day + night, plus room for the
   later 1-byte channels), decoded via `MeshoptDecoder` **in the existing DFF worker** (transferables, same as today).
3. **Textures**: cell atlas/dictionary as **KTX2 (Basis UASTC/ETC1S)**, loaded via `KTX2Loader`. KTX2 stays GPU-compressed
   (no RGBA re-upload), halves VRAM, and kills the current TXD decode cost. Linear-space audit: encode targets linear
   (our [038 prelit](../038-sa-prelit-lighting/readme.md) linear-space pipeline) — no double conversion.
4. **Additive + fallback**: emitted alongside DFF/TXD; the game adapter loads native cells when the VFS has them, else
   the DFF path unchanged. A build can ship both; a cell missing native data renders as today.

## Tasks

- [~] Format spec: versioned header + buffer layout doc in the pmb readme; a TS type for the header.
- [~] Writer: new pmb step (opensa target) emitting `.cell` binaries into a native IMG/VFS beside `lods.img`;
      `--until` compatible; deterministic byte output.
- [~] Reader: game adapter path (worker, transferables) → `BufferGeometry` + material; graceful when absent.
- [~] meshopt integration: encode at build, `MeshoptDecoder` at runtime; **round-trip unit tests** (positions/UV/normals/
      prelit bit-exact within quantization tolerance).
- [~] KTX2: basisu encode step at build + `KTX2Loader` runtime path; linear-space audit; VRAM before/after probe.
- [~] Size budget guard: per-cell byte report; pmb fails if native total exceeds a configured ceiling.

## Verification

- Round-trip: a welded cell → native → loaded geometry matches the DFF path within quantization tolerance (fixtures).
- Load bench: parse + upload time native vs DFF on the same cells; VRAM delta from KTX2.
- Fallback: delete native data for a cell → it renders via DFF identically; both pipelines green.

## Measurements

_(record after implementation)_

- bytes/cell DFF → native; decode ms native vs DFF parse; VRAM RGBA → KTX2; bake/encode time full map: …
