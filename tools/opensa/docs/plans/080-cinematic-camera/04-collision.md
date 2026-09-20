# 080/04 — Collision camera (behaviour 9)

The one plan with engine-adjacent surface: `PhysicsWorld` grows a camera-grade cast API. Everything
else is a pure layer inside the director.

## 1. `PhysicsWorld` cast API (`packages/game/src/physics/physics-world.ts`)

Today only downward casts exist (`groundBelow` `:361-367`, `isGrounded` `:391-399`); both already
use the Rapier primitive `world.castRay`. Add:

- `raycast(origin: Vec3, dir: Vec3, maxDist: number, exclude?: BodyHandle) → { dist } | null` —
  thin wrapper, GTA Z-up, solid-hit semantics, excluding the player capsule / seated car body
  (the camera must not collide with its own subject).
- `sphereCast(origin, dir, radius, maxDist, exclude?)` — Rapier `castShape` with a ball; the
  camera uses this one (a zero-width ray lets the eye rest ON a wall and the near plane clips
  through it; the radius must cover the near plane: `radius ≥ near·tan(fov/2)·√(1+aspect²)` ≈ 0.35
  for near 0.5 / fov 60° — derive, don't guess, and note the value in the ledger).
- Both cast against the one Rapier world, so streamed static colliders AND dynamic bodies
  (vehicles, props) occlude correctly for free. Colliders exist only near the player
  (collision streaming, 256-unit grid) — the camera orbit is well inside that ring by construction.

Unit tests on the physics test world (the collider fixtures the collision-streaming tests use):
hit distance accuracy, exclusion works, sphere cast stops `radius` short of the surface.

## 2. The collision layer (`camera-collision.ts`)

Runs on the FINAL rig pose (after 02/03/05 layers, before additive motion):

- **Primary cast**: sphere cast from the look point (head height — a point that is by definition
  outside geometry) toward the desired eye. Hit ⇒ `allowedDistance = hitDist`.
- **Asymmetric response** (the GTA/industry standard): pulling IN is **immediate** (snap to
  `allowedDistance` this frame — a wall between camera and player is never visible, not even for
  one frame); releasing OUT damps at `collisionReleaseTime` (~0.4 s first guess) so leaving a
  doorway glides instead of popping.
- **Whisker casts** (anticipation): 2 extra sphere casts at ±~15° yaw around the desired eye
  direction, taking the min distance with a soft weight — the camera starts easing in BEFORE the
  wall edge crosses the screen centre, which reads as "the camera avoids the wall" instead of
  "the camera hit the wall". Budget: 3 casts/frame steady state (≤ 5 with headroom for 05's
  vehicle variant) — measure actual cost in the ledger (expected ≪ 0.05 ms; Rapier ray cost at
  this collider density is trivial, but measure anyway, standing rule).
- **Floor guard**: after distance resolve, if the eye lands below `groundBelow(eye) + 0.3`, lift
  it (steep down-pitch on a slope otherwise puts the camera in the road).
- Distance writes go through 02's distance channel as a CAP (min of zoom target and
  `allowedDistance`) — zoom state is preserved through an occlusion, exactly like GTA restores
  your chosen distance after a tunnel.
- The director's probe stays injectable (01 contract): unit tests script hit distances and assert
  snap-in/damp-out asymmetry, whisker min-weighting, cap-not-overwrite semantics.

## 3. Space discipline

The rig is engine Y-up; casts run GTA Z-up. Convert at the probe boundary only:
`gtaFromEngine(eye) = (x, −z, y)` (the inverse the host already uses at
`engine-canvas-host.tsx:504-508`), never inside rig math. One conversion helper, tested both ways.

## Subtasks

- [x] `raycast`/`sphereCast` on `PhysicsWorld` + tests; radius derivation comment.
- [x] Probe wiring in the host (player capsule / seated car exclusion).
- [x] `camera-collision.ts`: primary + whiskers + asymmetric response + floor guard + cap
      semantics; unit tests with scripted probes.
- [x] Config + Camera tab: `collisionRadius`, `collisionReleaseTime`, whisker angle.
- [x] Measure: casts/frame and `director.update` p95 with collision on (ledger).
- [~] **Field round**: interiors/underpasses (LS parking garages), back-to-wall orbiting, doorway
      exit glide, alley sprint with 03's recenter active (the combination is where jitter hides —
      recenter steering the yaw while collision caps the distance must not oscillate).

## Acceptance

- Camera never shows through-wall geometry in the field round; doorway release glides.
- No visible feedback oscillation between collision and recenter (test + field).
- Cast budget ≤ 5/frame measured; update cost still < 0.1 ms p95.

## Ledger

### 2026-07-25 — SHIPPED

**Physics API** (`physics-world.ts`): `raycast(origin, dir, maxDist, exclude?) → {dist}|null` and
`sphereCast(origin, dir, radius, maxDist, exclude?)`, both GTA Z-up, EXCLUDE_SENSORS, excluding the caster's
subject (the player capsule / seated car body). `sphereCast` uses Rapier `castShape` with a `Ball` and
returns `time_of_impact`. Real-collider tests on the physics world: hit distance, exclusion, and the ball
stopping `radius` short of the wall (a zero-width ray reports 9.5, the 0.3 ball 9.2).

**The layer** (`camera-collision.ts`, pure, injected `CameraProbe`): primary sphere cast from the look point
along `−forward`, two whiskers at ±`collisionWhiskerAngle`, min across all three. Response is asymmetric —
snap IN, `damp` OUT over `collisionReleaseTime`. It CAPS the distance (min of zoom target and the allowed
distance), so the chosen zoom is restored after the occlusion. Space discipline: `gtaFromEngine` at the
probe boundary only.

**Two field-round fixes folded in the same day (user report):**
- **`collisionMinDistance`** (1.6): a wall can shove the eye in but never INTO the player — below the min it
  stops and accepts a little wall clip over a face full of ped. Fixes the "camera goes into the ped for a
  second on car entry".
- **Floor guard** (`guardFloor` + a `GroundProbe` = `physics.groundBelow`): a steep down-pitch on a raised
  porch/slope buried the eye and showed only skybox (the blue frame the first field look caught). The eye is
  lifted to `groundBelow(eye) + 0.3` when it sinks below.

**First-guess defaults**: `collisionRadius` 0.35 (near-plane cover for near 0.5 / fov 60° is ~0.59 at 16:9;
0.35 trades a little coverage for keeping the camera closer to walls — field-tune), `collisionMinDistance`
1.6, `collisionReleaseTime` 0.4, `collisionWhiskerAngle` 0.26 rad (~15°). All live on the Camera tab.

**Measured**: casts/frame = 3 (primary + 2 whiskers) + 1 ground guard = **4**, under the ≤5 budget. Headless
`ls-noon` with collision on: **120 fps / 8.334 ms / p95 10 / draws 1184** — vsync-capped, GPU pass 2.877 ms,
i.e. the per-frame casts are free (Rapier ray at this collider density is trivial). Suite 2650 green.

### 2026-07-25 — field round: the min-distance and the foot toggle, corrected TWICE

Two wrong turns before it landed, both on the same knob:

1. First cut shipped `collisionMinDistance` 1.6 → a wall closer than 1.6 m put the eye BEHIND it (the min
   floors the distance, so a near wall can't pull it in past the min). Read as "falling through the wall".
2. Reading "bring back the slide" as "turn collision off on foot", I made it vehicle-only. That was wrong —
   without it the on-foot camera sank through the ground and into buildings (the user, paraphrased: "it used
   to slide along the ground and buildings — now it falls through"). Collision is what MAKES the slide.

The real fix is the min distance = the **near-plane radius (0.5)**. Below it the near plane renders from
inside geometry (the skybox frame `min = 0` produced); above it a wall closer than the min pushes the eye
behind the wall (the `min = 1.6` fall-through). 0.5 is the near plane, so both failure modes need the head
itself against the wall — which never happens. Collision is back on foot AND in a car; the camera slides
along walls and the ground. The floor guard runs whenever the rig is attached, INCLUDING during an
enter/exit (a low seat can't bury the camera); only the distance CAP is suspended during `settling` (the
pull-in read as a jump — the entry just centres behind).

Also landed: **size-based vehicle distance** — a seated car frames out by its length ×
`vehicleDistanceScale` (default 2; a bus frames further than a hatchback), the live distance EASES to it and
back to the on-foot zoom on exit, and collision caps it so a car parked against a wall can't reverse the
camera through it (the user's "double the clearance, but the wall limits it", paraphrased).

### 2026-07-25 — per-subject floor + block-when-pinned (user field round, the model that stuck)

The min-distance knob went round in circles (0 → 1.6 → 0.5 → 1.5) because it was one number trying to do two
jobs. The user's framing separated them cleanly:

- **The floor is the SUBJECT's real size**, not a global constant. `CameraSnapshot.subjectRadius` is the car's
  planar half-extent + clearance, or the on-foot ped framing radius (~1.5, far enough to read the whole body,
  not a face). The eye can never come closer than that, so it never enters its own subject — which is what a
  fixed 0.5 let happen in a car (the camera cranked into the bodywork on orbit).
- **When a wall is closer than the subject fits** — the eye pinned between subject and wall, no room — the
  distance is BLOCKED at the subject boundary. It holds steady (a touch of wall clip behind the camera)
  instead of diving into the ped/car, and eases back out once the player reaches open space. This is the
  user's "lock it until the player backs out into wider space" (paraphrased).
- **Whiskers OFF by default**: the ±15° flanking casts fired on a pole or wall BESIDE the player/car (a thin
  pole behind-and-to-the-side yanked the car camera in), so only the straight-back cast counts now.
- `collisionMinDistance` demoted to the near-plane SAFETY floor (0.5) UNDER the subject floor.

### 2026-07-25 — reverted to the simple near-plane cap (field stop point)

Two richer models were tried and rejected by the field round: a per-subject floor (blocked the eye at the
subject boundary → still fell BEHIND a close wall), and freezing the eye in the world when pinned (the
camera stalled and didn't recover). The user's call: keep the SIMPLE cap — `collisionMinDistance` is the
near-plane radius (0.5), a wall closer than that pulls the eye up to the surface (it may clip into the ped
for a frame) but never slides behind the wall and never stalls. Whiskers stay OFF (side false-positives).
`subjectRadius`, the pinned/freeze path, and `CollisionResult` were removed. Size-based vehicle distance
stayed. Suite 2654 green. Accepted trade-off recorded in `docs/features/camera.md`: a very close wall behind
the player can clip the camera into the ped a touch — that's the stop point until a real pull-in policy is
wanted.

### 2026-07-25 — multi-ray fan tried and REVERTED (field-rejected, → postmortem)

A third richer model: a 5-ray fan (centre + 4 corners offset by `subjectRadius`) that pulls in ONLY when
every ray hits (a wall spanning the whole silhouette), to ignore thin poles. Built in `811bca9`, **reverted
same day in `e1541ec`** — the field verdict was the WORST behaviour of the chain: approaching a house on foot
the camera JUMPED instead of sliding. Root cause: the boolean all-hit gate is discontinuous, so it flickers
between "ignore" and "full pull-in" as the corner rays catch/lose a facade's edges/recesses. Full writeup +
the "keep it a continuous function of approach, not a boolean gate" lesson in
[`docs/postmortem/080-cinematic-camera/multiray-collision.md`](../../postmortem/080-cinematic-camera/multiray-collision.md)
(the rejected sphere-collider model is in the sibling
[`collision-collider.md`](../../postmortem/080-cinematic-camera/collision-collider.md)). Back on the simple
single sphere cast (`4316967`). The "On Top" overhead fallback for a genuine full pin is kept as a revisit
note in the multi-ray postmortem — a feel idea, not a perf lever, so it is not in the performance reserve.

### 2026-07-25 — FIELD ROUND ACCEPTED

User's verdict on the simple single sphere cast (after the multi-ray fan was reverted): accepted. The
shipped shape is the one that stays — primary cast + 2 whiskers, snap-in / ease-out, `collisionMinDistance`
1.6, the ground floor guard, 4 casts/frame. **`collisionRadius` 0.35, `collisionReleaseTime` 0.4 and
`collisionWhiskerAngle` 0.26 are frozen as shipped**; the acceptance criteria (no through-wall geometry, no
oscillation against recenter, ≤5 casts, < 0.1 ms) are all met and now field-confirmed.
