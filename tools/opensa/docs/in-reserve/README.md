# In reserve — deferred work whose investigation is already done

**Work we know how to do, have fully researched, and deliberately have not done — because a condition that
would make it necessary has not arrived yet.** The investigation is finished and paid for; what is missing is
the need.

The folder exists so that when the need does arrive, nobody starts over. The failure it prevents is specific
and it has a shape: a symptom appears months later, the person looking at it has no idea it was ever studied,
and the same days get spent twice.

## Every entry carries a TRIGGER, and the trigger is enforced elsewhere

A card here is not a note — it names the exact condition that turns it into work:

1. **which task it came out of**, so a reader knows which world it was true in;
2. **why it is deferred** — the measurement, decision or field verdict, dated;
3. **the TRIGGER**: a concrete condition, not a mood;
4. **where the trigger is checked in code**, because a folder nobody opens is not visibility.

That last point is the one that makes this work. A card whose trigger lives only here is a card that will be
read after the confusion, not before it — so the guard, gate or error message that fires when the condition
arrives says the card's name.

## Distinct from its neighbours

| Folder | What it holds | Why it is there |
| --- | --- | --- |
| [opensa-pack-encode-checkpoints.md](opensa-pack-encode-checkpoints.md) | The ASTC encode is 97% of a map-only convert on the phone and is not checkpointed, so a kill loses all of it. Deferred because `TEXTURES=rgba8` removes the stage. **Trigger:** an ASTC pak has to be built ON the phone — checked in `scripts/phone.sh`'s convert-failed branch, which names this card |
| **`in-reserve/`** | researched work, not needed YET | a named condition would make it needed |
| [`roadmap/`](../roadmap/) | decided work, later version | we DO intend it, it is scheduled |
| [`postmortem/`](../postmortem/) | a died concept or plan | it was TRIED and it FAILED |
| [`performance/deferred-optimizations/`](../performance/README.md) | a lever we chose not to pull | it works; we did not want its price |
| [`ideas/`](../ideas/) | a direction nobody has researched | the work has not been done |

The line that decides: roadmap is *"when"*, ideas is *"someone should look at this"*, and this folder is
*"already looked at, here is what it costs and what makes it urgent"*.

**A FACT does not belong here, however unused it is.** What Rockstar's game and its adjuster ecosystem ARE
lives in [`gta-sa-original/`](../gta-sa-original/README.md) by rule. A card here POINTS at the facts it rests
on rather than moving them.

## The cards

| Card | Trigger |
| --- | --- |
| [ospak-in-place-cell-patch.md](ospak-in-place-cell-patch.md) | a one-model verdict the lab pak cannot carry (shipping texture arrays / prelight / generated-LOD exclusions, or a swap that must reach `fetch-pack`) — `model-repack.ts`'s header names this card; the lab never writes the shipping pak |
| [opensa-pack-model-class-checkpoints.md](opensa-pack-model-class-checkpoints.md) | a pack dying INSIDE the model classes (after the weld) repeatedly, or the classes outgrowing the weld — the pack's own `resume:` log line names this card as what re-runs |
| [img-archive-limit-lift.md](img-archive-limit-lift.md) | a ninth registered `models/*.img` — the build's own `assertArchiveSlots` names this card when it fires |
