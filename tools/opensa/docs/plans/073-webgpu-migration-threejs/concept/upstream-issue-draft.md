# Upstream issue draft (three.js) — static BundleGroup never freezes custom-node materials

Ready-to-file draft distilled from the bundle hunt (phase-1-findings.md). File as ONE issue with three linked
defects, or split. All measured on r185 (0.185.1), Chrome WebGPU, a streamed open-world scene
(~5k draws visible, ~45 `BundleGroup`s of 50–600 objects, ~1 object per material — an InstancedMesh-heavy world).

---

**Title:** `WebGPURenderer: static BundleGroup provides no freeze for node materials (hasNode returns before the
bundle check), and frozen objects lose shared-group (camera) updates`

**Body:**

`BundleGroup.static = true` promises record-once/replay semantics, but three defects make it ineffective or
incorrect for real scenes:

### 1. `NodeMaterialObserver.needsRefresh` bypasses the static/bundle check for custom-node materials

```js
if ( this.hasNode || this.hasAnimation || this.firstInitialization( renderObject ) || this.needsVelocity( … ) )
    return true;   // ← before isStatic / isBundle are even computed
```

Any material with a custom node (e.g. a `colorNode`) refreshes EVERY bundled object EVERY frame — the bundle
records and replays, but the per-object CPU update cost remains. Measured: a 5k-draw streamed world spends ~30 ms
per frame in these updates; with the check reordered (`firstInitialization` → `isStatic || isBundle` → `hasNode`)
the same scene drops to **~5 ms**.

### 2. The once-per-observer `renderId` early-return also defeats the freeze — and is load-bearing

```js
if (this.renderId !== renderId) {
  this.renderId = renderId;
  return true;
}
```

This refreshes the first renderObject of every observer each frame. In the render-bundle example (8k meshes,
2 materials) that is ~2 refreshes/frame — negligible, and it quietly keeps the shared (render-group) bind-group
buffers uploaded. In a scene with ~1 object per material (streamed world, InstancedMesh per model — note the
render-object cache key contains `object.uuid` for instanced meshes, so programs/observers are per object), it
degenerates to O(N) refreshes — same 30 ms.

### 3. With a real freeze, frozen objects lose camera updates (glued world)

Shared groups (`renderGroup`: `cameraViewMatrix` etc.) upload inside `Bindings._update`, which only runs for
refreshed objects. If every object of a program is frozen, that program's shared bind group never re-uploads →
the bundled world is glued to the recorded view while the camera moves. Shared bind groups ARE cached across
programs by uniform node ids (`_getBindGroup`), so ONE refreshed object per frame is enough to keep the whole
scene's camera alive — a "heartbeat". We validated: reorder from (1) + always-refresh the first renderObject of
each bundle during replay → correct rendering, live camera, ~5 ms.

### Suggested direction

- Reorder `needsRefresh`: `firstInitialization` → `isStatic || isBundle` → `hasNode`/velocity.
- During static-bundle replay, keep shared (non-OBJECT) uniform groups uploading — either a designated heartbeat
  render object per bundle, or a direct shared-group update pass (our attempt to write buffers directly via
  `backend.updateBinding` outside the normal path broke rendering silently, so the heartbeat is the safer shape).
- Longer term this ties into the `referenceBuffer()` refactor discussed in #29066 — per-object programs (uuid in
  the cache key) are what make per-observer refresh O(N) in instanced scenes.

Patch we run in production (against 0.185.1) available; happy to PR any of the above.
