/**
 * Collect the unique ArrayBuffers under a value (plain objects/arrays/typed arrays) for a postMessage
 * transfer list — moving parsed-model results between the parse worker and the main thread without
 * copying their vertex data (plan 060 Phase 5). Views sharing one buffer dedupe to a single entry.
 */
export function collectTransferables(value: unknown): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  collect(value, buffers, new Set());

  return [...buffers];
}

function collect(value: unknown, buffers: Set<ArrayBuffer>, seen: Set<object>): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return;
  }
  seen.add(value);
  if (value instanceof ArrayBuffer) {
    buffers.add(value);

    return;
  }
  if (ArrayBuffer.isView(value)) {
    if (value.buffer instanceof ArrayBuffer) {
      buffers.add(value.buffer);
    }

    return;
  }
  for (const entry of Array.isArray(value) ? value : Object.values(value)) {
    collect(entry, buffers, seen);
  }
}
