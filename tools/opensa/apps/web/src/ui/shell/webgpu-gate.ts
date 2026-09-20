/**
 * WebGPU boot gate (plan 074/10, WebGPU-first): the own engine IS the game, with no WebGL fallback.
 *
 * The probe asks ONE question — can this browser give us a device at all — and deliberately not a second.
 * It used to also demand `texture-compression-bc`, which conflated the DEVICE with the CONTENT: a phone
 * whose browser runs WebGPU perfectly well was told its browser does not support WebGPU, because the world
 * we happened to ship was BC. Whether a given world can be displayed is read from that world's manifest
 * instead (`requireWorldSupport`, at stream setup), where the answer is true and specific.
 *
 * What it reports is a REASON, not a boolean (plan 200/4-05). "No WebGPU in this browser" and "WebGPU is
 * here and the adapter was refused" are different facts with different remedies, and the phone case is the
 * second one: a Mali-G51 on Chromium 148 has WebGPU and returns a **null adapter** because of the driver
 * blocklist (`docs/edge-cases/browser-runtime.md`, 2026-08-04). Telling that user to "use a recent Chrome"
 * is false and unactionable — they are on one.
 */

/** Why the gate closed, or `ok`. */
export type WebGpuProbe = 'no-adapter' | 'no-api' | 'ok';

type GpuLike = Pick<GPU, 'requestAdapter'>;

export async function probeWebGpu(gpu: GpuLike | null | undefined = navigator.gpu): Promise<WebGpuProbe> {
  // The VALUE, not just the key: a browser that ships the accessor while returning undefined would otherwise
  // fall through to `.requestAdapter` and throw a bare TypeError (the same trap `initDevice` guards).
  if (!gpu) {
    return 'no-api';
  }
  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });

    return adapter === null ? 'no-adapter' : 'ok';
  } catch {
    // A THROWN request is the API answering, so this is not "no WebGPU here" either — same message as null.
    return 'no-adapter';
  }
}

/** What the sorry screen says. One sentence of fact, one of what the reader can actually do. */
export function webGpuGateMessage(probe: Exclude<WebGpuProbe, 'ok'>): string {
  return probe === 'no-api'
    ? 'Sorry — OpenSA runs on WebGPU, and this browser does not have it. Please use a recent Chrome or Edge, ' +
        'or Safari 26+ on macOS.'
    : 'Sorry — this browser has WebGPU, but it would not give us a GPU adapter. That is usually the driver ' +
        'blocklist (common on Android) or WebGPU being switched off in the browser flags, rather than ' +
        'anything about the hardware.';
}
