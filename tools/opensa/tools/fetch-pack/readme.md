# fetch-pack

The plan-086 finishing tool: pack a pmb build's SELF-CONTAINED `opensa/` game dir (engine pak inside at
`pak/` — phase 8) into the second, independent FETCH build: content-hashed zip chunks + a download
`manifest.json` under `<build>/opensa-pack/<game>-<version>/`. Two builds of the SAME bytes — local play
opens `build/<id>/opensa` directly (folder / http-dir), hosted fetch downloads the chunks (deploy = upload
the `<game>-<version>/` folder as `games/<game>-<version>/`). Every `build:game:<id>:opensa` alias chains this tool
after pmb (the `:sa` target builds no fetch chunks — the real game is not downloaded).

```bash
npx tsx tools/fetch-pack/src/cli.ts   # defaults: --build ./build/original --out <build>/opensa-pack (chained in build:game:<id>:opensa)
npx tsx tools/fetch-pack/src/cli.ts --build ./build/gostown --out ./static/games   # stage a local fetch test
```

Identity comes from the pak manifest (`game` + `appVersion`, plan 086 phase 1); a pre-086 pak falls
back to the build folder name + the root package.json version, loudly.

Architecture, group mapping and the slicing scheme: [docs/plans/001-architecture.md](docs/plans/001-architecture.md).
