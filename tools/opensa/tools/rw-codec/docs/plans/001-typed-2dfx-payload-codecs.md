# 001 — Typed 2dfx payload codecs

**Shipped 2026-08-07.** Came from
[07 — LOD generators, extended](../../../../docs/roadmap/0.5.0/readme.md)
(`rw-codec/01`) and moved here when it landed, per that plan's working rules. Gated on nothing; split out of
the old A2/A3 so the codec ships and is proven on its own, before anything transforms a payload with it.

Before this, `@opensa/rw-codec/dff` treated every 2dfx entry as opaque bytes: `extract2dfxEntries` /
`build2dfxSection` preserve any type verbatim and `build2dfxSection` rewrites only the first 12 bytes (the
position). That is enough to MOVE an entry and not enough to ROTATE one, which is why baked cells drop every
rotation-bearing type. This plan added the missing typed layer and nothing else.

## Scope

Three payloads, chosen because they are the ones a LOD wants to carry and the runtime parser already knows
how to read (`packages/renderware/src/parsers/binary/dff.ts` decodes all of them — the field layouts are not
research, they are a port):

| Type | Payload | Why it needs decoding |
| --- | --- | --- |
| **7 — roadsign** | plate size, **rotation**, flags, 4×16 chars of text | orientation is in the payload; a position-only transplant leaves the plate facing the wrong way |
| **10 — escalator** | bottom / top / end **vec3s**, direction | the geometry IS three points; moving the entry without moving them is meaningless |
| **1 — particle** | `effects.fxp` system name (24 bytes) + parameters | needed by [lod-common/03](../../../lod-common/docs/plans/008-emitter-thinning.md) only if rate-scaling turns out to need a payload edit — decode it here, decide there |

Everything else stays opaque and byte-verbatim. Do not build codecs for types nobody sees at LOD range.

## Decisions

1. **Decode / encode, not parse / render.** The deliverable is a symmetric pair per type in `rw-codec`,
   beside `build2dfxSection` — no transform logic, no policy, no LOD awareness. Those live in
   [lod-common](../../../lod-common/docs/plans/006-2dfx-entry-transform.md);
   keeping them out of the codec is what lets the round-trip test be an identity.
2. **Byte-identity is the contract.** `encode(decode(entry)) === entry` for every real entry we can find, not
   just for synthetic ones. This is the guard that says the decode did not quietly lose a field, and it is
   the reason this is its own plan: once a caller starts transforming payloads, an asymmetric codec becomes
   invisible corruption in a DFF nobody reads by hand.
3. **Real fixtures, not synthetic.** Per
   [`restrictions`](../../../../docs/restrictions/assets-and-data.md) and the project's fixture convention,
   the subjects are real stock models carrying real entries. All four were already in the tree — no manifest
   line was needed.
4. **Field-width honesty.** Where the runtime parser reads a field the writer cannot reproduce (padding,
   reserved bytes, a length we infer), the codec keeps the original bytes for that span rather than
   re-deriving them. See the measurements — one such span is not hypothetical.

## What shipped

`tools/rw-codec/src/two-d-effect.ts` (exported as `@opensa/rw-codec/two-d-effect`):

- `decode{Roadsign,Escalator,Particle}2dfx(entry)` / `encode…(value)`. They take and return a WHOLE entry
  (`position(3×f32) + type(u32) + dataSize(u32) + data`), so a decoded value can be edited and dropped
  straight back into a `Raw2dfxEntry`'s `bytes`.
- `fixedFieldText(field)` — reads a fixed-width character field up to its NUL, for callers that want the
  particle's system name or a plate's line as text.
- The type ids and `ENTRY_HEADER_BYTES` now live here; `dff.ts` imports them instead of keeping its own
  copies (the only change to existing code — no behaviour moved).

Validation is loud, because these bytes come from a FILE: a decode rejects a wrong type, a header that
declares a payload length other than what was supplied, and a payload shorter than its layout; an encode
rejects a text line or name field of the wrong width.

## Tasks

- [x] Port the roadsign(7) field layout from the runtime parser into a `rw-codec` decode/encode pair.
- [x] Same for escalator(10) and particle(1).
- [x] Round-trip identity tests over real fixture entries (all three types) — byte-for-byte equality of the
      re-encoded entry, and of the whole rebuilt 2dfx section.
- [x] A negative test per type: a truncated / short entry is rejected loudly rather than decoded into garbage.
- [x] Enumerate, across the stock corpus, how many entries of each type exist and in how many models — the
      denominator every later "we carried N of M" claim needs.

## Verification

`npx vitest run tools/rw-codec/src` — 8 files, 45 tests, of which 17 are new
(`two-d-effect.test.ts`). Subjects:

| Type | Fixture | Entries |
| --- | --- | --- |
| 7 roadsign | `fixtures/custom/proper-fixes-models/vegasnroad19.dff` (committed) | 4 plates |
| 10 escalator | `fixtures/original/dff/escalator/escl_la.dff` | 2, beside 4 undecoded type-9 entries |
| 1 particle | `fixtures/original/dff/particle/skullpillar01_lvs.dff`, `…/refchimny01.dff` | 1 each |
| 0 light | `fixtures/custom/proper-fixes-models/trafficlight1.dff` | the wrong-type subject |

- `encode(decode(e)) === e` byte-for-byte holds on every type-7/10/1 entry in the fixture set.
- The mall section rebuilt with both escalators re-encoded and the four **type-9 cover points passed through
  untouched** is byte-identical to the source section — the guard that this codec cannot corrupt a type it
  does not decode.
- No consumer changed: nothing outside `rw-codec` imports the new codecs yet, so no generator output moves.
  (Per plan 07's working rules, no map was rebuilt for this step.)

## Measurements / notes

**Stock corpus census** — `npx tsx scripts/debug/two-dfx-census.ts --game original`, 14 865 models,
0 unreadable. The script is kept (`docs/debug/README.md`) because this denominator gets quoted again by every
later step in the chain.

| Type | Entries | Models | Payload sizes seen |
| --- | --- | --- | --- |
| 0 light | 2203 | 327 | 80 |
| 1 particle | 64 | 43 | 24 |
| 3 ped attractor | 916 | 266 | 56 |
| 6 enter/exit | 78 | 71 | 44 |
| **7 roadsign** | **489** | **207** | 88 |
| 8 trigger point | 33 | 7 | 4 |
| 9 cover point | 15 007 | 1210 | 12 |
| **10 escalator** | **5** | **4** | 40 |

Three things that fall out of it and change how later steps are argued:

1. **Every type has exactly ONE payload size across the whole corpus.** The fixed layouts this codec assumes
   are not a fixture accident — no stock entry is longer or shorter than its type's size.
2. **Escalators are 5 entries in 4 models.** The escalator half of "rotation-bearing 2dfx on cells" is a
   handful of assets, so it will never show up in an aggregate count; it has to be verified by looking at
   those four models. Roadsigns (489 in 207 models) are where the visible win is.
3. **`build/<game>/opensa/models/*.img` is NOT the shipped corpus** — it holds ~540 models (the map lives in
   the pak). A later "we carried N of M" claim has to count inside the pak, not in those archives.

**The span kept verbatim rather than re-derived** (decision 4): the particle entry's 24-byte FX-system name.
On `skullpillar01_lvs` the name is `fire` and **the 19 bytes past its terminator are not zeroed** — writing
the field back from a string would have changed them. That is now a named test rather than a guess. Roadsign
text lines (4×16) and the roadsign entry's trailing 2-byte pad are kept as raw spans for the same reason; the
pad is surfaced as `trailing`, so an entry with unexpected extra bytes survives a round trip instead of
being truncated.
