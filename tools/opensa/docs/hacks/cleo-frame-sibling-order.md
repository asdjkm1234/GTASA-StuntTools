# CLEO frame-sibling walk: frame-ORDER adjacency stands in for the dropped parent links

**What it stands in for.** Rhino's track script walks the model's RwFrame hierarchy through
`RwFrame+0x9C` (`next` — the sibling pointer): the track links are authored as a sibling chain under
one parent. The honest answer needs each part's PARENT index, but the vehicle-optimizer's rig
(`VehicleModelPart`) carries only `name/localRotation/localTranslation` — the DFF's frame tree is
flattened and the parent links are dropped at conversion.

**What we do instead.** `NativeWorld.nextSiblingPart` (engine side, `engine-cleo-setup.ts`) answers
with the NEXT PART INDEX in rig order (`part + 1`, bounded by the part count). The optimizer emits
parts in DFF frame order, and sibling frames are consecutive in that order for the corpus model, so
the walk visits the same chain — but it does NOT stop at the real chain's end (it runs to the end of
the whole part list) and it would interleave wrongly on a model whose sibling chains are not
contiguous in frame order.

**Judged on.** The rhino headless run (the walk terminates via the script's own null checks at the
part-count bound). **It has never been judged in the field and the checkpoint this file used to name
could not have judged it** (corrected 2026-08-07, plan `cleo/scripts` 001 step 2): rhino's chain
anchor is `m_aCarNodes[CAR_MISC_E]` = `misc_e`, a dummy frame the vehicle builder does not emit as a
part, so the script's own null guard fires and the sibling walk is never entered — measured at
**0** part effects per frame against the model's real rig. The stand-in is therefore UNEXERCISED by
its only known consumer, not proven by it.

**What would retire it.** The vehicle-optimizer carrying a `parent` index per part (a `DESC` fixture
extension — additive, old fixtures default to a flat hierarchy), then `nextSiblingPart` answering
from the real tree: next part sharing the same parent, else null.

**What else moves if it changes.** Only `nextSiblingPart` — the atlas (`native-atlas.ts`) and the
tokens are agnostic; the fixture format change would also let `GET_OFFSET_FROM_OBJECT` compose
rotated parent frames properly (the 04 ledger's translation-only note).
