/**
 * Bleed colour outward into transparent texels — RGB only, alpha untouched (plan 013 step 01).
 *
 * The bake leaves the background at RGBA 0, and every consumer of the atlas mixes those black texels back in:
 * a DXT block fits its two endpoints over all 16 texels, so one transparent black texel drags the leaf texels
 * of its block toward black, and bilinear filtering does the same at every canopy edge. Filling the
 * transparent texels with their nearest covered colour costs nothing at runtime (alpha still hides them) and
 * removes the darkening at its source.
 */
export function dilateTransparent(rgba: Uint8Array, width: number, height: number, rings: number): void {
  const covered = new Uint8Array(width * height);
  for (let i = 0; i < covered.length; i += 1) {
    covered[i] = rgba[i * 4 + 3] > 0 ? 1 : 0;
  }

  for (let ring = 0; ring < rings; ring += 1) {
    const filled = fillRing(rgba, covered, width, height);
    if (filled.length === 0) {
      return; // nothing left to reach
    }
    // Marked only after the whole ring is written: a texel filled by this pass must not seed the same pass.
    for (const index of filled) {
      covered[index] = 1;
    }
  }
}

/** Write one ring of nearest-covered colour and return the texel indices it filled. */
function fillRing(rgba: Uint8Array, covered: Uint8Array, width: number, height: number): number[] {
  const filled: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (covered[index] === 1) {
        continue;
      }
      const mean = neighbourMean(rgba, covered, width, height, x, y);
      if (mean === null) {
        continue;
      }
      rgba[index * 4] = mean[0];
      rgba[index * 4 + 1] = mean[1];
      rgba[index * 4 + 2] = mean[2];
      filled.push(index);
    }
  }

  return filled;
}

/** Mean RGB of the covered texels among the 8 neighbours, or `null` when none of them is covered. */
function neighbourMean(
  rgba: Uint8Array,
  covered: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): [number, number, number] | null {
  let count = 0;
  const sum = [0, 0, 0];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }
      const index = ny * width + nx;
      if (covered[index] === 0) {
        continue;
      }
      count += 1;
      sum[0] += rgba[index * 4];
      sum[1] += rgba[index * 4 + 1];
      sum[2] += rgba[index * 4 + 2];
    }
  }

  return count === 0 ? null : [Math.round(sum[0] / count), Math.round(sum[1] / count), Math.round(sum[2] / count)];
}
