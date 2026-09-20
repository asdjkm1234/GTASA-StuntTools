# The ADC-strip fallback (read the array we know is not the drawn one)

**What it is.** When a geometry's BinMeshPLG is a **tristrip** and its extension carries the **ADC plugin
(`0x134`)**, `readBinMeshTriangles` returns null and the parser falls back to the Struct face array —
`packages/renderware/src/parsers/binary/dff.ts`. Everywhere else (plan 095) the triangles come from the
BinMesh index data, because that is what RenderWare draws.

**What it stands in for.** Decoding ADC. It is a PS2 strip format that keeps its parity/restart decisions in
per-index bits, so the plain PC unwind rule (alternate winding, drop the degenerate joins) does not describe
it. We do not read those bits, so for these files we knowingly read the array we have just declared to be the
wrong one.

**What it was judged on.** Measurement, not looks. Unwinding them with the PC rule INVENTS triangles: every
geometry of `bloodrb` grew 10–40 % (geom 18: 1050 → 1487), and the extras were not the harmless zero-area
joins — only 68 of its 4327 triangles have zero area. The face array, by contrast, reproduces exactly the
count the Struct declares. The fallback is therefore the strictly better read of these two files, even though
it is the worse rule in general.

**Scale, and why it is cheap.** Exactly **two DFFs in the whole game carry the plugin — `bloodrb` and
`rccam` — and both are STOCK** (present in `game-src/original`, not shipped by any mod; measured over
13 003 archive DFFs). Neither is a map model, so no cell weld is affected. Whether their face arrays happen
to agree with the drawn data was never checked: for two vehicles nobody has reported a problem with, the
cheap correct-by-construction read won over a decoder.

**What would retire it.** Decoding the ADC bits in the strip unwind, at which point the fallback and this
file go away. Anyone doing it has a ready test: `geometry-parity.test.ts` asserts `bloodrb`'s per-geometry
counts against the Struct's own `numTriangles`, so a correct decoder keeps that test green while removing the
special case.

**Blast radius.** The two models above, and the general rule's credibility: this is the one place where
"the drawn index data is the truth" ([`restrictions/assets-and-data.md`](../restrictions/assets-and-data.md))
is knowingly not applied. If a TC ever ships PS2-converted models in volume, this exclusion stops being
two files and becomes a decoder task.
