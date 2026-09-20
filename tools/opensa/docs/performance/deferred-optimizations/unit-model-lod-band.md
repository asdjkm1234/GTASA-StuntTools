# Deferred — draw a unit's `_vlo` mesh at city zoom

**The lever.** Every converted car ships its low-detail `_vlo` mesh in the same buffers as its body, as
`kind: 'lod'` submeshes ([`VehicleModelSubmesh`](../../../packages/renderware/src/vehicle/types.ts)). The
dispatch console hides them and draws the full body at every zoom
([201/5-04](../../plans/201-dispatch-console/5-symbology-and-picking-as-product/readme.md)), including the
city overview where a car is a dozen pixels across.

**What it would save.** The triangle count of the fleet, at the zoom where the fleet is largest: 150 units
at the declared count, each a full car mesh, on a phone. Switching them per instance is one call the layer
already makes — `setSubmeshVisible` — against a distance the camera already knows, so the change is small.

**What it costs, and why it is not taken.** Nothing has measured what the fleet costs yet. The number 5/04
owes is exactly *draws and frame time at 150 units with models, desktop and phone*, and it is owed by
[2/03](../../plans/201-dispatch-console/2-real-device-truth/readme.md), on hardware nobody in a container
has. Taking this now would be tuning before the measurement — the order
[the chain's own evidence table](../../plans/201-dispatch-console/readme.md) rejects — and it would also
spend the clearest signal the first capture can give: a fleet drawn at full detail is the honest worst case,
and a budget met at the worst case needs no lever at all.

There is a second, smaller reason to wait: a `_vlo` is authored for the game's LOD band (tens of metres),
not for a map camera a kilometre up. Whether it still reads as the right CAR at that distance — the thing an
operator is actually identifying — is a look question for the device, not a reasoning one.

**What would pull it.** A capture at 150 units that misses the 60 fps budget with the vehicle pass among the
top costs. Then: switch per instance on projected size, and record the before/after in the same benchmark row.
