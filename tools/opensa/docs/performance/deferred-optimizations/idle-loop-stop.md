# The idle console still wakes ten times a second

**Status:** priced, not taken. Decided 2026-08-22 while building
[201/4-01](../../plans/201-dispatch-console/4-a-console-is-not-a-game/readme.md).

## What we do today

At rest the console stops drawing but does not stop *looking*: the loop reschedules itself with a 100 ms
timer (`IDLE_WAKE_MS`) instead of `requestAnimationFrame`, gathers the picture's signals, compares them with
the frame that last drew, and goes back to sleep. Ten wakes a second, each one a handful of comparisons and
no GPU work at all.

An operator's input does not wait for that timer: the pointer, wheel and key handlers re-arm the animation
frame directly, so the first frame after a thumb lands is the next display frame.

## The lever

Stop the loop entirely. Wake only on an event — an input, the board's own tick, a streaming callback, a
clock crossing — and let the process be genuinely still in between. That removes ten timer wakes a second,
which on a phone is the difference between a core that idles at its lowest state and one that is nudged
awake 36 000 times an hour.

## Why it is not taken

**Because "nothing changed" would stop being a state and become an event, which is the failure the
restrictions already name in another form** ([a framing decision taken on a threshold gets retaken next
frame](../../restrictions/architecture.md)). A signal that arrives while the loop is asleep is still there
when a polling loop looks — it is a value. An event-driven loop only learns about a change if somebody
remembered to raise the event from every place that can cause one: the board tick, the flight, the
streaming create, the hour, the sketch, the resize, the selection, the projection swap, the bindings, the
follow that re-targets the camera. Miss one and the console stops redrawing while something is still moving,
and the symptom is a map that looks frozen — the exact bug the chain exists to avoid, arriving as a silent
regression the day somebody adds a twelfth source of change.

The polling wake is the cheap insurance: it costs ten comparisons a second and it cannot be forgotten.

## What would make it worth taking

- A device measurement showing the idle timer itself in a battery or thermal delta over a shift-length idle
  ([4/01](../../plans/201-dispatch-console/4-a-console-is-not-a-game/readme.md) owes exactly that number,
  and nobody has taken it yet); and
- a single place every change already flows through — the live-feed subscription of
  [roadmap 0.6.0](../../roadmap/0.6.0/plans/05-dispatch-cad-depth/readme.md) would be one, since a board
  that arrives over a socket has an obvious wake point that a polled mock does not.
