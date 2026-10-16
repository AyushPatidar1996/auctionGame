import { createRng, deriveSeed } from "../random";

/**
 * A CPU team's personality. Plain data, so it can sit in a saved game or be sent over
 * the wire. M1 profiles are random bidders; M3 will add the fields that make them
 * rational (valuation weights, role needs, purse pacing).
 */
export interface CpuProfile {
  readonly id: string;
  /** Seeds this profile's per-lot price ceilings. */
  readonly seed: number;
  /** Chance to bid when it legally could and the price is acceptable. */
  readonly bidChance: number;
  /** Chance to drop out of a lot when it is not bidding. */
  readonly passChance: number;
  /** Price ceiling per lot = base price x (1 + ceilingFactor x a random 0..1). */
  readonly ceilingFactor: number;
}

/** `count` random profiles, fully determined by `seed`. */
export function randomProfiles(seed: number, count: number): CpuProfile[] {
  return Array.from({ length: count }, (_, i) => {
    const rng = createRng(deriveSeed(seed, "profile", i));
    return {
      id: `random-${i + 1}`,
      seed: deriveSeed(seed, "profile-seed", i),
      bidChance: 0.3 + 0.4 * rng(),
      passChance: 0.05 + 0.15 * rng(),
      ceilingFactor: 1.5 + 2.5 * rng(),
    };
  });
}
