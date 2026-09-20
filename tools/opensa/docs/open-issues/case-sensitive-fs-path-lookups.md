# A path from `gta.dat` is joined VERBATIM, and the dev machine's filesystem is case-sensitive

**Found 2026-08-12**, while merging 161 upstream commits. Not a merge conflict and not caused by the merge:
the code is upstream's, byte-identical on both sides. It is a defect that only appears on a **case-sensitive
filesystem**, which is what this fork develops on and what the target device runs.

## The symptom

`npm run test` on Linux (and on Android/Termux) reports failures nobody sees on macOS:

```
FAIL tools/perfect-map-builder/src/pipeline.test.ts > reportTextIplCensus > …
  expected '· sa map cost: 0 permanent text-IPL rows, 0 inst-bearing IPLs, read 0/3 listed'
        to match /sa map cost: 2 permanent text-IPL rows, 2 inst-bearing IPLs, read 3\/3 listed/

FAIL tools/mod-installer/src/ipl-slot-merge.test.ts > mergeModInstIpls > …
  expected { merged: 0, rows: 0 } to deeply equal { merged: 2, rows: 4 }
```

Both are the same shape: the function was handed a game dir, listed the IPLs `gta.dat` names, and **read
none of them**.

## The cause

`gta.dat` names its files the way DOS did — `IPL DATA\MAPS\a0.IPL` — and the files on disk are
`data/maps/a0.IPL`. The lookup swaps the separators and joins the rest verbatim:

```ts
const file = join(gameDir, match[1].replace(/\\/g, '/'));   // pipeline.ts, reportTextIplCensus
if (!existsSync(file)) { missing.push(match[1]); continue; }
```

`DATA/MAPS/a0.IPL` and `data/maps/a0.IPL` are the same path on macOS and APFS, and two different paths on
ext4, f2fs and every Android filesystem. So the census counts every listed IPL as MISSING, reports `0` rows,
and warns that its number is a lower bound — while the files are sitting right there.

## Why it matters beyond the tests

**A real San Andreas install has exactly this mismatch.** Stock `gta.dat` lists `DATA\MAPS\…` in upper case
and the shipped tree is lower case, so this is not a synthetic condition the tests invented — it is how the
game ships. On a case-insensitive host the code has never been asked the question.

The consequences differ per caller, and only the first is cosmetic:

| Caller | What a missed lookup does |
| --- | --- |
| `reportTextIplCensus` | prints `0 permanent text-IPL rows` and a MISSING warning — a **budget number that reads as headroom** when the real cost is unknown |
| `mergeModInstIpls` / `compactStockInstIpls` | merges **nothing**; a mod's inst rows silently stay in their own IPL instead of being folded into the stock host, which is what the 40-slot ceiling work exists to prevent |

Neither throws. Both look like a build that had nothing to do.

## What has NOT been done

No fix is shipped, and the shape of one is a decision rather than an obvious patch: a case-insensitive
resolve has to be **one** helper (a directory listing compared case-folded, memoised per directory), used by
every reader of a `gta.dat`-style path, or it becomes the fourth copy of a rule
([restrictions/architecture.md](../restrictions/architecture.md) already carries two entries about exactly
that failure). It also has to stay correct on a case-insensitive host, where two files differing only in case
cannot both exist.

**Caught:** by tests, but only on a case-sensitive machine — which is why it went unnoticed. There is no
guard, and the production path warns rather than fails.

## Where to start

- `tools/perfect-map-builder/src/pipeline.ts` → `reportTextIplCensus`
- `tools/mod-installer/src/ipl-slot-merge.ts` → both exported functions
- and a sweep for `replace(/\\\\/g, '/')` — every site that turns a DOS path into a real one is a candidate.
