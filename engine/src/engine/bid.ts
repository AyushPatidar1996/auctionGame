import type { Action, AuctionState, Ctx, ReduceResult } from "../types";
import { canBid, hasContender } from "./canBid";
import { accept, reject } from "./reject";
import { settleLot } from "./settle";

type BidAction = Extract<Action, { type: "BID" }>;

/**
 * Raises the high bid. `amount` must equal the next valid bid, so a stale click is
 * rejected instead of raising the price a second time. A bid pushes the deadline out
 * when `timer.resetOnBid` is on, and ends the lot at once if nobody else can outbid it.
 */
export function bid(ctx: Ctx, state: AuctionState, action: BidAction): ReduceResult {
  const { lot } = state;
  if (state.phase !== "LOT_OPEN" || !lot) return reject(state, "WRONG_PHASE");
  if (action.at < state.lastActionAt) return reject(state, "TIME_WENT_BACKWARDS");

  const reason = canBid(state, ctx, action.teamId, action.amount, action.at);
  if (reason) return reject(state, reason);

  const { timer } = state.rules;
  const after: AuctionState = {
    ...state,
    lot: {
      ...lot,
      highBid: { teamId: action.teamId, amount: action.amount },
      deadline: timer.resetOnBid ? action.at + timer.bidWindowMs : lot.deadline,
    },
  };
  return accept(
    hasContender(after, ctx, action.at) ? after : settleLot(after, ctx, action.at),
    action.at,
  );
}
