# Track links are hidden by teleporting them 1 km under the tank

**What it stands in for.** A "hide this part" primitive. The Rhino's tread is a twelve-frame
flipbook (`track_1`…`track_12`): exactly one link may be on screen at a time and eleven must be
invisible. Neither our native atlas nor real CLEO 4 has a per-part visibility native, and
`rhino-tracks.cs` must run on BOTH runtimes — so the only lever a dual-target script has for
"invisible" is the part's own translation.

**What we do instead.** `cleo/scripts/rhino-tracks/script.ts` writes `HIDDEN_Z = -1000` into each
hidden link's matrix `m_pos.z`, and `0` into the visible one's. -1000 m is under every piece of SA
terrain (the world floor sits around -100 m), so the link cannot be seen from any camera, and it is
small enough to be harmless to any bounds/culling arithmetic downstream.

The author's original used **-1e35** on all three components. That is the same trick two orders of
magnitude past sanity: a value that close to the float32 ceiling turns any accumulation into `inf`
and any difference of two of them into `NaN`, and it arrives in the engine as data from a script
file ([[next-session-roadmap]] lesson 23). We keep the trick and drop the recklessness — and we
write only `z`, so the `x`/`y` the author modelled into each link survive instead of being forced
to the frame origin the way `SetRotate(x,y,z)` forced them.

**Judged on.** The story test pins the invariant that matters (exactly one link at `z = 0`, the
other eleven at `-1000`, and nothing ever placed further than `HIDDEN_Z`), and the headless run is
clean. -1000 itself is a judgement call, not a measurement: it is "far below the world, near enough
to be numerically dull". Not yet field-judged — plan `cleo/scripts` 001 step 5 is the visual
verdict, on OpenSA and under real CLEO.

**What would retire it.** A part-visibility row in the native atlas (`NativeWorld.setPartVisible`,
which the engine can answer honestly by skipping the part's draw) plus an `opensa-only` build of
the script that uses it. That path cannot be dual-target — real CLEO has no such native — so the
dual artifact would keep this hack until SA-side support (an `.asi` export, or SA's own
`CVehicleModelInfo` component hiding) is worth the cost.

**What else moves if it changes.** Only the constant and the two tests naming it. Raising the
magnitude re-opens the numerical question the original walked into; lowering it risks the link
becoming visible from a camera looking down through terrain.
