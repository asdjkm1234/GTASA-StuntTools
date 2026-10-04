---
name: renumber-mods
description: Close numbering gaps in a game's mods-src/<game>/mods after a mod is deleted — rename "N. Name" folders to a contiguous 0..K sequence preserving install order. Use when the user deleted a mod folder and wants the numbering compacted. Takes the game as an argument (e.g. "gostown"); "all" does every game.
---

# Renumber mod folders

Mod folders under `mods-src/<game>/mods/` are named `<number>. <name>` and the number IS the install order
(the mod-installer applies them ascending). Each game has its OWN independent numbering. Deleting a mod
leaves a gap; this skill compacts one game's sequence to `0..K` while preserving the relative order.
Renumbering never changes the install result — only the labels.

## Which game

The skill operates on ONE game's `mods` folder (numbering is per-game, so never renumber across games).

- If the user named a game (e.g. "gostown", "original", "carcer"), use `mods-src/<game>/mods`.
- If the user said "all", loop the block below over every `mods-src/*/mods` — each game independently.
- If no game was given, list the candidates and ask which one:

  ```bash
  ls -d mods-src/*/mods
  ```

## Flat or layered

A game's `mods/` folder is either **flat** (mod folders directly inside — every game today) or **layered**
(`common/`, `sa/`, `opensa/`, each holding mod folders; `docs/contracts/mods.md` §1). **Numbering is per
LAYER**, exactly as it is per game — the layer order decides which layer wins, never the numbers — so a
layered folder is renumbered one layer at a time and the layer folders themselves are NEVER renamed.

Find the sequences to compact:

```bash
GAME=gostown
ls -d "mods-src/$GAME/mods"/{common,sa,opensa} 2>/dev/null   # layered if any of these exist
```

Every listed layer is one sequence; if none exists, the single sequence is `mods-src/$GAME/mods` itself.

## Steps (per sequence)

Set `DIR` to the sequence — `mods-src/$GAME/mods`, or `mods-src/$GAME/mods/<layer>` for each layer.

**The order comes from the INSTALLER, never from `sort -n`.** The two disagree, and the disagreement is
silent: `sort -n` puts an UNNUMBERED folder first, while the installer's own collation puts it LAST — so
numbering by `sort -n` would move that mod from last writer to first and change which mod wins every
conflict it has. `sortMods` is the one authority; ask it.

1. List the current state — the installer's order, with the number each folder would get:

   ```bash
   DIR="mods-src/$GAME/mods"
   npx tsx -e "
   import { sortMods } from './tools/mod-installer/src/install';
   import { readdirSync } from 'node:fs';
   const dir = process.argv[1];
   const names = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
   sortMods(names).forEach((name, i) => console.log(\`\${i}\t\${name}\`));
   " "$DIR"
   ```

   Show it to the user before renaming anything when the sequence has unnumbered folders or gaps.

2. Rename through a TEMP name, so the direction never matters. Compaction usually renames downwards, but
   inserting a mod (`8.1 SPC Cars` → `9.`, everything after it +1) renames upwards into names that still
   exist; a two-phase rename is correct either way:

   Run it from the REPO ROOT (the import is resolved against the cwd) and pass the sequence as an argument:

   ```bash
   npx tsx -e "
   import { sortMods } from './tools/mod-installer/src/install';
   import { readdirSync, renameSync } from 'node:fs';
   import { join } from 'node:path';
   const dir = process.argv[1];
   const names = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
   // The number, fractional ones included ('8.1 SPC Cars'), is stripped; a folder with no number keeps
   // its whole name and simply gets one.
   const plan = sortMods(names)
     .map((from, i) => ({ from, to: \`\${i}. \${from.replace(/^[0-9]+(\.[0-9]+)*\.? */, '')}\` }))
     .filter((p) => p.from !== p.to);
   plan.forEach((p, k) => renameSync(join(dir, p.from), join(dir, \`.renum-\${k}\`)));
   plan.forEach((p, k) => { renameSync(join(dir, \`.renum-\${k}\`), join(dir, p.to)); console.log(\`renamed: \${p.from} -> \${p.to}\`); });
   " "$DIR"
   ```

3. Verify: re-run step 1. It must print a contiguous `0..K`, the same folder count as before, and **the
   same ORDER** — the names in the same sequence they were in. A changed order means the renumber changed
   the install result, which it may never do.

## Notes

- `mods-src/` is NOT under git — plain `mv`, nothing to commit for the rename itself.
- A deleted/renumbered mod set changes that game's build baseline: the next pmb run re-baselines, and any
  perf/size comparison against older runs must say which game AND mod set the pak was built from
  (`docs/benchmarks/` rule).
- Historical docs/memory may reference old numbers (e.g. "39. Green Piece") — those are records of
  past states, do NOT edit them.
- If the user deleted the mod's folder only partially (kept some files), confirm the leftover is
  intentional before renumbering around it.
- `common`, `sa` and `opensa` are LAYER names at the top of a game's `mods/`, never mods — renaming one to
  `0. common` would turn the layer into a mod folder and the install would refuse the tree.
