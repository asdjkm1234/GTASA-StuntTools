# Concept — a WebGL2 fallback backend

**Status: live, go/no-go pending.** Opened 2026-08-04 as the gate on
[plan 200 / chain 5](../plans/200-platform-reach/5-webgl2-fallback/readme.md). The
decision to *consider* it is the user's (2026-08-04); the decision to *build* it belongs to this document's
evidence.

## The question

The engine is WebGPU-only by design and says so in code: *"the engine never soft-degrades"*. The three.js
WebGL path that used to catch unsupported browsers was deleted with `three` in plan 074/13. So a fallback
today means **writing and maintaining a second rendering backend for our own engine**, permanently.

Worth it or not is a reach-vs-tax question, and both sides are measurable.

## The case against, stated first

- **The window is closing on its own.** Chrome on Android has had WebGPU since 121; Safari since iOS 26. The
  population this buys is Firefox and older iOS, and it shrinks every quarter while the tax does not.
- **The tax is per future change, not one-off.** 0.5.0 alone queues weather, rain and the city-life chain —
  every one of them a rendering plan that would have to land twice.
- **The engine already sits at WebGPU's limits.** The rigid path uses 15 of 16 inter-stage locations;
  alpha-to-coverage needs `sampleCount` 4; the WGSL uniformity rule (a branch on a per-fragment value bans
  implicit-derivative sampling for the rest of the function) closed plan 082 *after a green test suite*.
  A WebGL2 target adds a second set of invisible rules to a path that already has rules no test can see.
- **A wrong fallback is worse than none.** If the compat path renders a subtly different world, the project
  acquires a class of bug reports nobody can reproduce on the primary path.

## The case for

- Reach is the project's own stated ambition, and "runs in a browser" is a weaker claim when it means
  "runs in some browsers".
- Chain 2 does most of the texture work anyway: a universal payload transcoded per device already selects
  S3TC/ETC/ASTC, so the compat path inherits its content for free.
- A declared, honest subset ("compat mode draws less") is a legitimate product, and the shell can say so.

## The go/no-go

| Question | How it is answered | Bar |
| --- | --- | --- |
| Reach won | Measured share of **target** devices with a WebGL2 context and no WebGPU adapter — with blocklisted-but-capable adapters counted separately | A number worth a second backend. The 08-04 phone is the warning: it looked incapable and was merely blocklisted |
| Shader strategy | A build-time WGSL→GLSL cross-compile over a fixed subset, demonstrated on the **hardest** existing shader, not a toy | The subset must be writable as a restriction other plans can follow |
| Subset cost | What the compat path does not draw, named before implementation | A world a player would call the same game |
| Ongoing tax | Extra work per future rendering plan, estimated against 0.5.0's actual queue | Acceptable against the reach number |
| Primary-path cost | The WebGPU path after the seam is introduced | Zero. Not "small" |

## Open questions

- Does the seam live in the engine, or is the compat path a separate renderer sharing formats and streaming?
  The second is more honest about how different the two are, and much less likely to poison the primary path.
- Is there a cheaper answer to the same reach — e.g. shipping the compat message and a device list — that the
  reach measurement would make obviously right?
- If the phone story (chains 2–4) lands well, does the remaining population still justify this at all? **This
  concept should be re-read after chain 4, not before.**

## Exits

- **Survives** → the research record moves into the chain-5 plan folder.
- **Dies** → `docs/postmortem/`, recording the reach number that killed it, so the question is not re-opened
  from intuition.
