/** Maps a count onto 0..1 with diminishing returns; `k` is the count that reaches ~63%. */
export const saturate = (count: number, k: number) => 1 - Math.exp(-count / k);

/** 1 at distance 0, 0.5 at `halfAt` metres, approaching 0 far away. */
export const proximity = (meters: number, halfAt: number) => 1 / (1 + meters / halfAt);

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
