# `FogSt` and `FarClp`: what SA actually does with them, and what a NEGATIVE fog start means

**Recovered 2026-08-22 from `gta-reversed-modern`** (`docs/links.md`), for plan
[104/04](../plans/104-timecyc24h-source/readme.md). The question it answers: our environment driver floored
the timecyc fog start at 0, and both stock and the `timecyc24h.asi` tables author it negative — 37 stock
keyframes, 243 of Dante's rows. Before fitting anything, what does the original do?

## The chain, end to end

There is exactly ONE consumer of the timecyc fog start in the whole game:

```cpp
// source/app/app_game.cpp:355  (RenderScene's caller, each frame)
RwCameraSetFarClipPlane(Scene.m_pRwCamera, CTimeCycle::GetFarClip());
Scene.m_pRwCamera->fogPlane = CTimeCycle::GetFogStart();
```

and the camera's two planes become the D3D9 linear-fog range:

```cpp
// source/app/platform/win/WindowedMode.cpp:1558
RwD3D9SetRenderState(D3DRS_FOGSTART, FLOATASDWORD(camera->fogPlane));
RwD3D9SetRenderState(D3DRS_FOGEND,   FLOATASDWORD(camera->farPlane));
```

with the fog TYPE set once at startup and never changed:

```cpp
// source/app/app.cpp:178  (DefinedState)
RwRenderStateSet(rwRENDERSTATEFOGTYPE, RWRSTATE(rwFOGTYPELINEAR));
```

**No clamp anywhere.** Not in `CTimeCycle::Update`, not at the assignment, not at the render state. The
authored number goes to the GPU as written.

So SA's fog is:

```
fogFactor = clamp((FarClp − d) / (FarClp − FogSt), 0, 1)     // 1 = clear, 0 = full fog
pixel     = fogFactor · shaded + (1 − fogFactor) · fogColour
```

and the fog COLOUR is the timecyc's **sky-bottom** colour — `CTimeCycle::GetFogRed/Green/Blue()` are
literally `GetSkyBottom*()` (`TimeCycle.h:165-167`).

## What a negative `FogSt` means

Substituting `d = 0`:

```
fog at the camera = −FogSt / (FarClp − FogSt)
```

**A negative fog start is a haze that is already partly opaque where the player stands.** It is not a clamp,
not a disabled state and not a special value: the linear ramp simply begins *behind* the viewer, so the
weather has no clear near zone. FOGGY_SF's stock `−200 / 150` is 57 % fog at the camera; Dante's
`−1600 / 80` is 95 %.

Read the other way: `FogSt` is the distance at which fog begins, and authoring it negative is how the table
says *"begins before you"*. The original's own header comment for the column calls it a **fog start
OFFSET** (`TimeCycle.cpp:91`), which is the same statement.

## Four smaller facts from the same read

- **`m_fFogStart` is stored as `int16`**, not float: `m_fFogStart[h][w] = (int16)fogStart`
  (`TimeCycle.cpp:165`, the array is `Colors<int16>` at `0xB7B060`). The table's decimals are discarded, and
  a value past ±32 767 would wrap. Worth knowing for a generated table: our own `convertTo24h` produces
  non-integer fog starts on 47 of its 504 rows by interpolating between keyframes — SA would truncate them.
- **`−1` is a sentinel, but only for the interior/extracolour override.** `CTimeCycle::Update` applies a
  weather box's extracolour fog start only `if (m_fFogStart[boxHour][boxWeather] != -1)`
  (`TimeCycle.cpp:416`). It says nothing about the 21 time weathers.
- **`m_FogReduction` moves the FAR CLIP, never the start.** It counts 0…64 up while the camera looks steeply
  down (forward.z < −0.9), or in a no-rain cull zone, or during a cutscene, and down otherwise; then
  `farClip = max(farClip, FogReduction · 10.15625)` — up to 650 (`TimeCycle.cpp:366`, `:487`).
- **Altitude shortens the far clip too**: above z = 200 a far clip over 1000 is lerped down to 1000 by
  z = 500 (`TimeCycle.cpp:493`). Neither of these touches `FogSt`.

## The census, in the tables this project ships

| Table | Rows | `FogSt < 0` | min | `FarClp` range |
| --- | --- | --- | --- | --- |
| stock `timecyc.dat` | 184 (23 × 8) | 37 | −200 | 1 … 1 500 |
| stock expanded to 24h by `convertTo24h` | 504 | 112 | −200 | 1 … 1 500 |
| `timecyc24h.dat` (Dante) | 552 (23 × 24) | 243 | **−1 700** | 78 … 1 500 |

**The floor was never only a Dante problem**: it discarded stock's own near haze on 112 of 504 rows, which
is why FOGGY_SF has never looked foggy from where the player stands.

## What OpenSA does with this

We do not port the linear ramp — our fog is an exp²-shaped curve with a height falloff and a dissolve into
the sky at the ring (`packages/engine/src/render/shaders.ts`, the 068 shape), and that is a deliberate
difference. What the recovered rule fixes is the INPUT: the shader computes `max(dist − fogStart, 0)`, so a
negative start already means "fog is under way at the camera" in our curve exactly as it does in SA's, and
the `Math.max(0, …)` in the driver was throwing that away before the shader ever saw it. At the camera our
curve reads a little lighter than SA's linear one for a shallow haze (7.8 % vs 14.3 % for `−100 / 600`) and
lands within two points of it for a heavy one (97 % vs 95 % for `−1600 / 80`).

One honest limit: `WindowedMode.cpp` is gta-reversed's own re-implementation of RenderWare's camera update,
not RenderWare's source, which is closed. The render-state pair above is therefore the reversed engine's
statement of what RW does, corroborated by the fog type being set to linear once at startup and by
`fogPlane` having no other consumer.
