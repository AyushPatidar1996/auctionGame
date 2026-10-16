import type { RejectReason } from "../constants";
import type { AuctionState, Millis, ReduceResult } from "../types";

/** A rejected action returns the very same state object, unchanged. */
export function reject(state: AuctionState, reason: RejectReason): ReduceResult {
  return { state, error: reason };
}

/** An accepted action: +1 revision and the action's time, once per action. */
export function accept(state: AuctionState, at: Millis): ReduceResult {
  return {
    state: { ...state, revision: state.revision + 1, lastActionAt: at },
    error: null,
  };
}
