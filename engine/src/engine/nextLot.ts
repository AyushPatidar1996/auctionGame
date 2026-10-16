import type { Action, AuctionState, Ctx, ReduceResult } from "../types";
import { hasContender } from "./canBid";
import { accept, reject } from "./reject";
import { settleLot } from "./settle";

type NextLotAction = Extract<Action, { type: "NEXT_LOT" }>;

/**
 * BETWEEN_LOTS -> LOT_OPEN with the next lot, or -> SELECTING when the pool is used up.
 * If no team could legally bid even the base price, the lot ends at once instead of
 * making everyone wait out the timer.
 */
export function nextLot(ctx: Ctx, state: AuctionState, action: NextLotAction): ReduceResult {
  if (state.phase !== "BETWEEN_LOTS") return reject(state, "WRONG_PHASE");
  if (action.at < state.lastActionAt) return reject(state, "TIME_WENT_BACKWARDS");

  const index = state.lotIndex + 1;
  const playerId = state.lots[index];
  if (playerId === undefined) {
    return accept({ ...state, phase: "SELECTING" }, action.at);
  }

  const player = ctx.players.get(playerId);
  if (!player) return reject(state, "DATASET_MISMATCH");

  const opened: AuctionState = {
    ...state,
    phase: "LOT_OPEN",
    lotIndex: index,
    lot: {
      playerId,
      basePrice: state.rules.tierBasePrice[player.auctionTier],
      highBid: null,
      deadline: action.at + state.rules.timer.bidWindowMs,
      passed: [],
    },
  };
  return accept(
    hasContender(opened, ctx, action.at) ? opened : settleLot(opened, ctx, action.at),
    action.at,
  );
}
