import type { Action, AuctionState, Ctx, ReduceResult } from "../types";
import { accept, reject } from "./reject";
import { settleLot } from "./settle";

type TickAction = Extract<Action, { type: "TICK" }>;

/**
 * Ends the open lot once `at` reaches its deadline (see `settleLot` for how). Any other
 * tick is an accepted no-op that does not bump `revision`, so hosts can tick as often
 * as they like.
 */
export function tick(ctx: Ctx, state: AuctionState, action: TickAction): ReduceResult {
  const { lot } = state;
  if (state.phase !== "LOT_OPEN" || !lot || action.at < lot.deadline) {
    return { state, error: null };
  }
  if (action.at < state.lastActionAt) return reject(state, "TIME_WENT_BACKWARDS");
  return accept(settleLot(state, ctx, action.at), action.at);
}
