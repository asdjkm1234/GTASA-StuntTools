# Compress UV-animation keyframes in the `.osm` DESC

**Status:** in reserve — opened 2026-08-07 alongside the change it describes
([plan 099/01](../../plans/099-script-object-uv-anim/01-bake-the-animation-through.md)).

**Impact: VERY LOW — measured, and the entry says so itself: noise.** 19 312 B on the ONE model in the corpus
that animates at all, which is 94 % of that model's description and **0.49 % of its file**; every other `.osm`
carries no key. The spawn-side win is a `JSON.parse` over that array, against 4 MB of geometry for the same
model. It only stops being noise if animated models become common — a mod pack of animated billboards — and
then the number to beat is the DESC parse at spawn, not the disk bytes.

**Effort: medium.** Small surface, but it is a second encoding that has to be written in the builder, read in
the runtime stepper, and kept honest against the verbatim form forever. The part that makes it medium rather
than low is not the code: recognising a shape is a CLAIM ABOUT THE DATA, and our data is a mod author's, so
it owes a corpus survey before it is written — plus a fallback for the animation neither shape describes.

## What we do today

The rigid builder copies a model's referenced UVAnimDict entries into the `.osm` `DESC` **verbatim**: every
keyframe, every one of its six `uv` params, as JSON. The runtime walks that list with the same stepper the
world lane uses.

Measured on the asset the lane exists for, the Pacific Park ferris wheel's light ring:

| part of the file                | bytes       |
| ------------------------------- | ----------- |
| `ferriswheel_lights.osm` (built) | 3 981 140 B |
| its `DESC`                       | 20 512 B    |
| of which `uvAnimations`          | 19 312 B    |

So the animation is **94 % of that model's description** and **0.49 % of the file**. Nothing else in the
current corpus animates at all: every other `.osm` carries no key.

## The lever

`f13d` is a STEP animation — 261 keyframes that are really 13 distinct u-offsets, held 0.225 s each, over a
29.25 s loop. Written as (frame count, cadence, first offset, step) it is a few dozen bytes instead of
19 KB. A general form would keep the verbatim list only for animations that are genuinely irregular, and
recognise the two shapes SA actually ships (a stepped flipbook, a linear scroll).

## What it would win

~19 KB per animated model in the pak, and the same in decode work at spawn (`JSON.parse` over that array).
Against 4 MB of geometry for the one model that has it, that is noise **today**.

## What would have to be true to pull it

A corpus where animated models are common — a mod pack full of animated billboards or signs, or the class
growing past a handful of models. Then the number to beat is the DESC parse at spawn, not the disk bytes.

## Why we did not

The verbatim list is what the parser already produces and what the world lane already consumes; a compressed
form is a second encoding to keep honest, and the first thing it would break is an animation neither shape
describes. The cost is a fraction of a percent of one model in the whole game. **Recognising a shape is also
a claim about the data** — and the rule here is that our data is a mod author's, not the stock game's, so
that claim would need a corpus survey before it is worth making.
