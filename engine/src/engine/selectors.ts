import type {
  AuctionState,
  Ctx,
  Lakhs,
  Player,
  RuleSet,
  SquadPressure,
  Team,
} from "../types";

// Pure read-only helpers shared by the reducer, the UI and the CPU. State holds
// facts; everything derived from it lives here (PROJECT.md 4.3).

/** The bid step that applies at `price`: the first band whose `upTo` is above it. */
export function incrementAt(rules: RuleSet, price: Lakhs): Lakhs {
  for (const band of rules.increments) {
    if (band.upTo === null || price < band.upTo) return band.step;
  }
  throw new Error("incrementAt: no open-ended band (the rules loader prevents this)");
}

/** The only amount a bid may carry right now, or null when no lot is open. */
export function nextBid(state: AuctionState): Lakhs | null {
  const { lot } = state;
  if (state.phase !== "LOT_OPEN" || !lot) return null;
  if (!lot.highBid) return lot.basePrice;
  return lot.highBid.amount + incrementAt(state.rules, lot.highBid.amount);
}

export function isOverseas(player: Player, rules: RuleSet): boolean {
  return player.nationality !== rules.homeCountry;
}

export function overseasCount(team: Team, ctx: Ctx, rules: RuleSet): number {
  return team.squad.filter((entry) => {
    const player = ctx.players.get(entry.playerId);
    return player !== undefined && isOverseas(player, rules);
  }).length;
}

/**
 * How many players `team` must name in its lineup: `rules.lineup.size`, unless the squad
 * cannot legally field that many (too few players, or too few home players for the
 * lineup's overseas cap), in which case the most it can field. This keeps a game
 * finishable even when an earlier rule failed to leave a team with a full legal squad.
 */
export function requiredLineupSize(rules: RuleSet, ctx: Ctx, team: Team): number {
  const overseas = overseasCount(team, ctx, rules);
  const home = team.squad.length - overseas;
  return Math.min(rules.lineup.size, home + Math.min(overseas, rules.lineup.maxOverseas));
}

export function cheapestBasePrice(rules: RuleSet): Lakhs {
  return Math.min(...Object.values(rules.tierBasePrice));
}

/**
 * Purse a team must still hold after reaching `squadSize` players, so it can afford
 * to fill the rest of the minimum squad at the cheapest base price (the reserve rule).
 */
export function reserveRequired(rules: RuleSet, squadSize: number): Lakhs {
  return Math.max(0, rules.squad.min - squadSize) * cheapestBasePrice(rules);
}

/** Forced-lot bookkeeping (PROJECT.md 4.5): `forced` when lots left == slots needed. */
export function squadPressure(state: AuctionState): SquadPressure {
  const { rules } = state;
  const needed = Object.values(state.teams).reduce(
    (sum, team) => sum + Math.max(0, rules.squad.min - team.squad.length),
    0,
  );
  let left = 0;
  if (state.phase === "LOT_OPEN") left = state.lots.length - state.lotIndex;
  else if (state.phase === "BETWEEN_LOTS") left = state.lots.length - state.lotIndex - 1;
  const slack = left - needed;
  return { needed, left, slack, forced: state.phase === "LOT_OPEN" && slack <= 0 };
}
