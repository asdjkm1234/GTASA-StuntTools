# WGSL ships as written — comments and indentation are 13 % of the download

**Status:** priced, not taken. Measured 2026-08-12 for
[201/1-06](../../plans/201-dispatch-console/1-the-map-profile/readme.md); the bundle table it came out of is
[2026-08-12-dispatch-bundle-inventory](../../benchmarks/opensa-engine/2026-08-12-dispatch-bundle-inventory.json).

## What we do today

`packages/engine/src/render/shaders.ts` holds every shader as a template literal — 17 blocks, written the way
source is written: comments explaining the maths, blank lines between stages, four-space indentation. Nothing
processes them. A JS minifier does not touch a template literal's contents, so the text reaches the browser
exactly as it sits in the repo, and `createShaderModule` parses it there.

That file is **107.3 kB of a 506.5 kB bundle — 21.2 %**, the largest single item on the engine side and
second overall only to `react-dom`.

## The lever

Strip comments and leading indentation from the WGSL **at build time**, shipping the same shaders with none
of the bytes that exist for a reader.

| | raw | gzip |
| --- | --- | --- |
| as written | 106.5 kB | 37.0 kB |
| stripped | 55.9 kB | 14.9 kB |
| **saved** | **50.6 kB** | **22.1 kB** |

Gzip is the number that matters, and it is the better one here: **22.1 kB off a 167.6 kB download, 13.2 %**.
It is the largest single reduction available to this surface, and it costs no feature, no pass and no
per-platform branch — the compiled shader is byte-identical in behaviour.

## What it would cost

- **Every shader-error line number moves.** WGSL compile and validation errors report line and column, and
  [gpu-and-shaders](../../restrictions/gpu-and-shaders.md) exists because this is the one class of defect no
  test in this repo can see — a uniformity violation is found by reading the browser's error against the
  source. A build that renumbers the source makes that read harder exactly when it is hardest.
  The mitigation is obvious and has to be part of the change rather than a promise: strip in the production
  build only, so `npm run dev` keeps the source the developer is reading.
- **A text transform over a shading language is a parser you now own.** Naive `//` stripping is wrong the
  moment a `//` appears inside a string literal; WGSL has no string type today, which makes it safe *today*
  and makes the guard a test rather than an argument.
- **It cannot be verified in a container.** There is no GPU here, and the fake device the unit tests use does
  not compile WGSL. The proof that the stripped shaders still compile is a run on a real adapter — which is
  why this was measured and left rather than measured and taken.

## What would have to be true to pull it

- The download budget starts to bind. It does not today: 201 states first download as *"as large as needed if
  it caches"*, and 167.6 kB gzip is not the problem the chain was worried about.
- Or the transform ships with (a) dev untouched, (b) a test that pins a stripped shader against its source
  for equivalence, and (c) a field run on the phone showing the world still renders — the protected list
  re-read, per [1/02](../../plans/201-dispatch-console/1-the-map-profile/protected-list.md).

## Cheaper things to try first

- **Nothing on this surface, and that is the point of the table.** After this lever the next item is
  `hosek-wilkie-data.ts` at 33.4 kB, and it is a live sky model, not dead text — cutting it changes the world's
  look, which [1/02](../../plans/201-dispatch-console/1-the-map-profile/protected-list.md) protects.
- React is 185.1 kB across three packages and the largest single file in the bundle. It is the chrome, the
  seam is deliberate (React never enters the frame loop), and replacing it is a product decision rather than
  a lever — noted here so the next reader does not re-derive that it is big.
