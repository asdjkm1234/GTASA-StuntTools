# 002 — TS codegen extraction + provenance convention

Part of the [asi/sdk chain](readme.md). Depends on 001. Moves the TypeScript half of the codegen
into the SDK and adopts the provenance convention decided at review. **Referee: perfect-map's
generated `src/generated/patches.hpp` is byte-identical before/after.**

## Context

Perfect-map's `gen/generate.ts` is a pure catalogue→header renderer plus a hard-error validator;
its interfaces (`ByteAnchor`, `FileAnchor`, `Fingerprint`, `CatalogueEntry`) and the `FINGERPRINT`
constant (the canonical exe identity) are plugin-agnostic — the city-life roadmap plan already
declares it will reuse the fingerprint verbatim. Only the `CATALOGUE` array (addresses, bytes,
strategies) is perfect-map's own. The emitted namespace is currently hard-coded (`pm::gen`); it
becomes a parameter so the header stays byte-identical for perfect-map while a future plugin gets
its own.

## Decisions

1. **SDK layout:** `asi/sdk/gen/` — `catalogue.ts` (the interfaces), `render.ts`
   (`renderHeader(catalogue, {namespace})` + `validate()`), `sa-fingerprint.ts`
   (`SA_FINGERPRINT`). Co-located tests.
2. **The generator stays plugin-invoked:** each plugin keeps a thin `gen/generate.ts` that imports
   the SDK library, passes its catalogue, namespace and output path. No SDK CLI — a library, like
   the C++ half.
3. **Provenance convention (review verdict):** `CatalogueEntry` gains a required `provenance`
   field — the gta-reversed-modern file/function the entry was derived from and the commit
   consulted at RE time. The four existing entries record their file/function (known from
   `docs/patch-catalogue.md`) with the commit honestly marked unrecorded (pre-SDK RE, 2026-07);
   the convention binds new entries. Navigation, not correctness — the exe-side byte verify
   remains the referee.
4. **Validator scope unchanged:** the SA address range (`0x400000..0x2000000`) is SA ground truth
   and stays; this is an SA-scoped SDK.
5. **Test split:** synthetic-fixture validation/render tests move to the SDK; "renders the real
   catalogue" and the fingerprint-value assertions stay perfect-map's.

## Tasks

- [x] `asi/sdk/gen/` per decision 1, moved (not copied) from perfect-map; perfect-map's
      `gen/catalogue.ts` keeps `CATALOGUE` and imports the interfaces + `SA_FINGERPRINT`;
      its `gen/generate.ts` becomes the thin invoker (decision 2).
- [x] Provenance field + the four entries filled (decision 3);
      `asi/perfect-map/docs/patch-catalogue.md`'s provenance section points at the typed field as
      the machine home.
- [x] Test split (decision 5); suite green.
- [x] Referee: regenerate → byte-compare against 001's tree (upgraded to an artifact-level A/B —
      see the ledger).

## Verification

`npm run gen -w @opensa/perfect-map-asi` emits a byte-identical `patches.hpp`; full suite + tsc +
`eslint .` green; the SDK has no import from `asi/perfect-map` (dependency direction holds).

## Measurements / notes

### Shipped (2026-08-06)

- **The referee found the chain's real determinism blocker, then passed at artifact level.** The
  regenerated header differed in exactly ONE comment line (the SDK renderer drops perfect-map's
  "plan 004" reference from the section comment) — constants byte-identical. But the rebuilt
  `.asi` hash-mismatched the 001 baseline, and the diff was 5 bytes of ASCII digits + the PE
  checksum: `patch_table.hpp`'s banner embeds `__DATE__ __TIME__`. **001's "deterministic" verdict
  had been a same-second fluke** (both probe builds landed at 15:33:25) — an A/B without a
  run-order control. The chain's referee protocol is therefore: build with pinned
  `SOURCE_DATE_EPOCH=315532800` (GCC substitutes it into `__DATE__`/`__TIME__`; shipping builds
  keep live timestamps), proven stable across a 2 s gap.
- **Artifact-level A/B (pinned epoch): PASSED byte-identical.** Pre-002 tree (stashed, old
  self-contained generator, "plan 004" comment present) and post-002 tree (SDK renderer) both
  build `perfect-map.asi` APPLY=1 → sha256
  `a0a18659eb1c338337ab8dca98989eefffc247d7417312e25d7a403b25737188` (16 384 B); verify-only →
  `8019f8133864cc210fbe174edc27711ec8488a994306a37aa3b0eb6a0a11e028` (9 728 B). These supersede
  001's baseline hashes as the chain's referee input.
- Import style settled (chain readme open question): perfect-map is a workspace member, so it
  imports `@opensa/asi-sdk/*` by package name through the `exports` map — no tsconfig paths
  needed (the `@opensa/cleo` precedent).
- Tests: SDK 8 (6 negative + 2 positive, incl. the namespace-parameter case) + perfect-map 3
  (fingerprint pin, real-catalogue render, provenance-line shape) = 11 green in `asi/`; tsc +
  `eslint .` clean.
