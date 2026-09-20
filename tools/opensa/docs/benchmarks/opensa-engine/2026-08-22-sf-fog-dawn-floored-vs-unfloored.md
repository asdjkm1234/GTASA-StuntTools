# 2026-08-22 — `sf-fog-dawn`, floored vs unfloored fog start

The arm the [plan-104 engine A/B](../index.md) row asked for. That sweep read `sf-fog-dawn` at pass +2.8 %
and p95 +8.8 % and offered a mechanism without claiming it: unflooring the timecyc fog start
([104/04](../../plans/104-timecyc24h-source/readme.md)) raises the fog factor everywhere, and `fogColorFor`
runs its cloud math only on meaningfully fogged pixels (`smoothstep(0.7, 1.0, fogFactor)`,
`packages/engine/src/render/shaders.ts`) — so more fogged pixels means more pixels through that branch.
This isolates it.

## Conditions

- **Headless lab lane**, `tools-debug/bench-harness/drive.js`, `?bench=sf-fog-dawn`, `DPR=2`,
  **`UNCAPPED=1`** — the capped lane saturates at 8.333 ms and cannot see a 1 % move (the first probe run
  read `avgMs` 8.333 / 120.0 fps in both arms).
- **Not comparable to the user's display lane in absolute terms**: this lane registers 252 road cars against
  his 1219 and reports `target 345` residency against his 422. Only the direction and the order of magnitude
  transfer.
- Same pak (`build/original/opensa`, 2026-08-22 09:57), same scene, same machine, one session.
- **Six runs, ALTERNATED** `U F U F U F` so machine drift cannot land on one arm. The only change between
  arms is the one line in `engine-environment-driver.ts`, reverted in the working tree and restored after
  each floored run (checked back to 0 occurrences at the end).
- The scene is authored at hour 7, and FOGGY_SF at 07:00 in this build's table is `FogSt −200 / FarClp 150`
  — **72.9 % fog at the camera unfloored against 0 % floored**. Checked BEFORE the runs: an hour with a
  positive fog start would have made the two arms identical and the whole exercise empty.
- **The treatment was verified to land**, not assumed: the exit screenshots differ, and the unfloored frame
  compresses to 2.69 MB against the floored 3.93 — which is what heavy fog does to a PNG. (An A/B whose
  arms secretly run the same code has burned this project before.)

## Result — three runs per arm, median (min..max)

| column | unfloored (as authored) | floored at 0 (the old code) | Δ median |
| --- | --- | --- | --- |
| **`gpuMs.pass`** | **3.969** (3.937..3.980) | **3.909** (3.887..3.916) | **+1.53 %** |
| `avgMs` | 5.415 (5.404..5.422) | 5.421 (5.404..5.421) | −0.11 % |
| `p95Ms` | 7.7 (7.5..8.3) | 8.8 (7.7..9.0) | −12.5 % |
| `gpuMs.post` | 0.795 (0.767..0.802) | 0.798 (0.779..0.802) | −0.38 % |
| `gpuMs.probe` | 1.874 (1.808..1.901) | 1.918 (1.906..1.957) | −2.29 % |
| `gpuMs.submit` | 2.575 (2.320..2.607) | 2.268 (2.136..2.402) | +13.54 % |
| `avgDrawCalls` | 1727 | 1710 | +0.99 % |
| `avgTriangles` | 2 903 786 | 2 893 144 | +0.37 % |

**The world pass is the only column that separates, and it separates cleanly**: the arms do not overlap at
all — unfloored's cheapest run (3.937) is still dearer than floored's dearest (3.916). Within-arm spread is
1.09 % and 0.75 %, so a 1.53 % gap on disjoint ranges is a real effect rather than a lucky pair.

**Everything else is noise, and the table shows it rather than hiding it.** `p95` moves −12.5 % the WRONG
way for the hypothesis, `submit` +13.5 % on ranges that overlap heavily, `probe` −2.3 % likewise. Uncapped
mode produces 149–156 ms hitches and 39–74 slow frames in BOTH arms — an artifact of taking the presentation
clock away, present on both sides, so it cancels.

## What this settles, and what it does not

- **The mechanism is real**: unflooring the fog start costs GPU pass time on a fog scene, and the branch
  above is the only route by which it could.
- **The magnitude is ~1.5 % of the world pass and nothing at the frame** — `avgMs` is flat to 0.1 % in a lane
  with the frame clock removed. There is no case here for reinstating the floor: the cost buys back the near
  haze that 112 of stock's own 504 rows author.
- **It does NOT explain his lane's +8.8 % p95.** That is a different lane (5× the cars, his resolution, one
  run) and in the same sweep `ganton-noon` read −2.6 % on pass, which plan 104 cannot cause either. The
  display-lane figure remains one run's spread until someone repeats it there.
