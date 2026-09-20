# Vendored Sanny Builder opcode library

`sa.json` is the Sanny Builder command library for GTA San Andreas — the opcode DB the decoder is
generated from (plan 097/01 decision 3).

- Source: <https://github.com/sannybuilder/library>, file `sa/sa.json`
- Pinned commit: `867d1b9fa6947c991259ae3369b689eb6faf793a` (2026-07-19)
- Library version: `1.62` (`meta.version` inside the file)
- SHA-1: `383b75e95f0891e539c617cdd1f5e3a3ac416b7c`

Regenerate the typed table after bumping the pin:

```
npm run cleo:opcodes
```

which rewrites `../src/core/opcodes.generated.ts`. Never edit the generated table by hand — change the
generator (`../scripts/generate-opcodes.ts`) or bump this file and record the new commit/SHA here.
