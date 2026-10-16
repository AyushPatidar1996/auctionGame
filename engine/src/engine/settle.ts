import { pickIndex } from "../random";
import type { AuctionState, Ctx, Millis, TeamId } from "../types";
import { holdError } from "./canBid";
import { closeLot } from "./closeLot";
import { squadPressure } from "./selectors";

/**
 * Ends the open lot by the rules: sold to the high bidder; or, on a forced lot with no
 * bid, handed at base price to one eligible needy team; otherwise unsold.
 */
export function settleLot(state: AuctionState, ctx: Ctx, at: Millis): AuctionState {
  const { lot } = state;
  if (!lot) throw new Error("settleLot: no open lot");
  if (!lot.highBid && squadPressure(state).forced) {
    const teamId = pickForcedTeam(state, ctx);
    if (teamId !== null) return closeLot(state, at, teamId);
    // Dead end (no needy team can legally take the player): falls through to unsold.
    // The reserve rule and the tier order are meant to make this unreachable.
  }
  return closeLot(state, at);
}

/**
 * Among teams still below the minimum squad that can legally take the player at base
 * price, a pure seeded pick (`hash(seed, lotIndex)`), so replays always agree.
 */
function pickForcedTeam(state: AuctionState, ctx: Ctx): TeamId | null {
  const { lot, rules, seed } = state;
  if (!lot || seed === null) return null;
  const eligible = state.teamOrder.filter((teamId) => {
    const team = state.teams[teamId];
    return (
      team !== undefined &&
      team.squad.length < rules.squad.min &&
      holdError(state, ctx, team, lot.playerId, lot.basePrice) === null
    );
  });
  if (eligible.length === 0) return null;
  return eligible[pickIndex(seed, eligible.length, "forced", state.lotIndex)] ?? null;
}
