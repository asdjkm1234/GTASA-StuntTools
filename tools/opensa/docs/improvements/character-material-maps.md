# Character material maps (normal / emissive / spec)

**Status: parked — not doing yet.** The diffuse texture renders correctly; the extra PBR maps a model
ships are simply ignored. Captured while fixing the **T800** ped (see below). No code written for this.

## Relevance check (2026-07-19, after the own-engine flip + opensa-pack 003)

**Still relevant — the premise holds, but the render half of this doc is three-era.** Verified:

- The named builders SURVIVED the teardown and are the live path: `build-ped-model.ts` and
  `vehicle/textures.ts` still resolve exactly ONE texture per material (`material.texture?.name`,
  `textures.ts:61`) for both the runtime DFF fallback and the opensa-pack `.osm` conversion (they
  share these builders). The T800 example and **option 1 (sibling-by-suffix lookup)** stand as
  written — and the lookup must live in the shared builder so offline and runtime paths agree.
- Everything downstream changed. There is no three material to hang extra maps on; implementing
  this now means: extra layers/channels in `VehicleModelInit`/the `.osm` `TEXS` section (format
  work, opensa-pack + engine reader), WGSL sampling in the rigid/skinned paths, and for normal
  maps a **tangent attribute = vertex-format growth** — something the engine has deliberately
  avoided so far (UV-scroll shipped format-neutral); screen-space-derivative tangents are the
  cheaper first option.
- Overlaps to respect when picking this up: emissive should REPLACE the rigid path's night-glow
  luma-delta heuristic where authored (and compose with the `dn` night mix + the lamp-texture
  swap); per-material metadata rides the plan-16 precedent (`MaterialClass` nibble in `meta.w`).
  NOT superseded by `roadmap/0.6.0/03-vehicle-normals` — that is geometry normal smoothing, not
  normal MAPS.

## Idea

The ped/vehicle model builders (`packages/renderware/src/ped/build-ped-model.ts`,
`vehicle/textures.ts`) resolve **one** texture per material — the RW
material's diffuse (`rw.texture`). Modern ped/vehicle mods ship a texture _set_ per material, conventionally
suffixed: `_D` diffuse, `_N` normal, `_E` emissive (sometimes `_S` spec). We use `_D` and drop the rest, so
those models render flat-lit — visually fine but without surface relief or self-illumination the author
intended.

Example — the **T800 endoskeleton** ped
([gtainside #144069](https://www.gtainside.com/en/sanandreas/skins/144069-endoskeleton-terminator-t800/)),
dropped into the ped install source (`mods-src/original/peds/`, ped-installer). Its TXD carries the full set:

| Texture          | Size  | Format | Role (suffix)                                                           |
| ---------------- | ----- | ------ | ----------------------------------------------------------------------- |
| `TRM_Skeleton_D` | 1024² | DXT1   | diffuse — **used**                                                      |
| `TRM_Skeleton_N` | 1024² | DXT1   | normal — ignored                                                        |
| `TRM_Skeleton_E` | 512²  | DXT5   | emissive — ignored                                                      |
| `ENV`            | 256²  | DXT1   | env/reflection — ignored unless the material's RW env-map effect is set |
| `USF`            | 512²  | DXT1   | (unused by the materials)                                               |

The materials reference `TRM_Skeleton_D` and `TRM_Skeleton_E` by name; only the `_D` lands as `map`.

> Note: the original T800 "all-black" symptom was a **separate** bug (PRELIT flag + no vertex-colour
> attribute → texture × `(0,0,0)`), fixed by ignoring prelit vertex colours on peds. That fix
> makes the diffuse show. This improvement is only about the _additional_ maps.

## Approach options

1. **Convention-based sibling lookup.** When resolving `<name>_D` (or any `<name>`), also probe the texture
   dict for `<name>_N` / `<name>_E` / `<name>_S` and upload them as extra layers the ped/vehicle shader
   samples as normal / emissive / spec. Zero new asset metadata — pure naming heuristic. Risk: false matches;
   suffix conventions vary between authors. Gate it so a missing sibling is just a no-op (today's behaviour).
2. **Read the RW material texture list properly.** A RW material can hold more than one texture chunk; parse
   them and map by role if RW tags them. More correct, more parser work, and many mods still rely on naming
   rather than RW roles.

Likely start: option 1 (sibling-by-suffix), behind the existing `textures` list so it stays a no-op for
models that ship only a diffuse (army/tommy/Shrek).

## Caveats

- Normal maps need tangents — `build-ped-model.ts` would have to emit a `tangent` attribute (or the shader
  can derive one from screen-space derivatives).
- Emissive should compose with the engine's night lighting, not fight it.
- DXT normal maps can stay compressed (BC); just don't treat `_N` as sRGB.
