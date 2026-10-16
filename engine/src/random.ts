// Deterministic randomness. The engine never calls Math.random: every random
// choice is a pure function of a seed, so the same seed always replays the same game.

export type Rng = () => number;

/** mulberry32. Returns a function yielding floats in [0, 1). */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derives an independent sub-seed from a seed plus labels (FNV-1a over the text),
 * so unrelated draws ("pool" per tier, a forced-lot pick per lot) do not share
 * a random stream and cannot disturb each other.
 */
export function deriveSeed(seed: number, ...parts: readonly (string | number)[]): number {
  const text = [seed >>> 0, ...parts].join("|");
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Fisher-Yates on a copy. The input is never modified. */
export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/** A pure pick in 0..n-1 from a seed and labels. Requires n >= 1. */
export function pickIndex(seed: number, n: number, ...parts: readonly (string | number)[]): number {
  return Math.floor(createRng(deriveSeed(seed, ...parts))() * n);
}
