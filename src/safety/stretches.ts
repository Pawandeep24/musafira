import type { Segment, Stretch } from "#src/safety/types.js";

/** Contiguous runs of segments matching `predicate` that are at least `minMeters` long. */
export function findStretches(
  segments: readonly Segment[],
  predicate: (index: number) => boolean,
  minMeters: number,
): Stretch[] {
  const stretches: Stretch[] = [];
  let start: number | undefined;
  segments.forEach((segment, i) => {
    if (predicate(i)) {
      start ??= segment.startMeters;
      const next = segments[i + 1];
      if (next && predicate(i + 1)) return;
      if (segment.endMeters - start >= minMeters) stretches.push({ startMeters: start, endMeters: segment.endMeters });
    }
    start = undefined;
  });
  return stretches;
}

/** Longest distance between consecutive positions, counting the route's start and end. */
export function longestGap(positions: readonly number[], totalMeters: number): number {
  const sorted = [0, ...positions.filter((p) => p >= 0 && p <= totalMeters).sort((a, b) => a - b), totalMeters];
  let longest = 0;
  for (let i = 1; i < sorted.length; i++) longest = Math.max(longest, sorted[i]! - sorted[i - 1]!);
  return longest;
}
