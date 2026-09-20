/**
 * WGSL module store (plan 074/01): named modules resolved through `#include <name>` at boot — variants are
 * ENUMERATED (each resolved source is snapshot-testable), never string-patched at runtime. The M0 set: the
 * world shader (opaque/cutout share one source; the cutout difference is pipeline state — alpha-to-coverage).
 *
 * naga/Metal guardrails (073 scars, enforced by `assertGuardrails`): no dynamically-indexed uniform-space
 * arrays, no unbounded loops.
 */

const MODULES: Record<string, string> = {
  /**
   * Bloom (074/09 — prod parity with postprocessing's BloomEffect, mipmapBlur path). Three entry points
   * share the fullscreen-triangle vertex: PREFILTER (full-res luminance threshold — prod thresholds BEFORE
   * the chain, texel-wise, so sub-pixel emitters survive), DOWNSAMPLE (the 13-tap kernel: 4 inner ×0.125 +
   * 8 outer + centre ×0.05556, out-of-frame taps zeroed like prod's clampToBorder) and UPSAMPLE (9-tap
   * tent 1-2-1/16, blended over the same-size downsample mip with `mix(support, tent, radius)`).
   * All passes run on rgba16float targets — HDR overshoot IS the bloom energy (the plan-071 lesson).
   */
  bloom: /* wgsl */ `
struct Bloom {
  // texel = [1/inputW, 1/inputH, 0, 0] of the INPUT texture; params = [threshold, smoothing, radius, 0].
  texel: vec4f,
  params: vec4f,
};
@group(0) @binding(0) var<uniform> bloom: Bloom;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var inputSampler: sampler;
// Upsample only: the same-size DOWNSAMPLE mip the tent result composites over.
@group(0) @binding(3) var supportTex: texture_2d<f32>;

struct BloomOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vsBloom(@builtin(vertex_index) index: u32) -> BloomOut {
  var corners = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  let corner = corners[index];
  var out: BloomOut;
  out.clip = vec4f(corner, 0.0, 1.0);
  out.uv = vec2f(corner.x * 0.5 + 0.5, 0.5 - corner.y * 0.5);
  return out;
}

// Rec709 luminance — three's luminance() (the prod threshold is measured on this).
fn bloomLuma(rgb: vec3f) -> f32 {
  return dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
}

@fragment
fn fsBloomPrefilter(in: BloomOut) -> @location(0) vec4f {
  let texel = textureSampleLevel(inputTex, inputSampler, in.uv, 0.0);
  let mask = smoothstep(bloom.params.x, bloom.params.x + bloom.params.y, bloomLuma(texel.rgb));
  return texel * mask;
}

// 1 inside [0,1]², 0 outside — prod's clampToBorder (edge taps must not smear the frame border).
fn insideFrame(uv: vec2f) -> f32 {
  let inside = step(vec2f(0.0), uv) * step(uv, vec2f(1.0));
  return inside.x * inside.y;
}

fn borderTap(uv: vec2f) -> vec4f {
  return textureSampleLevel(inputTex, inputSampler, uv, 0.0) * insideFrame(uv);
}

const DOWN_INNER = 0.125;
const DOWN_OUTER = 0.05556;

@fragment
fn fsBloomDown(in: BloomOut) -> @location(0) vec4f {
  let t = bloom.texel.xy;
  var c = vec4f(0.0);
  // Inner ring (half-texel corners at the input resolution).
  c += borderTap(in.uv + t * vec2f(-1.0, 1.0)) * DOWN_INNER;
  c += borderTap(in.uv + t * vec2f(1.0, 1.0)) * DOWN_INNER;
  c += borderTap(in.uv + t * vec2f(-1.0, -1.0)) * DOWN_INNER;
  c += borderTap(in.uv + t * vec2f(1.0, -1.0)) * DOWN_INNER;
  // Outer ring + centre.
  c += borderTap(in.uv + t * vec2f(-2.0, 2.0)) * DOWN_OUTER;
  c += borderTap(in.uv + t * vec2f(0.0, 2.0)) * DOWN_OUTER;
  c += borderTap(in.uv + t * vec2f(2.0, 2.0)) * DOWN_OUTER;
  c += borderTap(in.uv + t * vec2f(-2.0, 0.0)) * DOWN_OUTER;
  c += borderTap(in.uv + t * vec2f(2.0, 0.0)) * DOWN_OUTER;
  c += borderTap(in.uv + t * vec2f(-2.0, -2.0)) * DOWN_OUTER;
  c += borderTap(in.uv + t * vec2f(0.0, -2.0)) * DOWN_OUTER;
  c += borderTap(in.uv + t * vec2f(2.0, -2.0)) * DOWN_OUTER;
  c += textureSampleLevel(inputTex, inputSampler, in.uv, 0.0) * DOWN_OUTER;
  return c;
}

@fragment
fn fsBloomUp(in: BloomOut) -> @location(0) vec4f {
  let t = bloom.texel.xy;
  var c = vec4f(0.0);
  c += textureSampleLevel(inputTex, inputSampler, in.uv + t * vec2f(-1.0, 1.0), 0.0) * 0.0625;
  c += textureSampleLevel(inputTex, inputSampler, in.uv + t * vec2f(0.0, 1.0), 0.0) * 0.125;
  c += textureSampleLevel(inputTex, inputSampler, in.uv + t * vec2f(1.0, 1.0), 0.0) * 0.0625;
  c += textureSampleLevel(inputTex, inputSampler, in.uv + t * vec2f(-1.0, 0.0), 0.0) * 0.125;
  c += textureSampleLevel(inputTex, inputSampler, in.uv, 0.0) * 0.25;
  c += textureSampleLevel(inputTex, inputSampler, in.uv + t * vec2f(1.0, 0.0), 0.0) * 0.125;
  c += textureSampleLevel(inputTex, inputSampler, in.uv + t * vec2f(-1.0, -1.0), 0.0) * 0.0625;
  c += textureSampleLevel(inputTex, inputSampler, in.uv + t * vec2f(0.0, -1.0), 0.0) * 0.125;
  c += textureSampleLevel(inputTex, inputSampler, in.uv + t * vec2f(1.0, -1.0), 0.0) * 0.0625;
  let support = textureSampleLevel(supportTex, inputSampler, in.uv, 0.0);
  return mix(support, c, bloom.params.z);
}
`,
  /**
   * Probe DEBUG view (074/16): replaces the frame with the cube sampled along the camera ray — look around
   * and the probe's content must match the world's orientation exactly. This is how the face table is
   * verified by EYE instead of by convention-table archaeology. Lab/game: append the probeview URL flag.
   */
  /**
   * Debug wireframes (074/13 phase 4): world-space line lists for COL collision hulls and mesh edges.
   * Vertices arrive already in ENGINE space, so the host owns the GTA Z-up → Y-up basis change (the same
   * split every other rigid draw uses). Unlit and unfogged on purpose — a debug overlay must read the
   * same at 5 m and at 500 m.
   */
  /**
   * Cumulus field bake (074/06 row 4 sky v2 perf): rg = [n, mass] fbm over the SOFTENED sky projection
   * p = dir.xz / (dir.y + 0.18), mapped uv = p/12 + 0.5 (|p| ≤ 5.6 at the horizon fits the domain; a
   * hard floor froze the mapping below it and storm decks streaked vertically — field bug). Drift and
   * the per-weather clump scale (cloudTop.w) bake IN, so consumers sample by projection alone — a 256²
   * × 10 vnoise pass per frame replaces 10 vnoise per SKY PIXEL (field round: full decks stuttered at 2×).
   */
  'cloud-field': /* wgsl */ `
#include <frame>

struct CloudFieldOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vsCloudField(@builtin(vertex_index) index: u32) -> CloudFieldOut {
  var corners = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  let corner = corners[index];
  var out: CloudFieldOut;
  out.clip = vec4f(corner, 0.0, 1.0);
  out.uv = vec2f(corner.x * 0.5 + 0.5, 0.5 - corner.y * 0.5);
  return out;
}

@fragment
fn fsCloudField(in: CloudFieldOut) -> @location(0) vec4f {
  let t = frame.params2.z;
  let p = (in.uv - vec2f(0.5)) * 12.0;
  let cuv = p * (0.45 * frame.cloudTop.w) + vec2f(t * 0.004, t * 0.002);
  return vec4f(skyFbm(cuv), skyFbm(cuv * 0.4 + vec2f(19.0)), 0.0, 1.0);
}
`,
  /**
   * Procedural clutter (074/19 B7·d): grass/bushes/rocks scattered per cell from procobj.dat, drawn INSTANCED —
   * thousands of copies of a handful of models, one draw per (cell × model). Per-instance world matrix in a
   * storage buffer (instance_index), world-material lighting (vertex-colour prelit + sun/moon + the 068 fog).
   * Two variants: opaque (rocks) and cutout (A2C — grass/bushes alpha edges). No baked channels (clutter is
   * scattered, not welded), no local lights (v1 — the pool is for the static world).
   */
  clutter: /* wgsl */ `
#include <frame>

@group(1) @binding(0) var<storage, read> clutterMatrices: array<mat4x4f>;
@group(1) @binding(1) var clutterTexture: texture_2d_array<f32>;
@group(1) @binding(2) var clutterSampler: sampler;
// .x = this group's SQUARED draw distance — the per-category visibility range. Applied per INSTANCE because
// the clutter grid is 256 units: a whole-group test cannot express a radius under a cell diagonal.
@group(1) @binding(3) var<uniform> clutterRange: vec4f;

// Geometry is the shared vehicle-model layout (buildVehicleModel): slots.x = texture-array layer (the only
// meta clutter uses — paint slot / lamp tags are ignored). One draw covers every submesh; the per-vertex
// layer selects the right texture, exactly like the rigid path. Named slots (not meta) — meta is a WGSL
// reserved word, the same rename the rigid shader made.
struct ClutterIn {
  @builtin(instance_index) instance: u32,
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) color: vec4f,
  @location(4) slots: vec4<u32>,
  // The NIGHT vertex colours — every one of the 56 species procobj scatters carries an AUTHORED set, so
  // the old in-shader day x ambient guess was overwriting art that shipped with the model.
  @location(5) night: vec4f,
};

struct ClutterOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) prelit: vec3f,
  @location(2) world: vec3f,
  @location(3) sunNdl: f32,
  @location(4) moonNdl: f32,
  @location(5) @interpolate(flat) layer: u32,
};

@vertex
fn vsClutter(in: ClutterIn) -> ClutterOut {
  let model = clutterMatrices[in.instance];
  let world = model * vec4f(in.position, 1.0);
  var out: ClutterOut;
  out.clip = frame.viewProj * world;
  out.world = world.xyz;
  out.uv = in.uv;
  out.layer = in.slots.x;
  // Day → night on the authored sets, the same blend the world and rigid paths use. The builder synthesizes
  // day × ambient where a species truly has no night set, so this is one formula everywhere.
  out.prelit = mix(in.color.rgb, in.night.rgb, frame.params.x);
  let n = normalize((model * vec4f(in.normal, 0.0)).xyz);
  out.sunNdl = max(dot(n, frame.sunDir.xyz), 0.0);
  out.moonNdl = clamp((dot(n, frame.moonDir.xyz) + 0.6) / 1.6, 0.0, 1.0);
  // Per-category range: an instance whose ORIGIN is past this group's draw distance is pushed outside the
  // clip volume, so the triangle is rejected before any fragment work. Every vertex of the instance takes the
  // same branch and lands on the same point, so the rejection is total rather than a torn primitive. Measured
  // from the instance ORIGIN (not the vertex) so a species never half-disappears, and squared to keep the
  // sqrt out of the vertex path.
  let toInstance = model[3].xyz - frame.camera.xyz;
  if (dot(toInstance, toInstance) > clutterRange.x) {
    out.clip = vec4f(2.0, 2.0, 2.0, 1.0);
  }
  return out;
}

fn clutterShade(in: ClutterOut, cutout: bool) -> vec4f {
  var texel = textureSample(clutterTexture, clutterSampler, in.uv, in.layer);
  if (cutout) {
    // Sharpen the sampled alpha toward the vanilla alpha-test look (the world-cutout trick), so minified grass
    // does not turn into a uniform A2C screen-door.
    texel.a = clamp((texel.a - 0.5) / max(fwidth(texel.a), 0.0001) + 0.5, 0.0, 1.0);
  }
  // frame.ambient (plan 093): the same additive SA ambient floor the world shader carries (no AO
  // channel on clutter).
  let lit = in.prelit * frame.params.y + frame.ambient.rgb +
    frame.sunColor.rgb * (in.sunNdl * frame.params.z) +
    frame.moonColor.rgb * in.moonNdl;
  var color = texel.rgb * lit;
  // Unified fog (the 068 shape — identical math to fsWorld).
  let toCamera = in.world - frame.camera.xyz;
  let dist = length(toCamera);
  let viewDir = toCamera / max(dist, 0.001);
  let fogD = max(dist - frame.fog.y, 0.0);
  let fogK = 2.0 / max(frame.fog.x - frame.fog.y, 1.0);
  var fogFactor = 1.0 - exp(-(fogK * fogD) * (fogK * fogD));
  fogFactor = fogFactor * mix(frame.fog.w, 1.0, exp(-max(in.world.y, 0.0) * frame.fog.z));
  fogFactor = max(fogFactor, smoothstep(frame.fog.x * 0.85, frame.fog.x, dist));
  color = mix(color, fogColorFor(viewDir, fogFactor), fogFactor);
  return vec4f(color, texel.a);
}

@fragment
fn fsClutter(in: ClutterOut) -> @location(0) vec4f {
  return clutterShade(in, false);
}

@fragment
fn fsClutterCutout(in: ClutterOut) -> @location(0) vec4f {
  return clutterShade(in, true);
}
`,
  corona: /* wgsl */ `
#include <frame>

// 2dfx coronas (074/06 row 13 v1): instanced camera-facing quads, PROCEDURAL radial glow (the particle.txd
// sprites arrive with the texture path later), additive premultiplied blending, depth READ (occluders hide
// coronas). Night-gated on the CPU side (dn scales the instance colour before upload).
struct CoronaIn {
  @location(0) corner: vec2f,
  @location(1) center: vec3f,
  @location(2) size: f32,
  @location(3) color: vec4f,
};

struct CoronaOut {
  @builtin(position) clip: vec4f,
  @location(0) offset: vec2f,
  @location(1) color: vec4f,
};

@vertex
fn vsCorona(in: CoronaIn) -> CoronaOut {
  var out: CoronaOut;
  // Camera basis from the inverse view-projection is overkill — build right/up from the view matrix baked
  // into viewProj via the camera position: cheap billboard using the eye-to-center frame.
  let toEye = normalize(frame.camera.xyz - in.center);
  let right = normalize(cross(vec3f(0.0, 1.0, 0.0), toEye));
  let up = cross(toEye, right);
  let world = in.center + (right * in.corner.x + up * in.corner.y) * in.size;
  out.clip = frame.viewProj * vec4f(world, 1.0);
  out.offset = in.corner;
  out.color = in.color;
  return out;
}

@fragment
fn fsCorona(in: CoronaOut) -> @location(0) vec4f {
  // The real SA coronastar sprite (particle.txd) — it has the cross flare a procedural blob cannot fake.
  // The host normalises the alpha (SA ships these shape-in-RGB with alpha pinned at 255), so trust it here.
  let uv = in.offset * 0.5 + vec2f(0.5); // the quad spans [-1, 1] — see the particle shader's note
  let texel = textureSample(coronaSprites, skyLutSampler, uv, 0u);
  return vec4f(in.color.rgb * texel.rgb * (texel.a * in.color.a), 0.0);
}
`,
  /**
   * Prop debris (074/08 B7·a step 4) — one draw per break, and NOTHING per frame on the CPU.
   *
   * Every vertex carries its shard's whole flight: centroid, velocity, spin axis x speed, and the age at
   * which the centroid reaches the ground. The shard flies a ballistic arc about its centroid, spins, then
   * FREEZES the moment it lands (translation and spin both) — which is why the arithmetic clamps age at
   * landTime rather than stopping the draw. The three path shipped without a ground probe and its shards sank
   * through the floor; here the host probes the ground, so they come to rest on it.
   */
  debris: /* wgsl */ `
#include <frame>

struct DebrisUniform {
  spawn: vec4f,   // x = spawn time (frame clock), y = lifetime, z = fade seconds, w = gravity
};
@group(1) @binding(0) var<uniform> debris: DebrisUniform;
@group(1) @binding(1) var shards: texture_2d_array<f32>;
@group(1) @binding(2) var shardSampler: sampler;

struct DebrisIn {
  @location(0) position: vec3f,
  @location(1) uv: vec2f,
  @location(2) color: vec4f,
  @location(3) center: vec3f,
  @location(4) velocity: vec3f,
  @location(5) angular: vec3f,
  @location(6) landLayer: vec2f,   // x = land time (s), y = texture layer
};

struct DebrisOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec4f,
  @location(2) @interpolate(flat) layer: u32,
  @location(3) fade: f32,
};

/** Rodrigues: rotate v about a unit axis by the given angle. */
fn rotateAxis(v: vec3f, axis: vec3f, angle: f32) -> vec3f {
  let c = cos(angle);
  let s = sin(angle);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

@vertex
fn vsDebris(in: DebrisIn) -> DebrisOut {
  var out: DebrisOut;
  let age = max(frame.params2.z - debris.spawn.x, 0.0);
  // Frozen once it lands: both the arc and the spin stop at the same instant, or a resting shard would
  // keep twitching on the ground.
  let t = min(age, in.landLayer.x);
  let speed = length(in.angular);
  let axis = select(vec3f(0.0, 1.0, 0.0), in.angular / max(speed, 1e-5), speed > 1e-5);
  let spun = rotateAxis(in.position - in.center, axis, speed * t);
  let center = in.center + in.velocity * t + vec3f(0.0, -0.5 * debris.spawn.w, 0.0) * t * t;
  out.clip = frame.viewProj * vec4f(center + spun, 1.0);
  out.uv = in.uv;
  out.color = in.color;
  out.layer = u32(in.landLayer.y);
  out.fade = 1.0 - smoothstep(debris.spawn.y - debris.spawn.z, debris.spawn.y, age);
  return out;
}

@fragment
fn fsDebris(in: DebrisOut) -> @location(0) vec4f {
  let texel = textureSample(shards, shardSampler, in.uv, in.layer);
  let color = texel.rgb * in.color.rgb;
  let alpha = texel.a * in.color.a * in.fade;
  return vec4f(color * alpha, alpha);   // premultiplied, like every other blended pass here
}
`,
  'debug-line': /* wgsl */ `
#include <frame>

struct DebugLineUniform {
  color: vec4f,
};
@group(1) @binding(0) var<uniform> debugLine: DebugLineUniform;

struct DebugLineOut {
  @builtin(position) clip: vec4f,
};

@vertex
fn vsDebugLine(@location(0) position: vec3f) -> DebugLineOut {
  var out: DebugLineOut;
  out.clip = frame.viewProj * vec4f(position, 1.0);
  return out;
}

@fragment
fn fsDebugLine() -> @location(0) vec4f {
  return debugLine.color;
}
`,
  frame: /* wgsl */ `
struct Frame {
  viewProj: mat4x4f,
  invViewProj: mat4x4f,
  // camera.w = cloud dome slot A→B crossfade blend (row 15 weather fade; spare vec4 slot).
  camera: vec4f,
  // Environment (plan 074/06): sun direction (unit, towards the sun; .w = CURRENT ARC ELEVATION 0..1,
  // the sun-vis v2 threshold input — 074/07), sun colour,
  // params  = [dn (0 day → 1 night), indirectScale, directScale, emissiveBoost],
  // skyTop / skyHorizon = LINEAR sky gradient colours (row 4 v1 — the PBR LUT replaces them later),
  // fog     = [cutDistance, startDistance, heightK, heightMin] (row 5 — the 068 shape),
  // params2 = [aoStrength (074/07 baked skyVis → indirect), sunVisStrength (074/07 baked sun shadows),
  //            time seconds (the wind clock), windStrength (074/06 row 10)],
  // moonDir/moonColor = the night light (074/06 row 6; colour is BLACK by day — the CPU arc gates it);
  // moonDir.w = stochastic de-tiling toggle (074/12); moonColor.w = spare (held the retired
  // cloud-panorama rotation speed).
  sunDir: vec4f,
  sunColor: vec4f,
  params: vec4f,
  skyTop: vec4f,
  skyHorizon: vec4f,
  fog: vec4f,
  params2: vec4f,
  moonDir: vec4f,
  moonColor: vec4f,
  // params3 = [localLightCount (row 7), spare (held the retired panorama enable), cloudDark, cloudLayerAlpha].
  params3: vec4f,
  // The SUN VISUAL (timecyc columns): sunCore = disc colour (.w = angular core radius, rad, from
  // timecyc sunSize); sunCorona = halo/godray colour (.w = weather cloud COVER 0..1 — prod's uCloudClear
  // source: stars fade GLOBALLY under overcast). env.sunColor above stays the LIGHT.
  sunCore: vec4f,
  sunCorona: vec4f,
  // Water v1 (074/06 row 12): timecyc WaterRGBA — deep tint (linear rgb) + base opacity in .w.
  waterColor: vec4f,
  // params4 = [dynamicLightCount, moonPhase (B6), reflectionStrength (B5r), probeMix (074/16 step 2 —
  // 0 = analytic sky fallback, 1 = all six faces of the scene probe rendered)]. The pool is ordered
  // DYNAMIC first, then static 2dfx: the world shades the static half per vertex and the dynamic half per
  // pixel; vehicles and peds take the STATIC half only, so a car is never lit by its own lamps.
  params4: vec4f,
  // timecyc cloud colours (074/09 sky round 2): lowClouds (lit tops) / bottomClouds (shadowed undersides)
  // tint the cloud deck — the authored dawn/dusk palette turns the WHOLE sky's clouds pink, not just
  // the sun side (prod applyClouds colours its deck from exactly these columns).
  cloudTop: vec4f,
  cloudBottom: vec4f,
  // World ambient floor (plan 093): linear timecyc Amb. SA's building pipe ADDS this on top of the
  // blended prelight (ps2BuildingVS: Color.rgb += ambient*surfAmb) — normal-independent, which is
  // why vanilla ships pure-black shadow prelit and still reads as shadow. .w spare.
  ambient: vec4f,
};
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var skyLut: texture_2d<f32>;
@group(0) @binding(2) var skyLutSampler: sampler;
// Bindings 4/5 held the painted cloud-panorama dome — REMOVED 2026-07-17 (procedural cirrus+cumulus
// carry the clouds); the numbers stay vacant so the rest never renumbers.
// SA corona billboards from particle.txd: layer 0 = coronastar (lamps, headlights), layer 1 = coronamoon.
@group(0) @binding(6) var coronaSprites: texture_2d_array<f32>;
// Baked cumulus field (sky v2 perf): rg = [n, mass] fbm baked over the sky projection by the tiny
// cloud-field pass each frame — full-deck weathers pay one tap here instead of 10 vnoise per pixel.
@group(0) @binding(7) var cloudField: texture_2d<f32>;

// ASSET-INSPECTION debug knobs (074/13 phase 4), riding two spare frame lanes so the uniform never grows
// (it would invalidate every recorded cell bundle). Both are inert at their defaults — scale 1, unlit 0 —
// so normal play multiplies by one and selects the untouched lit term. NOTE: no backticks in WGSL
// comments — these modules are JS template literals and a stray backtick ends the string.

/**
 * Baked vertex light: 1 = as authored, 0 = OFF, 2 = SA's MODULATE2X.
 * "Off" is a NEUTRAL multiplier (white), not a zero one — the point is to see the texture without the
 * baked light, not to black the model out. ×2 saturates, as MODULATE2X does on real hardware.
 */
fn debugPrelit(color: vec3f) -> vec3f {
  let scale = frame.params3.y;
  return select(min(color * scale, vec3f(1.0)), vec3f(1.0), scale < 0.5);
}

/**
 * Debug VIEW mode on the same spare lane: 0 = normal shading, 1 = unlit (flat albedo), 2 = normals.
 *
 * One lane, one view at a time — the three build shared a single scene-wide override slot for exactly this
 * reason, so enabling one debug view disabled the other. Widening the existing flag keeps the uniform the
 * same size, which is load-bearing: growing it invalidates every recorded cell bundle.
 */
fn debugView() -> f32 {
  return frame.moonColor.w;
}

/** Flat albedo (no sun/moon/pool response) when the unlit view is selected. */
fn debugLit(lit: vec3f) -> vec3f {
  return select(lit, vec3f(1.0), abs(debugView() - 1.0) < 0.5);
}

/**
 * Normal visualisation, the same mapping the three MeshNormalMaterial used: n * 0.5 + 0.5. Returned INSTEAD
 * of the shaded colour and before fog — a fogged normal is a fogged debug view, which is no debug view.
 */
fn debugNormalColor(normal: vec3f) -> vec3f {
  return normalize(normal) * 0.5 + vec3f(0.5);
}

/** Whether the normals view is selected. */
fn debugShowNormals() -> bool {
  return debugView() > 1.5;
}

// Shared sky colour by view direction (the sky pass AND the world fog sample the same PBR dome — fully
// fogged geometry dissolves into exactly the sky behind it, the 068 invariant). The dome is a CPU-built
// Preetham LUT (074/06 row 4): u = azimuthal angle from the sun (the dome is sun-symmetric), v = elevation.
// The moon's angular radius as a multiple of the sun's (they are famously close in the real sky; SA draws a
// bigger, friendlier moon). MOON_BODY_GAIN keeps the lit disc HDR so it feeds the bloom/godray pass.
const MOON_DISC_SCALE = 3.2;
const MOON_BODY_GAIN = 10.0;

fn skyBaseFor(dir: vec3f) -> vec3f {
  let dirXz = normalize(vec2f(dir.x, dir.z) + vec2f(1e-5, 0.0));
  let sunXz = normalize(vec2f(frame.sunDir.x, frame.sunDir.z) + vec2f(1e-5, 0.0));
  let azimuth = acos(clamp(dot(dirXz, sunXz), -1.0, 1.0)) / 3.14159265;
  let v = clamp((dir.y + 0.05) / 1.05, 0.0, 1.0);
  var col = textureSampleLevel(skyLut, skyLutSampler, vec2f(azimuth, v), 0.0).rgb;
  // Night sky glow (074/09 sky round — the prod skyBase port): the authored SA night gradient is
  // near-black, so prod adds the moon's cool Rayleigh scatter (halo + a soft lift of its hemisphere) and
  // the warm URBAN skyglow band at the horizon (San Andreas is a metropolis — city nights are never
  // black; the deck reflects the city light, so overcast makes it BRIGHTER). Living in the shared base,
  // it feeds the world fog too — night fog matches the glowing horizon, the 068 invariant.
  // FADE (sky round 3 — "it kicks in abruptly", the field report, paraphrased): the sink window is widened to the whole post-sunset margin
  // AND the glow rides dn (the hour-long dusk ramp) — the city light breathes in with the darkness
  // instead of snapping on in the ~40 s the sun needs to cross a narrow horizon band.
  let pbrNight = (1.0 - smoothstep(-0.22, -0.01, frame.sunDir.y)) * frame.params.x;
  if (pbrNight > 0.01) {
    // env.moonColor ≈ (0.34, 0.44, 0.72) × its CPU gate (peak 0.5 × skylight 0.6 → b = 0.216) — recover
    // the gate so the glow follows the night band/cloud fade without a new UBO slot.
    let moonGate = clamp(frame.moonColor.b / 0.216, 0.0, 1.0);
    let moonGlow = vec3f(0.45, 0.62, 1.0) * (0.055 * moonGate);
    let cityGlow = vec3f(1.0, 0.58, 0.3) * (0.03 * (1.0 + frame.sunCorona.w * 1.2));
    let moonHalo = pow(max(dot(dir, frame.moonDir.xyz), 0.0), 8.0);
    let moonHemi = 0.5 + 0.5 * dot(dir, frame.moonDir.xyz);
    let band = pow(1.0 - clamp(dir.y, 0.0, 1.0), 6.0);
    col += (moonGlow * (moonHalo * 0.6 + moonHemi * moonHemi * 0.12) + cityGlow * band) * pbrNight;
  }
  return col;
}

// Sun + moon discs, split from the gradient so the cloud layer can OCCLUDE them (row 15): the disc
// overshoot survives a partial alpha mix, so clouds must attenuate this term, not blend over it.
fn skyCelestialFor(dir: vec3f) -> vec3f {
  // The prod-look sun (field round 3): a FILLED disc in the timecyc sunCore colour (yellow/orange —
  // prod colours its sun mesh with exactly this column) + an exponential warm corona in sunCorona.
  // Angular sizing comes from timecyc sunSize via sunCore.w. The 3–6× overshoot feeds the godrays
  // post pass (bright-pass threshold) and clips to a hot centre in the swapchain.
  let sunDot = clamp(dot(dir, frame.sunDir.xyz), -1.0, 1.0);
  let ang = acos(sunDot);
  let coreR = max(frame.sunCore.w, 1e-4);
  let disc = (1.0 - smoothstep(coreR * 0.75, coreR, ang)) * 6.0;
  let corona = exp(-ang / (coreR * 2.2)) * 2.6;
  let glow = exp(-ang / (coreR * 8.0)) * 0.5;
  let sun = frame.sunCore.rgb * disc + frame.sunCorona.rgb * (corona + glow);
  let moon = moonFor(dir);
  // The sea-horizon line CLIPS the discs (field: the sun used to just fade out at ground level): drivers
  // now let the arcs sink below y=0, and pixels under the horizon drop the disc — the sun/moon visibly
  // set INTO the ocean, upper sliver last. Soft edge = a few arcminutes of waterline shimmer.
  let horizonClip = smoothstep(-0.003, 0.005, dir.y);
  return (sun + moon) * horizonClip;
}

// Shared value-noise stack (prod SKY_BASE port): hash21 seeds the starfield (sky module) AND the
// procedural cloud layers; skyFbm drives cirrus (sky module) + the cumulus deck below. Lives in the
// frame include because cloudLayerFor (car reflections, every rigid consumer) needs cumulus too.
fn hash21(cell: vec2f) -> f32 {
  return fract(sin(dot(cell, vec2f(127.1, 311.7))) * 43758.5453);
}

fn skyVnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2f(1.0, 0.0)), u.x),
    mix(hash21(i + vec2f(0.0, 1.0)), hash21(i + vec2f(1.0, 1.0)), u.x),
    u.y,
  );
}

fn skyFbm(p: vec2f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var q = p;
  for (var i = 0u; i < 5u; i += 1u) {
    v += a * skyVnoise(q);
    q = q * 2.03 + vec2f(1.7);
    a *= 0.5;
  }
  return v;
}

// Cloud palette (sky v2): timecyc lowClouds/bottomClouds carry the authored HUE (pink dawns, blue
// nights) but their LUMINANCE was authored for SA's gamma-space multiply — used raw under linear+ACES
// the noon deck reads as near-black smudges (field: the panorama looked navy for the same reason).
// Same move as the sky-LUT mood tint: normalize the palette to a hue and drive brightness from a wide
// day ease (sunlit white tops ~1.05, shaded bases ~0.58; night floors keep moonlit decks visible).
struct CloudPalette {
  top: vec3f,
  bottom: vec3f,
}

fn cloudPalette() -> CloudPalette {
  let day = smoothstep(-0.08, 0.25, frame.sunDir.y);
  let top = frame.cloudTop.rgb;
  let bottom = frame.cloudBottom.rgb;
  let topHue = top / max(max(top.r, max(top.g, top.b)), 1e-3);
  let botHue = bottom / max(max(bottom.r, max(bottom.g, bottom.b)), 1e-3);
  return CloudPalette(topHue * mix(0.10, 1.05, day), botHue * mix(0.05, 0.58, day));
}

// CUMULUS (074/06 row 4 sky v2 — the prod applyClouds layer-2 port; the painted panorama is REMOVED):
// coverage-thresholded fbm masses driven by the weather's cloud cover, lit tops / dark undersides shaped
// by a second mass octave, one high-frequency detail octave (full coverage otherwise degenerates into
// huge soft smears), the normalized cloud palette above, golden-hour sun rims with the horizon EASE
// (the audit rule — a bare sunDir.y sign test snaps at 20:00/6:00). rgb = lit cloud colour, a = density.
fn cumulusFor(dir: vec3f, sunDot: f32) -> vec4f {
  if (dir.y <= 0.02) {
    return vec4f(0.0);
  }
  let t = frame.params2.z;
  // SOFTENED plane projection dir.xz/(dir.y + 0.18) — a hard floor (max(dir.y, k)) FREEZES the mapping
  // below k: every elevation under it samples the same field point along a vertical line, and storm
  // decks smeared DOWN to the horizon in vertical streaks (field bug, present in prod too at k=0.12).
  // The soft denominator compresses features toward the horizon like real perspective instead.
  let p = dir.xz / (dir.y + 0.18);
  // n/mass come from the BAKED field (one tap — the field pass owns the 10-vnoise cost per 256² texel,
  // so a full storm deck no longer scales with the swapchain resolution; field round: cloudy stuttered
  // at 2× retina). The field bakes drift and the per-weather clump scale in, so p maps statically.
  let field = textureSampleLevel(cloudField, skyLutSampler, p / 12.0 + vec2f(0.5), 0.0);
  let n = field.r;
  let cover = clamp(frame.sunCorona.w, 0.0, 1.0);
  // Clear-sky edge 0.62 (prod ran 0.92): prod could afford an empty procedural deck because the painted
  // panorama carried the fair-weather clouds — retired now, so a sunny LS day (cover ~0.14) must still
  // scatter real puffs (~35-40 % of the dome at density ~0.25 — measured; 0.74 read as an empty sky in
  // the field). Heavy weathers converge to the same full deck as prod.
  let edge = mix(0.62, -0.25, cover);
  let density = smoothstep(edge, edge + 0.20, n);
  // Early out for clear pixels — skip the detail octave and the palette math.
  if (density <= 0.002) {
    return vec4f(0.0);
  }
  let mass = field.g;
  // cloudTop.w = the per-weather clump-size multiplier (sky v2: SMOG big dirty clumps, storm banks) —
  // recomputed here only for the in-shader DETAIL octave (it needs a higher frequency than the field).
  let cuv = p * (0.45 * frame.cloudTop.w) + vec2f(t * 0.004, t * 0.002);
  let palette = cloudPalette();
  var cloud = mix(palette.bottom, palette.top, smoothstep(0.30, 0.80, n));
  let bright = smoothstep(0.20, 0.72, n) * mix(0.35, 1.0, smoothstep(0.30, 0.72, mass));
  cloud *= mix(1.0, mix(0.16, 1.0, bright), frame.params3.z);
  // Detail octave STRENGTHENS with coverage: a full deck has density 1 everywhere, so all its readable
  // structure must come from colour modulation (field: CLOUDY read as a flat grey wash without this).
  let det = skyVnoise(cuv * 5.7 + vec2f(t * 0.006, 0.0));
  cloud *= 1.0 + (det - 0.5) * mix(0.48, 0.9, cover);
  let golden = (0.25 + 0.65 * (1.0 - clamp(frame.sunDir.y, 0.0, 1.0))) *
    smoothstep(0.0, 0.045, frame.sunDir.y);
  let clearness = 1.0 - cover * 0.85;
  cloud += frame.sunCorona.rgb * (pow(sunDot, 5.0) * golden * clearness * (0.25 + 0.75 * bright));
  let horizon = smoothstep(0.02, 0.30, dir.y);
  return vec4f(cloud, density * horizon);
}

// CIRRUS (prod applyClouds layer 1): thin, high, stretched wisps drifting slowly on their own heading —
// what makes a clear day sky read ALIVE. They belong to clear skies, so coverage suppresses them;
// timecyc cloud colours tint them. Lives in the FRAME include (074/21 P2): the fog colour composites it
// too, and a sky-module-only helper would be an unresolved call target for world/rigid/water consumers
// (the black-canvas gotcha, twice already).
fn cirrusFor(dir: vec3f, sunDot: f32) -> vec4f {
  if (dir.y <= 0.02) {
    return vec4f(0.0);
  }
  let t = frame.params2.z;
  // Same softened projection as the cumulus (a hard floor froze the band under it into vertical smears).
  let cuv = dir.xz / (dir.y + 0.18) * vec2f(0.9, 0.35) + vec2f(t * 0.0013, t * -0.0007) + vec2f(31.7);
  let cover = clamp(frame.sunCorona.w, 0.0, 1.0);
  let amount = smoothstep(0.60, 0.92, skyFbm(cuv)) * (1.0 - cover) * 0.55;
  // The golden term peaks AT the horizon, so a hard y-above-0 select SNAPPED it (0 → 0.9) the frame the
  // sun crossed — the 19:59/5:59 sky jump. ~8 game-minutes of climb (y 0 → 0.045) ease it in/out instead.
  let golden = (0.25 + 0.65 * (1.0 - clamp(frame.sunDir.y, 0.0, 1.0))) *
    smoothstep(0.0, 0.045, frame.sunDir.y);
  // The normalized palette (sky v2) — the raw timecyc luminance read as dark smears under linear+ACES.
  let palette = cloudPalette();
  let tint = mix(palette.bottom, palette.top, 0.85) +
    frame.sunCorona.rgb * (golden * 0.2 + pow(sunDot, 5.0) * golden * 0.5);
  let horizon = smoothstep(0.02, 0.30, dir.y);
  return vec4f(tint, amount * horizon);
}

// The cloud layer in a direction, factored out of fsSky so a CAR can reflect the clouds too: rgb = the lit
// cloud colour, a = its coverage. The analytic reflection fallback mirrors the procedural cumulus, so
// probe-off cars still catch clouds; the probe path renders the real fsSky and needs nothing here.
// (The painted-panorama branch that lived here was REMOVED 2026-07-17 with the dome textures.)
fn cloudLayerFor(dir: vec3f) -> vec4f {
  if (dir.y <= 0.0) {
    return vec4f(0.0);
  }
  return cumulusFor(dir, max(dot(dir, frame.sunDir.xyz), 0.0));
}

/**
 * The MOON (074/06 row 6, B6): the real SA coronamoon sprite plus a PHASE.
 *
 * Vanilla SA fakes its phases by cropping the sprite, which gives a sliced disc rather than a crescent. We
 * light a sphere instead: the moon's surface normal is reconstructed from the disc coordinates, and the lit
 * fraction follows a phase angle (params4.y, advanced by the host with the in-game days). That yields a real
 * terminator — waxing crescent through full and back — for the cost of a dot product.
 *
 * moonColor is BLACK by day, so this whole term dies with it.
 */
fn moonFor(dir: vec3f) -> vec3f {
  let moonDot = dot(dir, frame.moonDir.xyz);
  // Local disc frame: where in the moon's face this view direction lands, in [-1, 1].
  let right = normalize(cross(vec3f(0.0, 1.0, 0.0), frame.moonDir.xyz));
  let up = cross(frame.moonDir.xyz, right);
  let radius = max(frame.sunCore.w * MOON_DISC_SCALE, 1e-4);
  let disc = vec2f(dot(dir, right), dot(dir, up)) / radius;
  let r = length(disc);

  // The sprite across the disc: rgb carries the CRATERS, alpha the round shape (normalised by the host).
  let uv = disc * 0.5 + vec2f(0.5);
  let texel = textureSample(coronaSprites, skyLutSampler, uv, 1u);
  let face = texel.a;

  // Phase: rebuild the surface normal of the sphere at this point and light it from the phase direction.
  let z = sqrt(max(0.0, 1.0 - min(r * r, 1.0)));
  let normal = normalize(right * disc.x + up * disc.y + frame.moonDir.xyz * z);
  let angle = frame.params4.y * 6.2831853;
  let sunward = normalize(right * sin(angle) + frame.moonDir.xyz * (-cos(angle)));
  // A soft terminator: earthshine keeps the dark limb faintly visible, as it is in life.
  let lit = smoothstep(-0.08, 0.12, dot(normal, sunward)) * 0.92 + 0.08;

  let body = texel.rgb * (face * lit * step(r, 1.0) * MOON_BODY_GAIN);
  // A wide soft halo marks the moon's place in the horizon band even when the disc is a thin crescent.
  let halo = pow(max(moonDot, 0.0), 96.0) * 2.2;
  // moonColor now carries the prod-strength LIGHT (peak b 0.216, was 0.105) — rescale so the shipped
  // disc/halo brightness stays exactly as field-accepted.
  return frame.moonColor.rgb * 0.486 * (body + vec3f(halo));
}

// The sky the WORLD FOG dissolves into (068 invariant): the gradient + only the WIDE sun haze. The hot
// disc/corona must NOT be here — fogged silhouettes picked it up and the sun "shone through buildings"
// (field round 3). Prod's disc is a separate mesh for the same reason.
fn skyFogFor(dir: vec3f) -> vec3f {
  let sunDot = max(dot(dir, frame.sunDir.xyz), 0.0);

  return skyBaseFor(dir) + frame.sunCorona.rgb * pow(sunDot, 8.0) * 0.06;
}

// Fog v2 (074/21 P2): a pixel dissolving at the cut must equal the sky INCLUDING its procedural cloud
// decks — with the base-only colour, distant towers read as flat pale silhouettes against any clouded
// sky, and close-fog weathers (FOGGY farClip 250) seam hard against a coloured dawn deck. Same
// cirrus+cumulus composite as fsSky; discs/stars stay excluded (the sun-through-buildings regression,
// field round 3). The clouds ride a NEAR-DISSOLVE weight, not the raw fog factor (074/21 field round,
// "clouds walk onto buildings"): partial fog is in-scattered HAZE — the atmosphere gradient — while the
// building still OCCLUDES the deck behind it, so a mid-fog tower must not pick up the deck's colour
// (a red dawn deck painted tower facades pink). The weight reaches 1 inside the hard-cut band
// (fog ≥ 0.85·cut), exactly where the pale-silhouette fix lives — the dissolve stays seamless.
// The cloud math only runs on meaningfully fogged pixels — the branch is legal in non-uniform control
// flow because every cloud tap uses explicit-LOD sampling — and cumulus/cirrus carry their own
// early-outs, so the clear-range majority of the frame pays one comparison.
fn fogColorFor(dir: vec3f, fogFactor: f32) -> vec3f {
  var col = skyFogFor(dir);
  let cloudW = smoothstep(0.7, 1.0, fogFactor) * frame.params3.w;
  if (cloudW > 0.002) {
    let sunDot = max(dot(dir, frame.sunDir.xyz), 0.0);
    let cirrus = cirrusFor(dir, sunDot);
    col = mix(col, cirrus.rgb, cirrus.a * cloudW);
    let cumulus = cumulusFor(dir, sunDot);
    col = mix(col, cumulus.rgb, cumulus.a * cloudW);
  }

  return col;
}

// Local light pool (074/06 row 7): up to 64 point lights (2dfx street lamps + host dynamics — vehicle
// headlights), CPU-filled each frame. The world consumes it in the VERTEX shader (SA is vertex-lit and
// world verts ≪ pixels); small dynamic entities sample it per pixel. Bounded loop (count ≤ 64 — guardrail).
struct LocalLight {
  position: vec4f, // xyz world + radius
  color: vec4f,    // linear RGB × intensity; w spare
  // xyz = the direction a SPOT points, w = the cosine of its half-angle. w >= 1.5 means POINT (no cone) —
  // the same sentinel the three pool uses. Headlights NEED this: as a point light a headlight floods the
  // whole street, the road behind the car included.
  dir: vec4f,
};
@group(0) @binding(3) var<storage, read> localLights: array<LocalLight>;

// A RANGE of the pool, so the world can split it: static lamps per vertex (they never move, and world verts
// ≪ pixels), moving lights per pixel. A headlight shaded per vertex is a disaster — SA's road polygons are
// tens of metres wide, so the beam lands between vertices: it blotches along the mesh normals and disappears
// outright when the car sits mid-polygon.
// NB: "from" is a WGSL RESERVED KEYWORD (so is "meta", which bit the B2 vertex layout) — hence first/last.
// The naga guardrails do not catch reserved words; assertGuardrails now does, so the browser stops being
// the first thing to notice.
fn localLightRange(world: vec3f, normal: vec3f, first: u32, last: u32) -> vec3f {
  var sum = vec3f(0.0);
  let count = min(last, 64u);
  for (var index = first; index < count; index += 1u) {
    let light = localLights[index];
    var toLight = light.position.xyz - world;
    let dist = length(toLight);
    let radius = light.position.w;
    if (dist < radius) {
      toLight = toLight / max(dist, 0.001);
      let spot = light.dir.w < 1.5;
      // Cone falloff SQUARED toward the rim — a flat plateau reads as a hard-edged searchlight blob.
      var cone = 1.0;
      if (spot) {
        cone = smoothstep(light.dir.w, min(light.dir.w + 0.30, 1.0), dot(-toLight, light.dir.xyz));
        cone = cone * cone;
      }
      // WRAP: a headlight grazes the road almost tangentially, so a hard N·L collapses the beam to nothing.
      // Wrapping keeps the road pool readable while walls still take more light when they face the lamp.
      let wrap = select(0.4, 0.25, spot);
      let ndl = clamp((dot(normal, toLight) + wrap) / (1.0 + wrap), 0.0, 1.0);
      let falloff = 1.0 - dist / radius;
      sum += light.color.rgb * (ndl * cone * falloff * falloff);
    }
  }
  return sum;
}

/** Dynamic half only — the world's PER-PIXEL term. */
fn localLightDynamic(world: vec3f, normal: vec3f) -> vec3f {
  return localLightRange(world, normal, 0u, u32(frame.params4.x));
}

/** Static 2dfx half only — the world's PER-VERTEX term. */
fn localLightStatic(world: vec3f, normal: vec3f) -> vec3f {
  return localLightRange(world, normal, u32(frame.params4.x), u32(frame.params3.x));
}

// The ground half of the hemisphere: the road under a dynamic model, dark, so the sky/ground split reads as
// shape rather than as a tint. Deliberately the same 0.10 the reflection path uses for asphalt.
const AMBIENT_GROUND = 0.10;

/**
 * Hemispheric indirect weight for a DYNAMIC model (car OR ped): how much SKY this surface sees, 1.0 on a
 * horizontal panel down to AMBIENT_GROUND on one facing straight down.
 *
 * What it fixes: the indirect term was a flat vec3f(frame.params.y) — one constant on every pixel, with no
 * normal, no position and no occlusion in it. By day the sun's N.L gradient hides that; at night there IS no
 * sun, the indirect term dominates, and the body collapsed into a single flat colour with no readable edges.
 * The map never had the problem because its indirect term is prelit x params.y x ao, i.e. baked lighting AND
 * baked AO — neither of which a car or ped has (no vehicle or ped in the game ships a prelit set).
 *
 * A WEIGHT, not a colour, and normalised against the sky rather than the hemisphere mean: the term can only
 * ever DARKEN relative to the old flat fill. Normalising against the mean would conserve energy but brighten
 * upward-facing surfaces by ~1.8x — on bodies already reported as too bright at night, that would have made
 * the loudest surfaces worse.
 *
 * Deliberately scalar and per-PIXEL over a normal the shader already has; params.y was neutral before this,
 * so no colour is lost. Shared by the rigid (vehicle) and ped paths through <frame>.
 */
fn skyVisibility(normal: vec3f) -> f32 {
  return mix(AMBIENT_GROUND, 1.0, normal.y * 0.5 + 0.5);
}

/**
 * What a DYNAMIC model's indirect term is worth against the WORLD's (plan 084).
 *
 * The map's indirect is prelit x params.y x ao and a car's was params.y alone — the same lamp, but the
 * map dims it twice and the car not at all. Measured at full night that read car 0.70 against map ~0.13.
 * The missing half is the two factors a car has no data for: this constant stands in for the mean PRELIT
 * (SA's map models average 88/255 luma), and (for vehicles) the per-instance AO the builder computes.
 */
const DYNAMIC_INDIRECT = 0.35;
`,
  particle: /* wgsl */ `
#include <frame>

// 2dfx PARTICLES (074/06 row 13, B6). The FX system's keyframed tracks are BAKED by the host into a small
// per-system record; the whole lifecycle then loops in the VERTEX shader, so a hundred smoke plumes cost
// zero CPU per frame. One draw per blend mode for the entire map (the system index rides per instance).
//
// A particle's life: it is born at its emitter, is thrown by its velocity, is pulled by the system's force
// (gravity for sparks, buoyancy for smoke), and grows/fades along piecewise-linear envelopes sampled at
// age 0 / 0.5 / 1 — exactly the shape the prod path bakes out of effects.fxp.
struct ParticleSystem {
  // xyz = force (gravity/buoyancy), w = texture layer.
  force: vec4f,
  // Size envelope at age 0 / 0.5 / 1, w = draw distance.
  size: vec4f,
  color0: vec4f, // rgb at age 0, a = alpha at age 0
  color1: vec4f, // rgb at age 0.5, a = alpha at 0.5
  color2: vec4f, // rgb at age 1, a = alpha at 1
};
@group(1) @binding(0) var<storage, read> systems: array<ParticleSystem>;
@group(1) @binding(1) var fxTexture: texture_2d_array<f32>;
@group(1) @binding(2) var fxSampler: sampler;

// One-shot lane (089/01): the dynamic pipelines flip this override — the age CLAMPS instead of looping,
// and a particle past its life collapses (its CPU pool prunes it on the same clock next frame).
override oneShot: bool = false;

struct ParticleIn {
  @location(0) corner: vec2f,
  @location(1) spawn: vec3f,
  @location(2) velocity: vec3f,
  // x = lifetime seconds, y = phase offset (so a plume is a continuous stream, not a pulse), z = system.
  @location(3) params: vec3f,
};

struct ParticleOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec4f,
  @location(2) @interpolate(flat) layer: u32,
};

/** Piecewise-linear envelope through three keys at age 0 / 0.5 / 1. */
fn envelope3(k0: f32, k1: f32, k2: f32, age: f32) -> f32 {
  return select(mix(k1, k2, (age - 0.5) * 2.0), mix(k0, k1, age * 2.0), age < 0.5);
}

fn envelope3v(k0: vec3f, k1: vec3f, k2: vec3f, age: f32) -> vec3f {
  return select(mix(k1, k2, (age - 0.5) * 2.0), mix(k0, k1, age * 2.0), age < 0.5);
}

@vertex
fn vsParticle(in: ParticleIn) -> ParticleOut {
  let system = systems[u32(in.params.z)];
  let life = max(in.params.x, 0.01);
  // The phase staggers the stream: every particle of a plume is at a different point of the SAME loop.
  // One-shot instances instead carry phase = -spawnTime, so cycles is that particle's own age.
  let cycles = (frame.params2.z + in.params.y) / life;
  let age = select(fract(cycles), clamp(cycles, 0.0, 1.0), oneShot);
  let t = age * life;
  let world = in.spawn + in.velocity * t + system.force.xyz * (0.5 * t * t);
  let size = envelope3(system.size.x, system.size.y, system.size.z, age);
  let rgb = envelope3v(system.color0.rgb, system.color1.rgb, system.color2.rgb, age);
  let alpha = envelope3(system.color0.a, system.color1.a, system.color2.a, age);

  // Camera-facing quad, like the coronas. The quad spans [-1, 1], and the authored size is a DIAMETER (prod
  // projects it as a point-sprite width) — so the half-extent is size*0.5. Scaling by the full size makes
  // every particle twice as wide as authored, and a fire turns into a soft glowing cloud.
  let toEye = normalize(frame.camera.xyz - world);
  let right = normalize(cross(vec3f(0.0, 1.0, 0.0), toEye));
  let up = cross(toEye, right);
  let corner = world + (right * in.corner.x + up * in.corner.y) * (size * 0.5);

  var out: ParticleOut;
  out.clip = frame.viewProj * vec4f(corner, 1.0);
  // The unit quad spans [-1, 1], so the UV is corner*0.5 + 0.5. Using corner + 0.5 sends it to [-0.5, 1.5],
  // and the clamp-to-edge sampler then smears the sprite's border texels into a SQUARE of solid colour.
  out.uv = in.corner * 0.5 + vec2f(0.5);
  // Distance cull: collapse the quad rather than branch (a degenerate triangle costs nothing).
  let dist = length(world - frame.camera.xyz);
  let visible = f32(dist < system.size.w && size > 0.0 && !(oneShot && cycles >= 1.0));
  out.clip = select(vec4f(0.0, 0.0, -1.0, 1.0), out.clip, visible > 0.5);
  // Per-spawn opacity rides the FRACTION of the system slot (089/02): 1 - fract(z), so the baked lane's
  // integer slots read fully opaque and the instance layout stays untouched.
  let spawnAlpha = 1.0 - fract(in.params.z);
  out.color = vec4f(rgb, alpha * visible * spawnAlpha);
  out.layer = u32(system.force.w);
  return out;
}

@fragment
fn fsParticle(in: ParticleOut) -> @location(0) vec4f {
  let texel = textureSample(fxTexture, fxSampler, in.uv, in.layer);
  let a = texel.a * in.color.a;
  // PREMULTIPLIED: one pipeline blends (one, 1-src-a) for smoke, the other (one, one) for fire/sparks.
  return vec4f(texel.rgb * in.color.rgb * a, a);
}
`,

  ped: /* wgsl */ `
#include <frame>

// Skinning probe (074/08 B1): one skinned entity through the intended dynamics path — matrices in a
// STORAGE buffer (slot 0 = the model matrix carrying the GTA→engine axis change, bone palettes follow),
// 4-bone vertex blend, textured sun/indirect lighting + the shared fog. No prelit — peds are dynamically
// lit (the plan-034 night fill joins in M3).
struct PedVsIn {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) joints: vec4<u32>,
  @location(4) weights: vec4f,
};

struct PedVsOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) normal: vec3f,
  @location(2) world: vec3f,
};

@group(1) @binding(0) var<storage, read> pedMatrices: array<mat4x4f>;
@group(1) @binding(1) var pedTexture: texture_2d<f32>;
@group(1) @binding(2) var pedSampler: sampler;

@vertex
fn vsPed(in: PedVsIn) -> PedVsOut {
  let source = vec4f(in.position, 1.0);
  let skinned =
    (pedMatrices[1u + in.joints.x] * source) * in.weights.x +
    (pedMatrices[1u + in.joints.y] * source) * in.weights.y +
    (pedMatrices[1u + in.joints.z] * source) * in.weights.z +
    (pedMatrices[1u + in.joints.w] * source) * in.weights.w;
  let sourceNormal = vec4f(in.normal, 0.0);
  let skinnedNormal =
    (pedMatrices[1u + in.joints.x] * sourceNormal) * in.weights.x +
    (pedMatrices[1u + in.joints.y] * sourceNormal) * in.weights.y +
    (pedMatrices[1u + in.joints.z] * sourceNormal) * in.weights.z +
    (pedMatrices[1u + in.joints.w] * sourceNormal) * in.weights.w;
  let world = pedMatrices[0] * vec4f(skinned.xyz, 1.0);
  var out: PedVsOut;
  out.clip = frame.viewProj * world;
  out.uv = in.uv;
  out.normal = normalize((pedMatrices[0] * vec4f(skinnedNormal.xyz, 0.0)).xyz);
  out.world = world.xyz;
  return out;
}

@fragment
fn fsPed(in: PedVsOut) -> @location(0) vec4f {
  let texel = textureSample(pedTexture, pedSampler, in.uv);
  if (texel.a < 0.5) {
    discard;
  }
  let normal = normalize(in.normal);
  let sunNdl = max(dot(normal, frame.sunDir.xyz), 0.0);
  let moonNdl = clamp((dot(normal, frame.moonDir.xyz) + 0.6) / 1.6, 0.0, 1.0);
  // Hemispheric indirect, the SAME term the vehicles use (plan 084 → 087 ped): a flat vec3f(frame.params.y)
  // gave the body no readable edges at night, when the sun term is gone and indirect dominates. No per-model
  // AO for a ped (no baked set), so DYNAMIC_INDIRECT x skyVisibility is the whole weight.
  let ambient = frame.params.y * DYNAMIC_INDIRECT * skyVisibility(normal);
  // STATIC lamps only, like the vehicles: the driver sits a metre in FRONT of his own tail lights, and the
  // dynamic pool would wash him red from behind every time he brakes.
  let lit = vec3f(ambient) + frame.sunColor.rgb * (sunNdl * frame.params.z) + frame.moonColor.rgb * moonNdl +
    localLightStatic(in.world, normal);
  var color = texel.rgb * lit;
  // Same unified fog shape as fsWorld (068 invariant: distant peds dissolve into the sky behind them).
  let toCamera = in.world - frame.camera.xyz;
  let dist = length(toCamera);
  let viewDir = toCamera / max(dist, 0.001);
  let fogD = max(dist - frame.fog.y, 0.0);
  let fogK = 2.0 / max(frame.fog.x - frame.fog.y, 1.0);
  var fogFactor = 1.0 - exp(-(fogK * fogD) * (fogK * fogD));
  let heightAtten = mix(frame.fog.w, 1.0, exp(-max(in.world.y, 0.0) * frame.fog.z));
  fogFactor = fogFactor * heightAtten;
  fogFactor = max(fogFactor, smoothstep(frame.fog.x * 0.85, frame.fog.x, dist));
  color = mix(color, fogColorFor(viewDir, fogFactor), fogFactor);
  return vec4f(color, 1.0);
}
`,
  post: /* wgsl */ `
// Godrays composite (074/09 stage 1): the scene renders into a LINEAR rgba16float target (the sun disc's
// 3–6× overshoot survives), and this fullscreen pass radial-blurs the thresholded brightness toward the
// sun's screen position — occlusion is inherent (geometry in front of the sun leaves no bright pixels, so
// rays only stream through gaps: the prod GodRaysEffect look). Output goes to the sRGB swapchain view.
struct Post {
  // sun = [uv.x, uv.y, intensity (0 = off), decay per tap]; tint = [rgb godray colour, brightness threshold].
  sun: vec4f,
  tint: vec4f,
  // params = [ACES tonemap 0/1, bloom intensity (0 = off), reserved, reserved].
  params: vec4f,
};
@group(0) @binding(0) var<uniform> post: Post;
@group(0) @binding(1) var scene: texture_2d<f32>;
@group(0) @binding(2) var sceneSampler: sampler;
// Bloom chain result (half-res 16f, 074/09) — bilinear-upsampled here by the sampler.
@group(0) @binding(3) var bloomTex: texture_2d<f32>;

struct PostOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vsPost(@builtin(vertex_index) index: u32) -> PostOut {
  // One oversized triangle covers the viewport (no vertex buffer).
  var corners = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  let corner = corners[index];
  var out: PostOut;
  out.clip = vec4f(corner, 0.0, 1.0);
  out.uv = vec2f(corner.x * 0.5 + 0.5, 0.5 - corner.y * 0.5);
  return out;
}

const GODRAY_TAPS = 20u;

// ACES filmic (074/09): the EXACT curve prod is calibrated against — three's Stephen Hill fit as consumed
// by postprocessing's ToneMappingEffect (exposure 1). Matrices carry sRGB↔AP1 (columns, transposed from
// the source like three's); the /0.6 scale is three's brighter-viewing-environment adjustment (#19621).
fn rrtAndOdtFit(v: vec3f) -> vec3f {
  let a = v * (v + vec3f(0.0245786)) - vec3f(0.000090537);
  let b = v * (0.983729 * v + vec3f(0.4329510)) + vec3f(0.238081);
  return a / b;
}

fn acesFilmic(color: vec3f) -> vec3f {
  let inputMat = mat3x3f(
    vec3f(0.59719, 0.07600, 0.02840),
    vec3f(0.35458, 0.90834, 0.13383),
    vec3f(0.04823, 0.01566, 0.83777),
  );
  let outputMat = mat3x3f(
    vec3f(1.60475, -0.10208, -0.00327),
    vec3f(-0.53108, 1.10813, -0.07276),
    vec3f(-0.07367, -0.00605, 1.07602),
  );
  let mapped = outputMat * rrtAndOdtFit(inputMat * (color / 0.6));
  return clamp(mapped, vec3f(0.0), vec3f(1.0));
}

@fragment
fn fsPost(in: PostOut) -> @location(0) vec4f {
  var col = textureSampleLevel(scene, sceneSampler, in.uv, 0.0).rgb;
  if (post.sun.z > 0.0) {
    let delta = (post.sun.xy - in.uv) / f32(GODRAY_TAPS);
    var uv = in.uv;
    var weight = 1.0;
    var acc = vec3f(0.0);
    for (var tap = 0u; tap < GODRAY_TAPS; tap += 1u) {
      uv += delta;
      let sample_ = textureSampleLevel(scene, sceneSampler, uv, 0.0).rgb;
      acc += max(sample_ - vec3f(post.tint.w), vec3f(0.0)) * weight;
      weight *= post.sun.w;
    }
    col += acc * post.tint.rgb * (post.sun.z / f32(GODRAY_TAPS));
  }
  // Bloom composite (prod SCREEN blend: dst + src − min(dst·src, 1)); intensity 0 = a no-op.
  let bloomSrc = textureSampleLevel(bloomTex, sceneSampler, in.uv, 0.0).rgb * post.params.y;
  col = col + bloomSrc - min(col * bloomSrc, vec3f(1.0));
  // Tonemap LAST (prod order: godrays → bloom → ACES) — the HDR overshoot feeds the effects above,
  // ACES compresses the sum; the sRGB swapchain view encodes on write.
  if (post.params.x > 0.5) {
    col = acesFilmic(col);
  }
  return vec4f(col, 1.0);
}
`,
  /**
   * Environment-probe mip pass (074/16 step 2): a fullscreen triangle whose single BILINEAR tap at the
   * destination texel centre is an exact 2x2 box filter between power-of-two cube-face mips. Run per face
   * per level, it builds the prefiltered-roughness ladder the rigid clearcoat samples with
   * `textureSampleLevel` — the own-engine twin of prod's `generateMipmaps` cube probe.
   */
  probe: /* wgsl */ `
@group(0) @binding(0) var probeInput: texture_2d<f32>;
@group(0) @binding(1) var probeInputSampler: sampler;

struct ProbeMipOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vsProbeMip(@builtin(vertex_index) index: u32) -> ProbeMipOut {
  var corners = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  let corner = corners[index];
  var out: ProbeMipOut;
  out.clip = vec4f(corner, 0.0, 1.0);
  out.uv = vec2f(corner.x * 0.5 + 0.5, 0.5 - corner.y * 0.5);
  return out;
}

@fragment
fn fsProbeMip(in: ProbeMipOut) -> @location(0) vec4f {
  return textureSampleLevel(probeInput, probeInputSampler, in.uv, 0.0);
}

// Face blit, V-FLIPPED: cube faces are stored in the GL convention (t = 0 at the face's TOP direction),
// but a WebGPU render pass puts NDC y = +1 in row 0 — rendering straight into the face would come out
// upside-down, and fixing it in the projection would flip the triangle winding and break back-face culling
// inside the recorded bundles. The flip lives here instead: a pure-rotation camera renders the face, the
// resolve lands in a scratch target, and this pass writes it into the cube the right way up.
@fragment
fn fsProbeBlit(in: ProbeMipOut) -> @location(0) vec4f {
  return textureSampleLevel(probeInput, probeInputSampler, vec2f(in.uv.x, 1.0 - in.uv.y), 0.0);
}
`,

  'probe-view': /* wgsl */ `
#include <frame>

@group(1) @binding(0) var probeViewCube: texture_cube<f32>;
@group(1) @binding(1) var probeViewSampler: sampler;

struct ProbeViewOut {
  @builtin(position) clip: vec4f,
  @location(0) ndc: vec2f,
};

@vertex
fn vsProbeView(@builtin(vertex_index) index: u32) -> ProbeViewOut {
  var corners = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  let corner = corners[index];
  var out: ProbeViewOut;
  // Reversed-Z near plane — the debug view overdraws everything.
  out.clip = vec4f(corner, 1.0, 1.0);
  out.ndc = corner;
  return out;
}

@fragment
fn fsProbeView(in: ProbeViewOut) -> @location(0) vec4f {
  let near = frame.invViewProj * vec4f(in.ndc, 1.0, 1.0);
  let far = frame.invViewProj * vec4f(in.ndc, 0.0, 1.0);
  let dir = normalize(far.xyz / far.w - near.xyz / near.w);
  // Left half = sharp mip, right half = the roughness mip the paint samples — both must look like the world.
  let lod = select(0.0, 1.2, in.ndc.x > 0.0);
  return vec4f(textureSampleLevel(probeViewCube, probeViewSampler, dir, lod).rgb, 1.0);
}
`,
  rigid: /* wgsl */ `
#include <frame>

// Rigid-part dynamics (074/08 B2→B5): vehicle-style entities — CPU-flattened part matrices in a storage
// buffer, parts drawn with firstInstance = slot × partCount + part (instance_index reads the matrix).
// slots.x = texture-array layer, slots.y = the lamps-on twin, slots.z = the carcols PAINT slot (resolved
// per instance — B5 shares one model across differently-painted cars). fsRigid = opaque (alpha forced 1),
// fsRigidBlend = premultiplied glass on the blend pipeline.
struct RigidVsIn {
  @builtin(instance_index) instance: u32,
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) color: vec4f,
  @location(4) slots: vec4<u32>,
  // Reflection slots straight from the DFF material-effect plugins (B5r): env layer, env coefficient,
  // SA reflection intensity, SA specular level. x = 0 means the material is simply not reflective.
  @location(5) reflect: vec4<u32>,
  // The NIGHT vertex colours (opensa-pack 003 phase 5g). SA bakes the map's lighting into the prelit set
  // and ships a second, darker one for night; a map object drawn by name is the case this serves — a car
  // carries no prelit at all, so its night set is the synthesized ambient and the blend is a no-op tint.
  @location(6) night: vec4f,
};

struct RigidVsOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) normal: vec3f,
  @location(2) world: vec3f,
  @location(3) color: vec4f,
  @location(4) @interpolate(flat) layer: u32,
  @location(5) @interpolate(flat) nightLayer: u32,
  // slots.w LOW nibble: 0 = body, 1 = head lamp, 2 = tail lamp; lamps = [headlights, brakes, intensity].
  @location(6) @interpolate(flat) lampTag: u32,
  // xyz = lamp state. w = the LICENSE-PLATE layer this submesh samples (plan 082/03) — the text-atlas slot
  // on a plateFace, the city background index on a plateBack, 0 on everything else. It rides here
  // rather than in a location of its own because the struct already stands at 15 of the 16 inter-stage
  // locations, and this one was per-instance state with a spare component — the same reason local.w
  // carries sky occlusion.
  @location(7) @interpolate(flat) lamps: vec4f,
  // [env coefficient, SA reflection intensity, SA specular level] — all 0..1, all authored per material.
  // There is no env LAYER beside them: the DFF names an env texture, but this pipe reflects the live probe
  // (rigidEnv), so the name only ever acted as a flag. Location 8 is free again.
  @location(9) @interpolate(flat) reflect: vec3f,
  // MODEL-space position (xyz): the flake hash is anchored to the CAR, so the sparkle rides with it. A
  // world-space hash would make the flakes crawl across the paint as the car drives.
  // w = the model's own SKY OCCLUSION (plan 084), which rides here rather than in a location of its own:
  // the struct is at 15 of the 16 inter-stage locations, and a 16th would push the ped/vehicle pair over.
  @location(10) local: vec4f,
  // slots.w HIGH nibble (074/16 round 2): the material CLASS — 0 matte, 1 paint, 2 chrome, 3 glass.
  @location(11) @interpolate(flat) matClass: u32,
  // Light-pool response, computed per VERTEX (074/16 round 5 — the night-fps fix): the original neo car
  // pipe evaluates ALL of its lighting in the vertex shader, and a per-PIXEL pool loop on a close-up car
  // at 2× retina was the difference between 120 and 60 fps at night. Cars are 3–5 k verts — free there.
  @location(12) poolDiffuse: vec3f,
  // Pool specular (neo pass 2's point-light half), already scaled by the material's specular level.
  @location(13) poolSpec: vec3f,
  // Night EMISSIVE (opensa-pack 003 phase 5g), the rigid twin of the cell path's: a vertex much brighter at
  // night than by day IS a lit window / neon / sign, so it emits instead of merely being tinted. The cell
  // path can also read a BAKED mask; a per-model asset has no cell to carry one, so the luma-delta
  // heuristic is the whole rule here. A car cannot trip it — no prelit means night == day means delta 0.
  @location(14) glow: vec3f,
};

@group(1) @binding(0) var<storage, read> rigidMatrices: array<mat4x4f>;
@group(1) @binding(1) var rigidTexture: texture_2d_array<f32>;
@group(1) @binding(2) var rigidSampler: sampler;
// Carcols paint (074/08 B5), 4 colours per matrix ROW — indexed by instance_index exactly like the
// matrices, so one uploaded model paints a whole street of differently-coloured cars. slots.z picks:
// 0 = the material's own colour, 1..4 = primary/secondary/tertiary/quaternary.
@group(1) @binding(3) var<storage, read> rigidPaint: array<vec4f>;
// Per-instance lamp state (074/08 B5 step 5): x = headlights on, y = braking. Was a GLOBAL day/night gate,
// which lit every parked car in the city at once; only the DRIVEN car should light up.
@group(1) @binding(4) var<storage, read> rigidLamp: array<vec4f>;
// The scene environment probe (074/16 step 2): a mipped cubemap of the ACTUAL world around the player car,
// refreshed one face per frame. frame.params4.w = probe mix (0 until all six faces exist, then 1) — the
// analytic sky reflection stays the fallback for the lab and the first frames after a teleport.
@group(1) @binding(5) var probeTexture: texture_cube<f32>;
@group(1) @binding(6) var probeSampler: sampler;
// Per-instance license plate (plan 082/03), indexed by instance_index exactly like the matrices: x = the
// layer this car's generated text raster sits at in plateTexture, y = which of the three city
// backgrounds it wears. A car that was never given a plate keeps [0, 0] and its plate submeshes sample
// slot 0 of each array — the stock placeholder look, which is also what an unassigned car shows today.
@group(1) @binding(7) var<storage, read> rigidPlate: array<vec4f>;
// The generated plate TEXT rasters (64×16 each), one layer per distinct plate in the world.
@group(1) @binding(8) var plateTexture: texture_2d_array<f32>;
// The three city backgrounds (plateback1..3 = SF / LV / LS), at whatever size the game's TXD ships.
@group(1) @binding(9) var plateBackTexture: texture_2d_array<f32>;
// The UV transform for THIS draw (plan 099): uv·zw + xy, the world lane's exact term. A dynamic offset
// selects the submesh's slot out of the model's own animation list; slot 0 is (0,0,1,1), so a car — and
// every static submesh of an animated model — runs the identity and comes out bit-identical.
@group(1) @binding(10) var<uniform> rigidUvAnim: vec4f;

// MaterialClass — the high nibble of slots.w. Kept in sync with renderware/vehicle/types.ts.
const MAT_PLATE_BACK: u32 = 4u;
const MAT_PLATE_FACE: u32 = 5u;

// skyVisibility / AMBIENT_GROUND / DYNAMIC_INDIRECT are shared dynamic-model lighting helpers — they live in
// <frame> now (next to localLightStatic) so the ped path reuses the exact same indirect term (plan 087 ped).

@vertex
fn vsRigid(in: RigidVsIn) -> RigidVsOut {
  let model = rigidMatrices[in.instance];
  let world = model * vec4f(in.position, 1.0);
  var out: RigidVsOut;
  out.clip = frame.viewProj * world;
  out.uv = in.uv * rigidUvAnim.zw + rigidUvAnim.xy;
  out.normal = normalize((model * vec4f(in.normal, 0.0)).xyz);
  out.world = world.xyz;
  // Day → night on the prelit set, BEFORE the paint override: a car's night set is its day set (no prelit,
  // nothing to darken — its light comes from the world), and mixing after paint would wash the panel out
  // toward the unpainted material colour at midnight.
  var color = vec4f(mix(in.color.rgb, in.night.rgb, frame.params.x), in.color.a);
  if (in.slots.z > 0u) {
    color = vec4f(rigidPaint[in.instance * 4u + (in.slots.z - 1u)].rgb, in.color.a);
  }
  out.color = color;
  // Max-CHANNEL delta, same rule as the world paths: saturated neon reads darker than day in luma.
  let nightDeltaRgb = in.night.rgb - in.color.rgb;
  let nightDelta = max(max(nightDeltaRgb.r, nightDeltaRgb.g), nightDeltaRgb.b);
  out.glow = in.night.rgb * (smoothstep(0.05, 0.32, nightDelta) * frame.params.w * frame.params.x);
  out.layer = in.slots.x;
  out.nightLayer = in.slots.y;
  out.lampTag = in.slots.w & 0xFu;
  out.matClass = in.slots.w >> 4u;
  // The plate row is read HERE, where the instance index still exists, and only the one layer this submesh
  // needs is forwarded: its material class already says which of the two arrays that layer belongs to.
  let matClass = in.slots.w >> 4u;
  let plate = rigidPlate[in.instance];
  var plateLayer = 0.0;
  if (matClass == MAT_PLATE_FACE) {
    plateLayer = plate.x;
  } else if (matClass == MAT_PLATE_BACK) {
    plateLayer = plate.y;
  }
  // A SMASHED lamp does not light (SA CDamageManager::SetLightStatus — plan cleo/scripts 002). The status is
  // per LAMP, but a DFF authors ONE lamp material per end, so the mesh can only go dark per PAIR: both bits
  // of an end have to be set before the lit twin and the glow are withheld. The per-lamp half of the effect —
  // beam, pool light, corona — is geometric and dies one lamp at a time in vehicle-lamp.system.ts.
  let lampRow = rigidLamp[in.instance];
  let smashed = u32(lampRow.w);
  let lampOut = (out.lampTag == 1u && (smashed & 0x3u) == 0x3u) ||
                (out.lampTag == 2u && (smashed & 0xCu) == 0xCu);
  out.lamps = vec4f(select(lampRow.xyz, vec3f(0.0, 0.0, lampRow.z), lampOut), plateLayer);
  out.reflect = vec3f(in.reflect.yzw) / 255.0;
  // The night set's ALPHA is the self-occlusion the builder wrote (vehicle/sky-occlusion.ts). A fixture
  // from before it simply carries the material alpha there, which is 1 on everything opaque - no change.
  out.local = vec4f(in.position, in.night.a);
  // Light pool per VERTEX (round 5): diffuse from the STATIC half (a car is never lit by its own
  // headlights) + neo pass 2's point-light specular over the WHOLE pool (it SHOULD catch its own
  // headlights' bounce off a wall), scaled by the material's specular level here so the fragment adds it raw.
  out.poolDiffuse = localLightStatic(world.xyz, out.normal);
  var poolSpec = vec3f(0.0);
  let toEyeV = normalize(frame.camera.xyz - world.xyz);
  let poolCount = min(u32(frame.params3.x), 64u);
  for (var index = 0u; index < poolCount; index += 1u) {
    let light = localLights[index];
    let toLight = light.position.xyz - world.xyz;
    let dist = length(toLight);
    if (dist < light.position.w) {
      let halfway = normalize(toLight / max(dist, 0.001) + toEyeV);
      let falloff = 1.0 - dist / light.position.w;
      poolSpec += light.color.rgb * (pow(max(dot(out.normal, halfway), 0.0), SPEC_LAMP_POWER) * falloff * falloff);
    }
  }
  out.poolSpec = poolSpec * (out.reflect.z * frame.params4.z);
  return out;
}

// Lamp materials carry a lamps-on TWIN layer (SA's vehiclelights → vehiclelightson swap): pick it when THIS
// car's headlights are on — a per-vehicle state, not the global day/night blend.
fn rigidTexel(in: RigidVsOut) -> vec4f {
  // The plate branches below pick a DIFFERENT texture array, and a branch on a per-fragment value makes the
  // rest of this function non-uniform control flow — where implicit-derivative sampling is illegal (WGSL
  // uniformity rules). The derivatives are taken HERE, while the flow is still uniform, and every path
  // samples with them explicitly: same mip selection as before, no divergence hazard.
  let uvDdx = dpdx(in.uv);
  let uvDdy = dpdy(in.uv);
  // A license plate samples an ENGINE-owned array at a PER-INSTANCE layer instead of the model's own — the
  // whole point of the feature: one uploaded model, a different plate on every car wearing it.
  if (in.matClass == MAT_PLATE_FACE) {
    return textureSampleGrad(plateTexture, rigidSampler, in.uv, u32(in.lamps.w), uvDdx, uvDdy);
  }
  if (in.matClass == MAT_PLATE_BACK) {
    return textureSampleGrad(plateBackTexture, rigidSampler, in.uv, u32(in.lamps.w), uvDdx, uvDdy);
  }
  let lampsOn = in.lamps.x > 0.5 && in.nightLayer != 0u;
  let layer = select(in.layer, in.nightLayer, lampsOn);
  return textureSampleGrad(rigidTexture, rigidSampler, in.uv, layer, uvDdx, uvDdy);
}

// A lit lamp SELF-ILLUMINATES: shading it like painted metal leaves it a dull grey patch at night. Tails run
// dim and go bright on the brakes — the one cue that reads as a car stopping ahead of you.
fn rigidLampGlow(in: RigidVsOut) -> f32 {
  if (in.lampTag == 0u || in.lamps.x <= 0.5) {
    return 0.0;
  }
  if (in.lampTag == 2u) {
    return select(LAMP_TAIL_RUN, LAMP_TAIL_BRAKE, in.lamps.y > 0.5) * in.lamps.z;
  }
  return LAMP_HEAD_GLOW * in.lamps.z;
}

const LAMP_HEAD_GLOW = 2.4;
const LAMP_TAIL_RUN = 1.0;
const LAMP_TAIL_BRAKE = 4.0;

// Vehicle reflections (B5r). SA's env maps are BAKED DAYTIME IMAGES — a painted horizon (xvehicleenv128) for
// paint, a sunset photograph (vehicleenvmap128) for glass. Sampling them raw means a car reflects a sunset at
// midnight. So the DFF gives us the SHAPE and the SETTINGS (which texture, coefficient, intensity, specular
// level) and the LIVE SKY gives the colour: the same Preetham LUT the sky pass and the fog already share, so
// the reflection tracks the hour, the sun and the weather for free.
/**
 * AUTOMOTIVE PAINT (B5r round 2). The first two attempts read as matte, and the reasons are worth keeping:
 *
 *  1. OUR SKY IS LDR. A physically-honest Fresnel (F0 ~ 0.05) times a sky that peaks near 0.3 in linear is
 *     ~0.015 — invisible. Real paint mirrors because the real sky is TENS of times brighter than the paint's
 *     own diffuse. So the reflected environment gets a real HDR gain here; blown-out sky on a wing is not a
 *     bug, it is what a car looks like.
 *  2. NOTHING SWEPT ACROSS THE PANEL. A reflection with no dark ground and no horizon LINE has no contrast to
 *     move — it reads as a tint. The environment now has a hard horizon and a dark road under it.
 *  3. SA PANELS ARE FLAT. On a flat quad the mirror direction is CONSTANT, so a perfect mirror still paints a
 *     constant colour. AAA cars are dense and curved and carry normal maps. Our stand-in is METALLIC FLAKE:
 *     a per-pixel micro-normal, anchored in MODEL space so it rides with the car instead of crawling. It is
 *     what makes a flat SA bonnet sparkle under a street lamp — and it is what real car paint actually is.
 */
const REFLECT_HDR = 4.5; // the sky's missing dynamic range, restored where it matters
const REFLECT_GROUND = 0.10; // the road under the car: dark, so the horizon reads as a hard line
const PAINT_ROUGHNESS = 0.35; // analytic-fallback blur only (mix of the sharp and normal-direction taps)
// THE REFLECTION MODEL IS SKYGFX'S NEO CAR PIPE (074/16 round 4, user-directed — aap's neoVehiclePass1VS):
//   amount = lerp(b⁵, 1, NEO_FRESNEL) × shininess,  b = 1 − saturate(N·V)
//   colour = LERP(lit base, environment, amount)   ← replace, never add: reflections cannot glow
// plus a separate broad specular pass (neo pass 2: power 18 default, point lights at power × 2). The env
// SOURCE is where we go beyond skygfx: their static neo.txd sphere map becomes our live scene probe.
// NEO_FRESNEL 0.4 = the shipped carTweakingTable value (flat across weather/hour in the distribution).
const NEO_FRESNEL = 0.4;
// Prefiltered mips per material class: paint ≈ prod's enhanced preset (roughness 0.15 × 8 mips ≈ 1.2);
// glass and chrome reflect nearly sharp.
const PROBE_PAINT_LOD = 1.2;
const PROBE_GLASS_LOD = 0.5;
const PROBE_CHROME_LOD = 0.4;
// Glass runs the neo curve DAMPED: at the paint's strength a windscreen read as a mirror sheet and hid
// the interior (field round 5) — half strength keeps the street in the glass and the wheel visible through.
const GLASS_REFLECT = 0.5;
// Chrome floors the authored coefficient: the surveyed mods ship ~0.5 everywhere, but bare-metal trim
// should sit near-mirror (neo expresses this through per-material shininess; our class supplies the floor).
const CHROME_COEFFICIENT_FLOOR = 0.85;
const FLAKE_SCALE = 220.0;
// Field rounds 1–3: 0.22 read as dense white noise, 0.10 still frosted the bonnet at close range — the
// flakes must SUGGEST sparkle, not coat the paint. Glass gets none at all.
const FLAKE_AMOUNT = 0.05;
// neo pass 2: broad highlights (power 18 default; the weather table runs 10–70), point lights ×2.
const SPEC_POWER = 18.0;
const SPEC_LAMP_POWER = 36.0;
const SPEC_GAIN = 1.0;

/** Cheap 3D hash -> a unit-ish vector, for the flake micro-normals. */
fn flakeHash(p: vec3f) -> vec3f {
  let h = fract(sin(vec3f(dot(p, vec3f(127.1, 311.7, 74.7)), dot(p, vec3f(269.5, 183.3, 246.1)), dot(p, vec3f(113.5, 271.9, 124.6)))) * 43758.5453);
  return h * 2.0 - vec3f(1.0);
}

/**
 * Metallic flake: perturb the normal per pixel with a stable, model-space hash. Anchored to the CAR, not the
 * world — a world-space hash would make the flakes crawl across the paint as the car drives.
 */
fn flakeNormal(normal: vec3f, local: vec3f) -> vec3f {
  let cell = floor(local * FLAKE_SCALE);
  return normalize(normal + flakeHash(cell) * FLAKE_AMOUNT);
}

/**
 * The world a car reflects: the LIVE sky with its sun/moon discs AND the cloud dome above, the dark road
 * below, split by a hard horizon. The discs are the point — a gradient alone gives a dull sheen; it is the
 * bright blob and the horizon line sliding across a wing as you turn that read as polished lacquer. HDR, so
 * it also feeds the bloom/godray pass for free.
 */
fn reflectedWorld(dir: vec3f) -> vec3f {
  let sky = skyBaseFor(dir) + skyCelestialFor(dir);
  let cloud = cloudLayerFor(dir);
  let above = mix(sky, cloud.rgb, cloud.a * frame.params3.w) * REFLECT_HDR;
  // The road: the ambient sky bounced off asphalt. Dark on purpose — the CONTRAST with the sky is what makes
  // a reflection look like a reflection instead of a tint.
  let ground = skyBaseFor(vec3f(dir.x, 0.15, dir.z)) * REFLECT_GROUND;
  return mix(ground, above, smoothstep(-0.03, 0.03, dir.y));
}

/**
 * The ENVIRONMENT a car reflects (content only — the neo amount decides how much of it shows): the live
 * scene probe when it has faces, the analytic sky as the fallback (the lab without a pak, the first frames
 * after a teleport). NB every tap runs UNCONDITIONALLY: textureSample needs UNIFORM control flow and the
 * class/coefficient are per-vertex varyings — gates multiply, never branch (branching black-canvased both
 * rigid pipelines).
 */
fn rigidEnv(in: RigidVsOut, normal: vec3f, shadingNormal: vec3f, probeLod: f32) -> vec3f {
  let toEye = normalize(frame.camera.xyz - in.world);
  let mirror = reflect(-toEye, shadingNormal);
  let sharp = reflectedWorld(mirror);
  let blurred = reflectedWorld(normalize(mix(mirror, normal, 0.65)));
  let analytic = mix(sharp, blurred, PAINT_ROUGHNESS);
  let probed = textureSampleLevel(probeTexture, probeSampler, mirror, probeLod).rgb;
  return mix(analytic, probed, frame.params4.w);
}

/** neo pass 1's reflection amount: lerp(b⁵, 1, fresnel) × shininess — the LERP weight toward the env. */
fn neoReflAmount(nDotV: f32, coefficient: f32) -> f32 {
  let b = 1.0 - saturate(nDotV);
  let b2 = b * b;
  return clamp(mix(b2 * b2 * b, 1.0, NEO_FRESNEL) * coefficient * frame.params4.z, 0.0, 1.0);
}

/**
 * neo pass 2, the per-PIXEL half: broad Blinn highlights from the sun and moon only — they ride the FLAKED
 * normal, which is what sparkles. The light-pool half lives in the VERTEX shader (round 5): a per-pixel
 * pool loop on a close-up car halved the night frame rate, and the original neo evaluates its whole pass 2
 * per vertex anyway. Callers add in.poolSpec on top.
 */
fn rigidSpecular(in: RigidVsOut, normal: vec3f, level: f32) -> vec3f {
  if (level <= 0.0) {
    return vec3f(0.0);
  }
  let toEye = normalize(frame.camera.xyz - in.world);
  let sun = pow(max(dot(normal, normalize(frame.sunDir.xyz + toEye)), 0.0), SPEC_POWER);
  let moon = pow(max(dot(normal, normalize(frame.moonDir.xyz + toEye)), 0.0), SPEC_POWER);
  return (frame.sunColor.rgb * sun + frame.moonColor.rgb * moon) * (SPEC_GAIN * level);
}



fn rigidShade(in: RigidVsOut, texel: vec4f) -> vec3f {
  let normal = normalize(in.normal);
  if (debugShowNormals()) {
    return debugNormalColor(normal);
  }
  let sunNdl = max(dot(normal, frame.sunDir.xyz), 0.0);
  let moonNdl = clamp((dot(normal, frame.moonDir.xyz) + 0.6) / 1.6, 0.0, 1.0);
  let base = texel.rgb * debugPrelit(in.color.rgb);
  // A LIT lamp is a SOURCE, not a surface: it emits, and its diffuse response is irrelevant. Shading it like
  // painted metal is what "cropped" the tail lights — the lens wraps around the car's corner, so its normal
  // swings ~90° across the lens, and a nearby street lamp painted that swing straight onto the glass as a
  // hard gradient broken at the triangle edge. Prod never showed it because its lamp glass is emissive-
  // dominant (emissiveMap × 1..4), which drowns the diffuse term. Ambient keeps the unlit texel detail alive.
  let ambient = frame.params.y * DYNAMIC_INDIRECT * skyVisibility(normal) * in.local.w;
  let glow = rigidLampGlow(in);
  if (glow > 0.0) {
    return base * (ambient + glow);
  }
  // STATIC lamps only, computed per VERTEX (round 5). A car must not be lit by its OWN headlights (the
  // tail lamp sits a metre behind its own lens); prod has the same rule by construction.
  let lit = vec3f(ambient) + frame.sunColor.rgb * (sunNdl * frame.params.z) + frame.moonColor.rgb * moonNdl +
    in.poolDiffuse;
  return base * (debugLit(lit) + in.glow);
}

fn rigidFog(world: vec3f) -> f32 {
  let toCamera = world - frame.camera.xyz;
  let dist = length(toCamera);
  let fogD = max(dist - frame.fog.y, 0.0);
  let fogK = 2.0 / max(frame.fog.x - frame.fog.y, 1.0);
  var fogFactor = 1.0 - exp(-(fogK * fogD) * (fogK * fogD));
  fogFactor = fogFactor * mix(frame.fog.w, 1.0, exp(-max(world.y, 0.0) * frame.fog.z));
  return max(fogFactor, smoothstep(frame.fog.x * 0.85, frame.fog.x, dist));
}

@fragment
fn fsRigid(in: RigidVsOut) -> @location(0) vec4f {
  let fog = rigidFog(in.world);
  let viewDir = normalize(in.world - frame.camera.xyz);
  let normal = normalize(in.normal);
  // The neo car pipe, branch-free per class: PAINT = flaked normal + the paint mip; CHROME = plain normal,
  // near-sharp mip, coefficient floored toward mirror; MATTE (tyres, trim, the vlo LOD, lamps) = amount 0.
  // The LERP is the model's heart — the reflection REPLACES the paint by its amount instead of adding to
  // it, so it can never glow; specular rides on top; fog dissolves the finished surface.
  let isPaint = f32(in.matClass == 1u);
  let isChrome = f32(in.matClass == 2u);
  let shadingNormal = normalize(mix(normal, flakeNormal(normal, in.local.xyz), isPaint));
  let toEye = normalize(frame.camera.xyz - in.world);
  let coefficient = mix(in.reflect.x, max(in.reflect.x, CHROME_COEFFICIENT_FLOOR), isChrome);
  let amount = neoReflAmount(dot(shadingNormal, toEye), coefficient) * (isPaint + isChrome);
  let env = rigidEnv(in, normal, shadingNormal, mix(PROBE_PAINT_LOD, PROBE_CHROME_LOD, isChrome));
  let specular = rigidSpecular(in, shadingNormal, in.reflect.z * frame.params4.z) + in.poolSpec;
  let shaded = mix(rigidShade(in, rigidTexel(in)), env, amount) + specular;
  let color = mix(shaded, fogColorFor(viewDir, fog), fog);
  return vec4f(color, 1.0);
}

@fragment
fn fsRigidBlend(in: RigidVsOut, @builtin(front_facing) frontFacing: bool) -> @location(0) vec4f {
  // Premultiplied for the (one, 1−src-α) pipeline; fog scales the pair (068 semantics for blends).
  // The alpha is BOTH sources: glass carries it in the material colour, body decals (scratch/crack overlays)
  // carry it in the TEXEL. Taking only the material's would render a decal opaque — its transparent black
  // texels then paint a black panel over the door.
  let texel = rigidTexel(in);
  let fog = rigidFog(in.world);
  let viewDir = normalize(in.world - frame.camera.xyz);
  let normal = normalize(in.normal);
  // The reflection belongs to the OUTER surface only: glass is drawn double-sided, and adding the mirrored
  // world onto BACK faces painted warped ghosts over the view from inside the car ("dioptric glass" —
  // bench round 3). A branch-free gate; back faces keep plain tinted transparency.
  let outside = f32(frontFacing);
  let toEye = normalize(frame.camera.xyz - in.world);
  // GLASS on the neo curve: plain normal (no flakes), a near-sharp probe mip. The neo amount drives BOTH
  // the mirrored colour and the opacity swell — glass turns mirror at grazing angles, and a windscreen you
  // can see straight through from every angle looks like a hole in the car.
  let amount = neoReflAmount(dot(normal, toEye), in.reflect.x) * GLASS_REFLECT * outside;
  let alpha = clamp(texel.a * in.color.a + amount, 0.0, 1.0);
  let env = rigidEnv(in, normal, normal, PROBE_GLASS_LOD);
  let specular = (rigidSpecular(in, normal, in.reflect.z * frame.params4.z) + in.poolSpec) * outside;
  // Premultiplied compositing: the reflected env replaces the tinted glass by its amount, then fog takes
  // the finished pair (068 semantics).
  let glass = mix(rigidShade(in, texel) * alpha, env, amount) + specular;
  let color = mix(glass, fogColorFor(viewDir, fog) * alpha, fog);
  return vec4f(color, alpha);
}
`,
  skid: /* wgsl */ `
#include <frame>

// Skid-mark decals (089/03): ground ribbon quads, premultiplied over the opaque world, fading on the
// WALL clock — frame.params2.z is engine uptime in REAL seconds, so the brief's 5-second rule ignores the
// day cycle by construction. SA's particleskid is WHITE with the tread in the alpha channel; the dark
// rubber colour is applied here (the original tints it with a dark vertex colour the same way).
@group(1) @binding(0) var skidTexture: texture_2d<f32>;
@group(1) @binding(1) var skidSampler: sampler;

struct SkidIn {
  @location(0) position: vec3f,
  @location(1) uv: vec2f,
  // x = the laid alpha (slide severity x the grow-in ramp), y = birth seconds on the frame clock.
  @location(2) params: vec2f,
};

struct SkidOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) alpha: f32,
};

// MUST match SKID_LIFE_SECONDS in render/skid-marks.ts (the ring prunes on the same clock this fades on).
const SKID_LIFE = 12.0;
const RUBBER = vec3f(0.04, 0.04, 0.05);
// particleskid's alpha averages ~0.4 — authored for SA's own compositing. Unboosted, a full-severity mark
// darkens this engine's road by ~0.3 and vanishes into the asphalt; the boost keeps the tread PATTERN
// (relative alpha) while making the mark read. An eye-fit — docs/hacks/skid-mark-look-fit.md.
const TREAD_BOOST = 1.8;

@vertex
fn vsSkid(in: SkidIn) -> SkidOut {
  var out: SkidOut;
  out.clip = frame.viewProj * vec4f(in.position, 1.0);
  out.uv = in.uv;
  let fade = clamp(1.0 - (frame.params2.z - in.params.y) / SKID_LIFE, 0.0, 1.0);
  out.alpha = in.params.x * fade;
  return out;
}

@fragment
fn fsSkid(in: SkidOut) -> @location(0) vec4f {
  let texel = textureSample(skidTexture, skidSampler, in.uv);
  let a = min(1.0, texel.a * TREAD_BOOST) * in.alpha;
  return vec4f(texel.rgb * RUBBER * a, a);
}
`,
  sky: /* wgsl */ `
#include <frame>

// Fullscreen sky (074/06 row 4 v1): a big triangle at far depth; depth-test LESS-EQUAL against 1.0 keeps it
// behind everything drawn. The gradient + sun glow live in <frame> (shared with the world fog).
struct SkyOut {
  @builtin(position) clip: vec4f,
  @location(0) ndc: vec2f,
};

@vertex
fn vsSky(@builtin(vertex_index) index: u32) -> SkyOut {
  var out: SkyOut;
  let x = f32(i32(index & 1u) * 4 - 1);
  let y = f32(i32(index >> 1u) * 4 - 1);
  // Reversed-Z: the far plane is depth 0.
  out.clip = vec4f(x, y, 0.0, 1.0);
  out.ndc = vec2f(x, y);
  return out;
}

// Procedural night starfield (074/06 row 16, the prod sky.plugin port): gnomonic-projected cell hash —
// ~one star per 10 % of cells, random brightness, gentle twinkle, horizon taper. SKY PASS ONLY: fog and
// world fragments share skyFogFor and must NOT twinkle. (hash21/skyVnoise/skyFbm live in the frame
// include — the cumulus deck and the reflection fallback need them outside the sky module.)
fn starField(dir: vec3f) -> f32 {
  if (dir.y <= 0.02) {
    return 0.0;
  }
  let uv = dir.xz / dir.y * 6.0;
  let cell = floor(uv);
  let f = fract(uv);
  let present = step(0.90, hash21(cell));
  let star = vec2f(hash21(cell + 1.7), hash21(cell + 4.3));
  let d = length(f - star);
  let point = smoothstep(0.06, 0.0, d) * present;
  let bright = 0.35 + 0.65 * hash21(cell + 8.1);
  let twinkle = 0.6 + 0.4 * sin(frame.params2.z * 2.5 + hash21(cell) * 90.0);
  let taper = smoothstep(0.02, 0.35, dir.y);
  return point * bright * twinkle * taper;
}

@fragment
fn fsSky(in: SkyOut) -> @location(0) vec4f {
  let far = frame.invViewProj * vec4f(in.ndc, 1.0, 1.0);
  let dir = normalize(far.xyz / far.w - frame.camera.xyz);
  var col = skyBaseFor(dir);
  let sunDot = max(dot(dir, frame.sunDir.xyz), 0.0);
  // CIRRUS wisps (074/09 sky round 3): thin high streaks; rides the cloud-layer alpha knob so
  // graphics.clouds.opacity still governs.
  let cirrus = cirrusFor(dir, sunDot);
  col = mix(col, cirrus.rgb, cirrus.a * frame.params3.w);
  // CUMULUS deck (sky v2): the procedural weather clouds (the painted panorama is REMOVED). Dense masses
  // occlude the sun/moon discs and stars exactly like the old deck alpha did.
  let cumulus = cumulusFor(dir, sunDot);
  col = mix(col, cumulus.rgb, cumulus.a * frame.params3.w);
  let occl = cumulus.a * clamp(frame.params3.w * 1.6, 0.0, 1.0);
  // Sun/moon discs and stars sit BEHIND the cloud layer: squared falloff kills the disc overshoot under
  // thick cover while thin wisps still let a dimmed disc through (prod's uCloudClear analogue).
  let clear = (1.0 - occl) * (1.0 - occl);
  col += skyCelestialFor(dir) * clear;
  // Stars fade GLOBALLY with the weather's cloud cover (prod uCloudClear; sunCorona.w) — per-pixel
  // occlusion alone let stars leak through gaps in the deck.
  let cloudClear = 1.0 - clamp(frame.sunCorona.w * 1.15, 0.0, 1.0);
  col += vec3f(starField(dir)) * frame.params.x * clear * cloudClear;
  return vec4f(col, 1.0);
}
`,
  water: /* wgsl */ `
#include <frame>

// Water v1 (074/06 row 12; plan 069's look, RUNTIME-ONLY — no converter bake): flat water.dat quads +
// the ocean frame, Gerstner SLOPES only (prod's approach — the quads are far too coarse to displace),
// fresnel between the timecyc deep tint and the shared sky dome, sun glint off the wave normal, and the
// 068 fog — the sea dissolves into the horizon exactly like land does.
// group(1): the authored textures (particle.txd, runtime-parsed by the host): waterclear256 = the
// close-up ripple (real detail where the analytic trains are too smooth), waterwake = the shore foam.
@group(1) @binding(0) var waterRipple: texture_2d<f32>;
@group(1) @binding(1) var waterSampler: sampler;
@group(1) @binding(2) var waterFoam: texture_2d<f32>;

struct WaterOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) shore: f32,
  @location(2) swell: f32,
  // Water class (plan 075): 0 = sea (full dynamics), 1 = inland (calm — no swell/surf/swash/foam so a pool
  // doesn't spill its waves past its edges).
  @location(3) @interpolate(flat) inland: f32,
};

// The two LONGEST trains DISPLACE the tessellated grid (074/06 row 12 v2 — the baked ~16 u mesh finally
// moves); the short trains stay slope-only in the fragment normal. Damped to a calm sheet at the beach
// by the baked shore field.
fn swellHeight(p: vec2f, t: f32) -> f32 {
  let wind = vec2f(0.825, 0.565);
  let side = vec2f(-wind.y, wind.x);
  let d1 = normalize(wind * 0.8 + side * 0.6);
  return sin(dot(p, wind) * 0.045 + t * 0.9) * 1.0 + sin(dot(p, d1) * 0.083 + t * 1.2) * 0.62;
}

// The BREAKING wave (074/06 row 12 v3): a front running toward the beach along the DEPTH field
// (phase = depth·k − t·speed → crests follow depth contours, parallel to the visual waterline — the
// reference look), peaked in the surf band (0.3–4 m) and dying right at the waterline.
fn surfPhase(depth: f32, t: f32) -> f32 {
  // +t: the constant-phase contour moves toward depth 0 — the front runs AT the beach (field round 5:
  // −t read as waves leaving the shore).
  return sin(depth * 1.4 + t * 1.6);
}

@vertex
fn vsWater(@location(0) position: vec3f, @location(1) depth: f32, @location(2) waterClass: f32) -> WaterOut {
  var out: WaterOut;
  let inland = waterClass > 0.5;
  let damp = smoothstep(1.0, 9.0, depth);
  let swell = swellHeight(vec2f(position.x, position.z), frame.params2.z) * damp;
  // The lower gate keeps the WAVE trains out of the swash zone (field round 7: short-wavelength
  // displacement tore a jagged waterline) — but the SURGE below is smooth and constant there, so it
  // moves the waterline cleanly.
  let surf = surfPhase(depth, frame.params2.z) *
    (1.0 - smoothstep(1.8, 6.0, depth)) * smoothstep(0.5, 1.5, depth);
  // Swash SURGE (round 12 — "move the ocean itself back and forth"): a flat plane's edge only moves via
  // HEIGHT, so the whole shore zone breathes ±0.25 m on the foam clock. The waterline physically runs
  // metres up the sand exactly when the foam front lands (same runup), then pulls back out. The water
  // quads extend under the beach with baked depth 0 there — the revealed strip arrives pre-foamed and
  // near-transparent: the swash sheet on the sand for free.
  let surgeRunup = 0.5 + 0.5 * sin(frame.params2.z * 0.85);
  let surge = (surgeRunup - 0.5) * 0.5 * (1.0 - smoothstep(0.5, 3.0, depth));
  var displaced = position;
  // INLAND water gets NO vertical displacement — a still pool must not heave its surface over the rim.
  displaced.y += select(swell * 0.32 + surf * 0.45 + surge, 0.0, inland);
  out.clip = frame.viewProj * vec4f(displaced, 1.0);
  out.world = displaced;
  out.shore = depth;
  out.swell = select(swell, 0.0, inland);
  out.inland = select(0.0, 1.0, inland);
  return out;
}

// Four analytic wave trains (the prod waterNormal port, slopes only) + the same distance-LOD fade:
// a high-frequency train aliases into moiré bands once a pixel spans many wavelengths.
// Field round 1 fixes: a large-scale DOMAIN WARP breaks the fixed-frequency interference grid (the water
// read as tiled rows), gentler slope amplitude kills the bright "pillow" bands, and the LOD fade range is
// wider so train transitions smear instead of banding by camera distance.
fn waveGradient(p0: vec2f, t: f32, viewDist: f32) -> vec2f {
  let p = p0 + vec2f(sin(p0.y * 0.013 + t * 0.26), sin(p0.x * 0.011 - t * 0.21)) * 9.0;
  let wind = vec2f(0.825, 0.565); // fixed wind heading in v1 (prod exposes uWindAngle — config later)
  let side = vec2f(-wind.y, wind.x);
  var dirs = array<vec2f, 4>(
    wind,
    normalize(wind * 0.8 + side * 0.6),
    normalize(wind * 0.9 - side * 0.5),
    normalize(wind * 0.4 + side * 1.0),
  );
  var freqs = array<f32, 4>(0.045, 0.083, 0.150, 0.260);
  var speeds = array<f32, 4>(0.9, 1.2, 1.6, 2.1);
  var weights = array<f32, 4>(1.0, 0.62, 0.38, 0.22);
  var grad = vec2f(0.0);
  for (var i = 0u; i < 4u; i += 1u) {
    let wavelength = 6.2831853 / freqs[i];
    let fade = smoothstep(wavelength * 90.0, wavelength * 10.0, viewDist);
    let phase = dot(p, dirs[i]) * freqs[i] + t * speeds[i];
    // The two LONG (displaced) trains barely tilt the LIGHTING normal (0.3×): their slopes reflected the
    // bright horizon sky as wide colour bands mid-distance (field round 3); their job is the silhouette.
    let slopeWeight = select(3.5, 1.0, i < 2u);
    grad += dirs[i] * cos(phase) * freqs[i] * weights[i] * slopeWeight * fade;
  }
  // Slow cross-swell keeps the far water alive when the trains have LOD-faded out.
  grad += vec2f(0.011) * cos((p.x + p.y) * 0.022 + t * 0.9);
  return grad;
}

// INLAND liveliness (plan 075): a still pool must not be a dead mirror. Two gentle criss-crossing ripple
// trains + a lazy large-scale drift perturb the LIGHTING NORMAL only (no height displacement → no spillover),
// so the reflection and the sun glint shimmer and slide across the surface. Amplitudes are small on purpose.
fn calmRipple(p: vec2f, t: f32) -> vec2f {
  let a = normalize(vec2f(0.7, 0.3));
  let b = normalize(vec2f(-0.35, 0.6));
  var g = vec2f(0.0);
  g += a * cos(dot(p, a) * 0.55 + t * 1.1) * 0.020;
  g += b * cos(dot(p, b) * 0.90 - t * 0.9) * 0.014;
  // A slow, wide drift of the normal — the lazy "breathing" of a calm sheet.
  g += vec2f(cos(p.x * 0.13 + t * 0.5), sin(p.y * 0.11 - t * 0.4)) * 0.010;
  return g;
}

@fragment
fn fsWater(in: WaterOut) -> @location(0) vec4f {
  let toEye = frame.camera.xyz - in.world;
  let dist = length(toEye);
  let view = toEye / max(dist, 1e-4);
  let inland = in.inland > 0.5;
  // The wave field lives on the horizontal plane: GTA xy == engine xz.
  let p = vec2f(in.world.x, in.world.z);
  let t = frame.params2.z;
  // INLAND (plan 075): swap the OCEAN wave trains for a gentle calm-ripple (normal-only, no displacement) so
  // a pool shimmers and moves its reflection without heaving its surface. SEA keeps the full train gradient.
  var grad = select(waveGradient(p, t, dist), calmRipple(p, t), inland);
  // Close-up detail from the authored waterclear256 ripple (prod's term): two scrolled taps read as a
  // slope — always on, so the surface shimmers even in a dead calm. Sampled UNCONDITIONALLY (implicit-LOD
  // textureSample is illegal in non-uniform control flow) and weighted by the near fade.
  let near = smoothstep(200.0, 20.0, dist);
  let duv = p * 0.09;
  let flow = vec2f(0.825, 0.565) * t * 0.022; // field fix: 0.004 read as frozen
  let e = 0.06;
  let h0 = textureSample(waterRipple, waterSampler, duv + flow).r +
    textureSample(waterRipple, waterSampler, duv * 1.7 - flow * 1.3).r;
  let hx = textureSample(waterRipple, waterSampler, duv + vec2f(e, 0.0) + flow).r +
    textureSample(waterRipple, waterSampler, (duv + vec2f(e, 0.0)) * 1.7 - flow * 1.3).r;
  let hy = textureSample(waterRipple, waterSampler, duv + vec2f(0.0, e) + flow).r +
    textureSample(waterRipple, waterSampler, (duv + vec2f(0.0, e)) * 1.7 - flow * 1.3).r;
  grad += vec2f(hx - h0, hy - h0) * (1.1 * near) * select(1.0, 0.6, inland);
  // Far-field FLATTEN (field round 2 — swell faces mirrored the bright fog horizon as huge white bands):
  // distant water reads as a calm mirror; the swell survives in the silhouette via the displacement.
  var normal = normalize(vec3f(-grad.x, 1.0, -grad.y));
  normal = normalize(mix(normal, vec3f(0.0, 1.0, 0.0), smoothstep(120.0, 500.0, dist)));
  let fresnel = pow(1.0 - clamp(dot(normal, view), 0.0, 1.0), 5.0);
  var refl = reflect(-view, normal);
  refl.y = abs(refl.y); // the sky dome has no below-horizon content
  let sky = skyBaseFor(refl);
  var color = mix(frame.waterColor.rgb, sky, 0.2 + 0.55 * fresnel);
  // Sun glint: TIGHT Blinn toward the sun, whitened (field round 1: raw sunCorona painted pink patches;
  // a real glitter path is near-white with only a warm cast) and modulated by the fine ripple so it
  // sparkles instead of pooling on the smooth train slopes.
  let h = normalize(view + frame.sunDir.xyz);
  let glint = pow(max(dot(normal, h), 0.0), 650.0);
  color += mix(frame.sunCorona.rgb, vec3f(1.0), 0.55) * glint * (0.25 + 0.45 * near);
  var alpha = clamp(frame.waterColor.a + fresnel * 0.25, 0.0, 1.0);
  // Shore water (074/06 row 12 v3, the baked DEPTH field): shallow = brighter and MUCH more
  // transparent (the sand reads through the last metre — the wet-swash look of the reference).
  let shallow = 1.0 - smoothstep(0.0, 4.0, in.shore);
  color = mix(color, color * 1.2 + vec3f(0.01, 0.03, 0.03), shallow * 0.35);
  alpha *= mix(1.0, 0.4, shallow * shallow);
  // waterwake is a WHITE sprite with the shape in ALPHA (field: .r alone painted solid white bands) —
  // shape = a·r. Foam lives in TWO places (the reference look): the WASH at the waterline (depth < 0.8 m,
  // pulsing with the surf runup) and the BREAKING LINE offshore — the crest of the incoming front in the
  // 0.8–3.5 m band, a bright irregular stripe travelling shoreward.
  // Foam, round 8 — TWO synchronized actors on one clock (t·1.6):
  //  · the INCOMING crest carries foam from 3.5 m down to the landing depth (~0.9 m), continuous;
  //  · the SWASH SHEET: its leading edge PHYSICALLY oscillates between 1.4 m and 0.1 m of depth,
  //    delayed to pick up where the crest lands — foam visibly runs up the beach AND pulls back out
  //    (the field ask), dimming on the retreat.
  // Shape mixes waterwake with the waterclear ripple for organic, non-repeating edges.
  let foamUv = p * 0.15 + flow * 6.0;
  let tapA = textureSample(waterFoam, waterSampler, foamUv);
  let tapB = textureSample(waterFoam, waterSampler, foamUv * 0.57 + vec2f(0.37));
  let foamNoise = textureSample(waterRipple, waterSampler, p * 0.045 - flow * 2.0).r;
  let foamShape = clamp(max(tapA.a * tapA.r, tapB.a * tapB.r) * (0.55 + 0.75 * foamNoise), 0.0, 1.0);
  // ONE foam front, round 10 (the field kept seeing TWO events — a crest dying mid-way and a separate
  // shore sheet). A single wave: its FRONT POSITION travels the whole 3 m → 0.08 m and back on one slow
  // clock; the foam mass trails ~1.5–3 m of depth behind the front. Envelopes per the user's spec:
  //  · intensity fades IN as the front leaves deep water (soft birth) and dims on the retreat;
  //  · hardness peaks exactly when the front reaches the edge, melts back to milky as it withdraws.
  // Round 11: BOTH envelopes ride the front POSITION only — no phase-direction terms. The old advancing
  // dimmer killed the foam exactly at the turning point ("reaches the edge and dies"); now brightness
  // stays FULL at the edge and through the retreat, dissolving only once the front is back out deep,
  // and hardness decays purely with distance from the edge (hard at the sand, melting on the way out).
  let cycle = t * 0.85;
  let runup = 0.5 + 0.5 * sin(cycle);
  let front = mix(3.0, 0.08, runup);
  let mass = smoothstep(front - 0.2, front + 0.15, in.shore) *
    (1.0 - smoothstep(front + 1.5, front + 3.2, in.shore));
  let intensity = smoothstep(0.02, 0.3, runup);
  let rim = (1.0 - smoothstep(0.05, 0.3, in.shore)) * 0.35;
  let crest = smoothstep(1.15, 1.55, in.swell) * 0.12;
  let soft = clamp(foamShape * (mass * intensity + rim) * 1.5 + foamShape * crest, 0.0, 1.0);
  let hard = smoothstep(0.35, 0.6, soft);
  let hardness = smoothstep(0.45, 0.97, runup);
  // INLAND water carries NO foam (no surf, no swash) — the whole breaking-wave chain is a SEA effect.
  let foam = mix(soft * 0.85, max(soft, hard), hardness) * select(1.0, 0.0, inland);
  color = mix(color, vec3f(0.95, 0.97, 0.97), foam);
  alpha = max(alpha, foam * 0.95);
  // Unified fog (the 068 shape — identical math to the world shaders).
  let fogD = max(dist - frame.fog.y, 0.0);
  let fogK = 2.0 / max(frame.fog.x - frame.fog.y, 1.0);
  var fogFactor = 1.0 - exp(-(fogK * fogD) * (fogK * fogD));
  fogFactor = fogFactor * mix(frame.fog.w, 1.0, exp(-max(in.world.y, 0.0) * frame.fog.z));
  fogFactor = max(fogFactor, smoothstep(frame.fog.x * 0.85, frame.fog.x, dist));
  color = mix(color, fogColorFor(-view, fogFactor), fogFactor);
  // Fully fogged water must MATCH the sky behind it — fade the surface out with the fog so the horizon
  // line dissolves instead of drawing a hard sea edge (the ocean-horizon regression view).
  alpha = mix(alpha, 1.0, fogFactor);
  return vec4f(color * alpha, alpha);
}
`,
  world: /* wgsl */ `
#include <frame>

// origin.w = per-cell channel flag bits: bit 0 = baked sunVis (normal.w meaningful), bit 1 = baked
// emissive mask (high channels byte meaningful). Zero = neither (old paks render unchanged).
// uvAnim (B7·c / plan 074/18) = the UV-scroll transform applied to every vertex: uv·uvAnim.zw + uvAnim.xy.
// IDENTITY (0,0,1,1) for ordinary cells (a uniform-gated no-op); a kind-4 objectTable draw binds a per-object
// cell buffer whose uvAnim the host advances each frame (the LV skull sign's crawling neon).
struct Cell {
  origin: vec4f,
  uvAnim: vec4f,
};
@group(1) @binding(0) var<uniform> cell: Cell;

@group(2) @binding(0) var worldTexture: texture_2d_array<f32>;
@group(2) @binding(1) var worldSampler: sampler;

struct VsIn {
  @location(0) position: vec3f,
  @location(1) uv: vec2f,
  @location(2) dayPrelit: vec4f,
  @location(3) layerChannels: vec2u,
  @location(4) normal: vec4f,
  @location(5) nightPrelit: vec4f,
};

struct VsOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) prelit: vec3f,
  @location(2) @interpolate(flat) layer: u32,
  @location(3) sunNdl: f32,
  @location(4) world: vec3f,
  @location(5) glow: vec3f,
  @location(6) ao: f32,
  @location(7) cone: f32,
  @location(8) moonNdl: f32,
  @location(9) localLight: vec3f,
  // World-space normal — the world is vertex-lit (sunNdl/moonNdl are precomputed), but a MOVING light must
  // be shaded per pixel, and that needs the normal here.
  @location(10) normal: vec3f,
};

@vertex
fn vsWorld(in: VsIn) -> VsOut {
  var out: VsOut;
  var world = in.position + cell.origin.xyz;
  // Wind sway (074/06 row 10, the plan-039 model baked offline): nightPrelit.a = amplitude in METRES
  // (0 for everything rigid — the displacement is a data-driven no-op there). Phase rides world-space
  // position with LOW frequency so one canopy moves nearly as a unit but a row of palms doesn't lockstep.
  let sway = in.nightPrelit.a * frame.params2.w;
  let swayT = frame.params2.z * 1.2 + world.x * 0.05 + world.z * 0.04;
  world.x += sin(swayT) * sway;
  world.z += cos(swayT * 0.7) * sway * 0.6;
  out.clip = frame.viewProj * vec4f(world, 1.0);
  out.world = world;
  // UV-scroll (B7·c): identity for ordinary geometry; a kind-4 draw's per-object cell buffer carries the
  // animated transform. Applied here so it composes with the far-outside-[0,1] GTA UVs the world tiles.
  out.uv = in.uv * cell.uvAnim.zw + cell.uvAnim.xy;
  // Day↔night prelit blend (074/06 row 1): cells without an authored night set carry a converter-synthesized
  // night (day × ambient) — one formula for the whole world, per vertex.
  out.prelit = mix(in.dayPrelit.rgb, in.nightPrelit.rgb, frame.params.x);
  // Night emissives (074/06 rows 8-9, the 071 model): a vertex much brighter at night than by day IS a lit
  // window / neon / sign — it GLOWS instead of being merely tinted. The BAKED mask (07, high channels byte)
  // replaces the runtime heuristic when the cell carries it; dn fades either in. Max-CHANNEL delta, not
  // luma: neon night sets are saturated (the LV strip's red rope light reads DARKER than day in luma).
  let cellFlags = u32(cell.origin.w + 0.5);
  let deltaRgb = in.nightPrelit.rgb - in.dayPrelit.rgb;
  let heuristic = smoothstep(0.05, 0.32, max(max(deltaRgb.r, deltaRgb.g), deltaRgb.b));
  let baked = f32(in.layerChannels.y >> 8u) / 255.0;
  let emissive = mix(heuristic, baked, f32((cellFlags >> 1u) & 1u));
  out.glow = in.nightPrelit.rgb * (emissive * frame.params.w * frame.params.x);
  out.layer = in.layerChannels.x;
  // Sun N·L per vertex (074/06 row 3) — GTA geometry is low-poly; per-vertex matches the shipped look.
  // Baked sun visibility (074/07, 066/03 v1 scalar): normal.w = arc-averaged sun occlusion — the STATIC
  // shadow term (under bridges / canyons the direct sun dies), smooth by construction, no shadow map.
  // Sun-vis SCALAR (074/07 v1, the accepted look): normal.w = arc-averaged sun visibility — soft static
  // occlusion (dark under bridges/canyons), does NOT track the moving sun. The directional v2 is PARKED
  // until the converter can subdivide large receiver polys (see plan 07).
  let sunGate = f32(cellFlags & 1u) * frame.params2.y;
  let sunVis = mix(1.0, clamp(in.normal.w, 0.0, 1.0), sunGate);
  let worldNormal = normalize(in.normal.xyz);
  out.sunNdl = max(dot(worldNormal, frame.sunDir.xyz), 0.0) * sunVis;
  // Moon N·L, WRAPPED (074/06 row 6): the same static occlusion gates moonlight. Prod's moon sits at a
  // FIXED 5° elevation (sin ≈ 0.087) while our disc arcs to the zenith — unnormalized, the wrapped term
  // makes deep night ~1.7× hotter on up-facing ground than prod (field: "night too bright"). The last
  // factor pins the UP-FACING response to prod's geometry; the direction still sweeps with the disc.
  out.moonNdl = clamp((dot(worldNormal, frame.moonDir.xyz) + 0.6) / 1.6, 0.0, 1.0) * sunVis *
    (0.687 / (max(frame.moonDir.y, 0.0) + 0.6));
  // Baked AO/skyVis (074/07): low byte of channels; 0 means UNBAKED (old paks) → fully open, not black.
  let aoByte = in.layerChannels.y & 0xffu;
  let aoVis = select(f32(aoByte) / 255.0, 1.0, aoByte == 0u);
  out.ao = mix(1.0, aoVis, frame.params2.x);
  // Beam cone alpha (074/06 row 11): dayPrelit.a — 1 everywhere except floodlight-cone geometry.
  out.cone = in.dayPrelit.a;
  // Local light pool (074/06 row 7): VERTEX-lit like everything else in SA.
  out.localLight = localLightStatic(world, worldNormal);
  out.normal = worldNormal;
  return out;
}

// Stochastic de-tiling (074/12, the skygfx 3-tap tiling-and-blend): UVs skew into a triangular grid, each
// grid vertex hashes to a random UV offset, 3 taps blend by barycentric weights — macro-repetition dies,
// micro-detail stays. Explicit grads are mandatory twice over: the offsets are DISCONTINUOUS at grid seams
// (implicit gradients pick garbage mips there), and this runs in a non-uniform branch.
fn hash2D2D(s: vec2f) -> vec2f {
  return fract(sin(vec2f(dot(s, vec2f(127.1, 311.7)), dot(s, vec2f(269.5, 183.3))) % 3.14159) * 43758.5453);
}

fn stochasticTexel(uv: vec2f, layer: u32, uvDx: vec2f, uvDy: vec2f) -> vec4f {
  let skew = mat2x2f(vec2f(1.0, -0.57735027), vec2f(0.0, 1.15470054)) * (uv * 3.464);
  let vxID = floor(skew);
  let fracts = fract(skew);
  let bz = 1.0 - fracts.x - fracts.y;
  var v0 = vxID + vec2f(1.0, 1.0);
  var v1 = vxID + vec2f(1.0, 0.0);
  var v2 = vxID + vec2f(0.0, 1.0);
  var w = vec3f(-bz, 1.0 - fracts.y, 1.0 - fracts.x);
  if (bz > 0.0) {
    v0 = vxID;
    v1 = vxID + vec2f(0.0, 1.0);
    v2 = vxID + vec2f(1.0, 0.0);
    w = vec3f(bz, fracts.y, fracts.x);
  }
  return textureSampleGrad(worldTexture, worldSampler, uv + hash2D2D(v0), layer, uvDx, uvDy) * w.x +
    textureSampleGrad(worldTexture, worldSampler, uv + hash2D2D(v1), layer, uvDx, uvDy) * w.y +
    textureSampleGrad(worldTexture, worldSampler, uv + hash2D2D(v2), layer, uvDx, uvDy) * w.z;
}

fn worldShade(in: VsOut, cutout: bool) -> vec4f {
  // Textures ship PREMULTIPLIED (074/02): filtering is correct by construction, transparent texels
  // contribute nothing — the alpha-edge fix. Alpha feeds coverage on the cutout pipeline (A2C).
  // Layer bit 15 = stochastic flag (074/12); grads + the plain tap stay in UNIFORM control flow.
  let layer = in.layer & 0xffu;
  let uvDx = dpdx(in.uv);
  let uvDy = dpdy(in.uv);
  var texel = textureSample(worldTexture, worldSampler, in.uv, layer);
  if ((in.layer & 0x8000u) != 0u && frame.moonDir.w > 0.5) {
    texel = stochasticTexel(in.uv, layer, uvDx, uvDy);
  }
  if (cutout) {
    // Needle-fine foliage minifies to FRACTIONAL sampled alpha across the whole crown (each pixel covers
    // many leaf/gap texels) — raw A2C turns that into a uniform screen-door stipple. Sharpen the SAMPLED
    // alpha toward the vanilla alpha-test look (fwidth keeps real silhouettes antialiased) and
    // un-premultiply the colour so boosted coverage does not render the ×alpha-darkened RGB.
    let sharpened = clamp((texel.a - 0.5) / max(fwidth(texel.a), 0.0001) + 0.5, 0.0, 1.0);
    texel = vec4f(texel.rgb / max(texel.a, 0.05), sharpened);
  }
  // Hybrid lighting (074/06 row 3, the shipped 064 model): prelit is the INDIRECT term, the sun adds a real
  // direct term on the raw albedo. indirect/direct ride frame params — day arcs are a CPU concern.
  // Baked AO modulates ONLY the indirect term (074/07) — sun shadowing is the separate sunVis bake.
  // frame.ambient (plan 093) is SA's own additive ambient floor on top of prelit (ps2BuildingVS
  // Color.rgb += ambient*surfAmb) — normal-independent; vanilla authors shadow prelit as pure
  // black TRUSTING this term, so without it those verts render as holes. AO occludes it like the
  // rest of the indirect light.
  let lit = (debugPrelit(in.prelit) * frame.params.y + frame.ambient.rgb) * in.ao +
    frame.sunColor.rgb * (in.sunNdl * frame.params.z) +
    frame.moonColor.rgb * in.moonNdl +
    in.localLight +
    localLightDynamic(in.world, normalize(in.normal));
  if (debugShowNormals()) {
    return vec4f(debugNormalColor(in.normal), texel.a); // before fog — a fogged normal shows nothing
  }
  var color = texel.rgb * (debugLit(lit) + in.glow);
  // Unified fog (074/06 row 5, the 068 shape): RADIAL distance (view-Z pops at screen edges), exp² over
  // [start, cut], height attenuation (haze hugs the ground), hard horizon cut — and the fog colour is the
  // SKY at this direction, so distant geometry dissolves into exactly what's behind it.
  let toCamera = in.world - frame.camera.xyz;
  let dist = length(toCamera);
  let viewDir = toCamera / max(dist, 0.001);
  let fogD = max(dist - frame.fog.y, 0.0);
  let fogK = 2.0 / max(frame.fog.x - frame.fog.y, 1.0);
  var fogFactor = 1.0 - exp(-(fogK * fogD) * (fogK * fogD));
  let heightAtten = mix(frame.fog.w, 1.0, exp(-max(in.world.y, 0.0) * frame.fog.z));
  fogFactor = fogFactor * heightAtten;
  fogFactor = max(fogFactor, smoothstep(frame.fog.x * 0.85, frame.fog.x, dist));
  // Sky term scaled by texel.a: colour is PREMULTIPLIED, so the blend pipelines (074/06 rows 9/11) stay
  // premult-correct in fog; opaque (a ≈ 1) is unchanged. CUTOUT must NOT scale it (074/21 P2 field fix):
  // A2C coverage already owns the alpha shape, and ×a double-counts it on edge/minified pixels — fully
  // fogged trees left ghost OUTLINES against the sky where the body correctly dissolved.
  let fogAlpha = select(texel.a, 1.0, cutout);
  color = mix(color, fogColorFor(viewDir, fogFactor) * fogAlpha, fogFactor);
  return vec4f(color, texel.a);
}

@fragment
fn fsWorld(in: VsOut) -> @location(0) vec4f {
  return worldShade(in, false);
}

@fragment
fn fsWorldCutout(in: VsOut) -> @location(0) vec4f {
  return worldShade(in, true);
}

@fragment
fn fsBeam(in: VsOut) -> @location(0) vec4f {
  // Floodlight cones (074/06 row 11, plan 032): 'white'-textured geometry whose soft cone lives in the
  // per-vertex prelit ALPHA. Output is PREMULTIPLIED for the (one, one-minus-src-alpha) blend pipeline.
  // No sun/glow terms — a beam is self-lit, tinted only by the dn-mixed prelit colour.
  let texel = textureSample(worldTexture, worldSampler, in.uv, in.layer & 0xffu);
  let alpha = texel.a * in.cone;
  let color = texel.rgb * in.prelit * in.cone;
  // Fog FADES a beam out (scales the premultiplied pair) — mixing toward the sky would tint thin air.
  let dist = length(in.world - frame.camera.xyz);
  let fogD = max(dist - frame.fog.y, 0.0);
  let fogK = 2.0 / max(frame.fog.x - frame.fog.y, 1.0);
  let fade = exp(-(fogK * fogD) * (fogK * fogD)) * (1.0 - smoothstep(frame.fog.x * 0.85, frame.fog.x, dist));
  return vec4f(color * fade, alpha * fade);
}
`,
};

/** The naga/Metal guardrails as an assertion (unit-tested; runs on every resolve in dev). */
/**
 * WGSL reserved words that read like perfectly ordinary identifiers — the ones a shader author actually
 * reaches for. (The full spec list is long and mostly implausible; these are the traps.)
 */
const WGSL_RESERVED = new Set([
  'as',
  'do',
  'enum',
  'filter',
  'from',
  'get',
  'inline',
  'layout',
  'match',
  'meta',
  'mod',
  'module',
  'move',
  'new',
  'null',
  'of',
  'pass',
  'precise',
  'ref',
  'require',
  'resource',
  'self',
  'set',
  'shared',
  'static',
  'std',
  'target',
  'template',
  'this',
  'type',
  'typedef',
  'union',
  'unless',
  'use',
  'using',
  'where',
]);

export function assertGuardrails(name: string, wgsl: string): void {
  // A BACKTICK inside WGSL terminates the TypeScript template literal this store is written in — the file
  // stops parsing and the error lands nowhere near the shader. It has cost this project four separate
  // debugging detours; the store itself must reject it.
  if (wgsl.includes('`')) {
    throw new Error(`<${name}>: backtick in WGSL — it closes the TS template literal (use plain quotes)`);
  }
  // Dynamically-indexed uniform-space ARRAYS in fragment code collapsed occupancy on Metal (073: ~250 ms).
  // Uniform structs are fine; `var<uniform>` holding an array type is the banned shape.
  if (/var<uniform>[^;]*:\s*array</.test(wgsl)) {
    throw new Error(`<${name}>: uniform-space array detected — use a texture or storage buffer (073 guardrail)`);
  }
  if (/\bloop\s*\{/.test(wgsl) && !/break/.test(wgsl)) {
    throw new Error(`<${name}>: unbounded loop detected (073 guardrail)`);
  }
  // WGSL RESERVED WORDS used as identifiers. Twice now the browser compiler has been the first thing to
  // catch one — `meta` (the B2 vertex attribute) and `from` (a light-pool parameter) — because naga's
  // guardrails don't look for them and neither did we. A declared name is enough to check: WGSL reserves
  // these outright, so `let`/`var`/parameter/attribute uses all trip the same error.
  const declared = [
    ...wgsl.matchAll(
      /(?:let|var|const)\s+([A-Za-z_]\w*)|(\w+)\s*:\s*(?:vec|mat|f32|u32|i32|bool|array|texture|sampler|ptr)/g,
    ),
  ];
  for (const match of declared) {
    const identifier = match[1] ?? match[2];
    if (identifier && WGSL_RESERVED.has(identifier)) {
      throw new Error(`<${name}>: '${identifier}' is a WGSL RESERVED WORD — rename it (the browser is not our linter)`);
    }
  }
}

/** Resolve one module's full WGSL (includes expanded once, cycles rejected). */
export function resolveShader(name: string): string {
  const seen = new Set<string>();
  const expand = (moduleName: string): string => {
    if (seen.has(moduleName)) {
      throw new Error(`shader include cycle at <${moduleName}>`);
    }
    seen.add(moduleName);
    const source = MODULES[moduleName];
    if (!source) {
      throw new Error(`unknown shader module <${moduleName}>`);
    }

    return source.replace(/^#include <(\w+)>$/gm, (_, included: string) => expand(included));
  };
  const resolved = expand(name);
  assertGuardrails(name, resolved);

  return resolved;
}

/** Every module name (golden-snapshot tests iterate this). */
export function shaderModuleNames(): string[] {
  return Object.keys(MODULES).sort();
}
