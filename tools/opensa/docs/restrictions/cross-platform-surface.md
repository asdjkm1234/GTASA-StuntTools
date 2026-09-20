# A surface ships on a phone AND on a desk, in the same change

**The rule.** Every operator-facing capability this project adds must be usable on a phone and on a desk
**when it lands**, not in a later pass. Concretely, a change that adds a control or a capability answers all
five of these or it is not finished:

| Question | The answer that counts |
| --- | --- |
| Can a FINGER hit it? | ≥ **44 CSS px** of target where the pointer is coarse, in **BOTH axes** (`TOUCH_TARGET`, `apps/dispatch/src/ui/styles.ts`) |
| Does it fit at **360 CSS px**? | the narrowest real device in this repo's record; nothing clipped, nothing crowded off the map |
| Is it reachable WITHOUT a keyboard? | every command has an on-screen path, or the capability exists only on a desk |
| Is it reachable without HOVER? | a `title=` is a bonus, never the only label — a finger has no hover state |
| Is it ONE component with two sizes? | not two layouts to keep in step, and not a second code path |

**44 is not ours.** WCAG 2.2's enhanced target-size criterion (2.5.5) says 44×44 CSS px, Apple's HIG says
44 pt, Material says 48 dp. 44 is the number all three agree is enough, so it is the one the token carries.

**Never a bare `1fr` on a track that holds the map.** A `1fr` grid track keeps `min-width: auto`, so it
refuses to shrink below the widest row in its column — one over-wide row widens the whole grid, and the map
cell goes with it. Measured 2026-08-25 at 360 CSS px: the console's top bar came to 403 px, the single
column became 403, **and every control anchored to the map's right edge sat past the screen with nothing to
scroll to**. `minmax(0, 1fr)`, and any full-width flex row inside it takes `minWidth: 0` + `overflow:
hidden` so it gives way rather than pushing. This is the difference between a control that is small and one
that does not exist.

**Height is a third question, and width cannot answer it either.** A phone in landscape is wide and SHORT:
at 740x360 the same layout left the map 98 px, because a list under it took its share of a screen that had
none to give. `useShortViewport()` sits beside the other two.

**Width and pointer are two questions, and answering one with the other is the usual mistake.** How WIDE the
viewport is decides what fits — panels beside the map, or a tabbed sheet under it. How it is POINTED AT
decides how big a target must be. They vary independently: a phone in landscape is wide and coarse, a laptop
with a touchscreen is wide and both, a small window on a desk is narrow and fine. `useCompactLayout()` and
`useCoarsePointer()` (`apps/dispatch/src/ui/use-compact.ts`) answer them separately, and neither is a
user-agent string.

**This is the SURFACE half of the platform rule already in
[architecture.md](architecture.md).** That one governs the frame: *the PC/mobile difference is a BUDGET the
frame reads, never a branch it executes, and never a second renderer.* This one governs everything above the
frame, and it is the same principle: one component that takes a size, not two components that drift.

## Why it is a restriction rather than a note

**It is SILENT in every way a repository can be silent.** The code typechecks. It lints. Every test passes,
because a test asserts behaviour and this is geometry. And — the part that makes it expensive — **it looks
perfect on the machine of whoever wrote it**, which on a desk is a 24-pixel button that a mouse hits every
time. Nothing in this repository measures a touch target, and no benchmark row has ever contained one.

The failure reaches the operator as *"this app is fiddly on my phone"*, which is unactionable feedback
arriving weeks later, about a control nobody remembers writing.

**Violated again 2026-08-25**, and the second round is the one that says why this file is not a style note.
The three 08-22 defects were controls that were too small. These were controls **that were not on the
screen**: the layout was 403 CSS px wide inside a 360-px phone, so the right-hand column of the map's
turn/tilt/zoom cluster, the board's `Auto` switch and every call row's state were past the edge with no way
to scroll to them. The operator's report was *"impossible to control on the phone"* — which is what a
geometry failure sounds like weeks later, from the far end of the feedback loop this file was written to
shorten.

**Discovered 2026-08-22**, by being violated three times in one session while the console's operator
surface was built ([201/7-03](../plans/201-dispatch-console/7-the-operator-map/readme.md) and
[7/06](../plans/201-dispatch-console/7-the-operator-map/readme.md)):

- the map's turn, tilt and zoom controls were **24×24 px** — under half the minimum, and invisible as a
  defect on the desk they were written on;
- the search hits and saved views were ~19 px rows, same class;
- and the sharpest one: the three **zoom levels existed only on keys `1`/`2`/`3`**, so on a phone — the
  device this whole console is aimed at — that capability did not exist at all. A capability that lives only
  on a keyboard is a capability that ships to one platform.

All three are fixed in the change that wrote this file. What that fix looks like is the pattern to copy: one
component, a `touch` flag from `useCoarsePointer()`, and a second size token beside the first.

## A density lever is clamped by the POINTER, never by the preset

**Added 2026-08-28**, while reading Mark43 and Tickets CAD as skins
([201/7-10](../plans/201-dispatch-console/7-the-operator-map/readme.md)). Real CAD is a desk product with
three monitors, so a skin taken from one carries a desk's density: Mark43's grid is far tighter than
anything this console may show a finger. A theme is allowed **one** density lever
(`ConsoleTheme.density`, built 2026-08-30 — it replaced the free-form `rowPadding` string and moves the row
padding and the `caption`/`body` type steps together), and the rule for it is:

**the lever is resolved against `useCoarsePointer()`, in the resolver — not offered to a reviewer.** A
preset may ask for `dense`; where the pointer is coarse it resolves to the size that still clears 44 px in
both axes. `TOUCH_TARGET` is never scaled, and neither is the `input` step (15 px is the iOS-zoom floor).

**Why it is here rather than in the design file.** A skin is chosen once and then travels: the operator
picks it on a desk, and the same `localStorage` key paints their phone that evening. Nothing on that path
re-asks the question, so a lever that trusts the preset ships a desk row to a hand — and it is the same
silence as the rest of this file (it typechecks, it lints, the suite is green, and it looks perfect on the
machine that chose it). Clamping in the resolver makes the violation unrepresentable rather than
reviewable.

**BUILT 2026-08-30, and the guard this entry originally specified would never have failed.** It said *every
preset, resolved at a coarse pointer, still yields a row that clears the criterion* — but the phone's row
(`styles.rowTouch`) carries `minHeight: TOUCH_TARGET` and its own padding, so 44 px is true by construction
whatever a preset asks for, and that assertion passes on every possible input including the ones it exists
to catch. **What actually travels is the TYPE**: a desk-chosen `dense` lands 10-px text inside a row that
stays 44 px tall, and no other guard here can see it. `theme.test.ts` now asserts both — the height, and
that no preset resolves below the `compact` type steps at a coarse pointer.

One more thing the build changed: the clamp is emitted as a `@media (pointer: coarse)` block in the
stylesheet rather than resolved once at mount, because a skin change is one attribute write that React
never sees — a value resolved at mount would be the density of whatever skin was current when the console
opened.

## Caught, or silent?

**PARTLY CAUGHT since 2026-08-25, and silent everywhere the guard does not reach.**

What is caught, by `apps/dispatch/src/ui/styles.test.ts`: a **bare `1fr`** in either grid template, a
`…Touch` token under 44 in either axis, and a full-width bar that can push its column. That test exists
because this file used to end by saying a lint over these literals could be written *"when this bites a
second time"* — it bit a second time, and the sizes are literals in `styles.ts`, so the guard is the test.

What is still SILENT, and it is most of the rule: a control sized inline at the call site rather than from a
token, a cluster that fits but covers the map, a capability that exists only on a keyboard, and anything
about reach or feel. The honest checks remain:

- **a render at 360 CSS px**, which the agent container CAN do even though the phone cannot — a headless
  Chromium at `(pointer: coarse)`, probing every element for a box past the viewport and every control for
  a box under 44. This found all nine of 2026-08-25's defects in one pass and is the cheapest check in this
  list; run it before handing a surface to the phone, never instead of it;
- a **real phone**, which the development machine already is
  ([development/termux.md](../development/termux.md)) — the only judge of reach, feel and safe-area insets,
  and the reason [201/3](../plans/201-dispatch-console/3-the-operator-surface-on-a-phone/readme.md) exists;
- and a reviewer reading a diff for the five questions above, which is what this file is for.
