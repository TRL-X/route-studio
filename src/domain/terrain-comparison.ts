export interface ProfileReading {
  distance: number;
  height: number | null;
}

interface Span {
  startM: number;
  endM: number;
}

const thresholdM = 20;
const maxDipLengthM = 90;
const maxSampleGapM = 200;

/** Find local changes in shape using two distance-sorted profiles, without shifting either curve. */
export function localDifferenceSections(
  source: readonly ProfileReading[],
  terrain: readonly ProfileReading[],
): Span[] {
  const differences = new Float64Array(source.length).fill(NaN);
  const terrainBreak = new Uint8Array(source.length);
  const valid: number[] = [];
  let j = 0;
  for (let i = 0; i < source.length; i++) {
    const { distance, height } = source[i];
    while (j < terrain.length && terrain[j].distance < distance) {
      // The new curve can have extra samples between two original observations.
      if (!Number.isFinite(terrain[j].height)) terrainBreak[i] = 1;
      j++;
    }
    if (height === null || j === terrain.length || terrain[j].distance !== distance) continue;
    const dem = terrain[j].height;
    if (dem === null) continue;
    const difference = height - dem;
    if (!Number.isFinite(difference)) continue;
    differences[i] = difference;
    valid.push(difference);
  }
  if (valid.length < 2) return [];
  valid.sort((a, b) => a - b);
  const mid = valid.length >> 1;
  const offset = valid.length % 2 ? valid[mid] : valid[mid - 1] / 2 + valid[mid] / 2;
  function direction(i: number) {
    const residual = differences[i] - offset;
    return Math.abs(residual) >= thresholdM ? Math.sign(residual) : 0;
  }

  const spans: Span[] = [];
  let current: Span | undefined;
  let sign = 0;
  let inDip = false;
  for (let first = 0; first < source.length;) {
    if (terrainBreak[first]) current = undefined;
    const distance = source[first].distance;
    let end = first + 1;
    const nextSign = direction(first);
    let mixed = false;
    while (end < source.length && source[end].distance === distance) {
      if (direction(end) !== nextSign) mixed = true;
      end++;
    }
    if (mixed) {
      // Different classifications at one location are isolated from both neighbors.
      spans.push({ startM: distance, endM: distance });
      current = undefined;
    } else if (!nextSign) {
      // Only a short same-direction dip at or above half the threshold can bridge peaks.
      for (let i = first; i < end; i++) {
        const residual = differences[i] - offset;
        if (Math.sign(residual) !== sign || Math.abs(residual) < thresholdM / 2) current = undefined;
      }
      inDip = true;
    } else {
      if (
        !current ||
        sign !== nextSign ||
        distance - current.endM > (inDip ? maxDipLengthM : maxSampleGapM)
      ) {
        current = { startM: distance, endM: distance };
        spans.push(current);
      } else current.endM = distance;
      sign = nextSign;
      inDip = false;
    }
    first = end;
  }
  return spans;
}
