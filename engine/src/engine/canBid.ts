import type { BidRejectReason } from "../constants";
import type { AuctionState, Ctx, Lakhs, Millis, PlayerId, Team, TeamId } from "../types";
import {
  isOverseas,
  nextBid,
  overseasCount,
  reserveRequired,
  squadPressure,
} from "./selectors";

/**
 * Whether `team` could legally take `playerId` at `amount`, ignoring who else is bidding
 * and the clock: purse, the reserve for the minimum squad, squad size, overseas cap.
 * Shared by `canBid` and the forced-lot assignment.
 */
export function holdError(
  state: AuctionState,
  ctx: Ctx,
  team: Team,
  playerId: PlayerId,
  amount: Lakhs,
): BidRejectReason | null {
  const { rules } = state;
  const size = team.squad.length;
  if (amount > team.purse) return "INSUFFICIENT_PURSE";
  if (team.purse - amount < reserveRequired(rules, size + 1)) return "RESERVE_VIOLATION";
  if (size >= rules.squad.max) return "SQUAD_FULL";

  const player = ctx.players.get(playerId);
  if (!player) throw new Error(`holdError: player ${playerId} is not in the dataset`);
  if (isOverseas(player, rules) && overseasCount(team, ctx, rules) >= rules.squad.maxOverseas) {
    return "OVERSEAS_CAP";
  }
  return null;
}

/**
 * Why `teamId` cannot bid `amount` at time `at`, or null if it can. The reducer, the UI
 * (to disable the button) and the CPU all call this, so they can never disagree.
 * Checks run in the order PROJECT.md 4.5 lists them.
 */
export function canBid(
  state: AuctionState,
  ctx: Ctx,
  teamId: TeamId,
  amount: Lakhs,
  at: Millis,
): BidRejectReason | null {
  const { lot, rules } = state;
  if (state.phase !== "LOT_OPEN" || !lot) return "WRONG_PHASE";
  const team = state.teams[teamId];
  if (!team) return "UNKNOWN_TEAM";
  if (at >= lot.deadline) return "LOT_EXPIRED";
  if (lot.passed.includes(teamId)) return "HAS_PASSED";
  if (squadPressure(state).forced && team.squad.length >= rules.squad.min) return "QUOTA_MET";
  if (lot.highBid?.teamId === teamId) return "ALREADY_HIGHEST";
  if (amount !== nextBid(state)) return "STALE_AMOUNT";
  return holdError(state, ctx, team, lot.playerId, amount);
}

/** True while some team could still outbid the current price (a "contender"). */
export function hasContender(state: AuctionState, ctx: Ctx, at: Millis): boolean {
  const amount = nextBid(state);
  if (amount === null) return false;
  return state.teamOrder.some((teamId) => canBid(state, ctx, teamId, amount, at) === null);
}
