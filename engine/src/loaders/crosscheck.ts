import { TIERS } from "../constants";
import type { Dataset, RuleSet } from "../types";

export interface CrossCheck {
  /** The pair cannot start a game. */
  readonly errors: readonly string[];
  /** Suspicious but playable. */
  readonly warnings: readonly string[];
}

/** Checks a validated RuleSet against a validated Dataset (the two files must agree). */
export function checkRulesAgainstDataset(rules: RuleSet, dataset: Dataset): CrossCheck {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const tier of TIERS) {
    const available = dataset.players.filter((p) => p.auctionTier === tier).length;
    const wanted = rules.pool.composition[tier];
    if (wanted > available) {
      errors.push(
        `pool.composition.${tier} is ${wanted} but the dataset has only ${available} ${tier} players`,
      );
    }
  }

  if (!dataset.players.some((p) => p.nationality === rules.homeCountry)) {
    warnings.push(
      `no player has nationality "${rules.homeCountry}" (rules.homeCountry), so nobody counts as home`,
    );
  }

  return { errors, warnings };
}
