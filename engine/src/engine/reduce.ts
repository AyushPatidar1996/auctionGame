import type { Action, AuctionState, Ctx, ReduceResult } from "../types";
import { bid } from "./bid";
import { submitLineup } from "./lineup";
import { nextLot } from "./nextLot";
import { pass } from "./pass";
import { start } from "./start";
import { tick } from "./tick";

/**
 * The state machine: (ctx, state, action) -> { state, error }.
 * Pure: no I/O, no clock, no external randomness. A rejected action returns the
 * same state object with a reason code (PROJECT.md 4.5).
 */
export function reduce(ctx: Ctx, state: AuctionState, action: Action): ReduceResult {
  switch (action.type) {
    case "START":
      return start(ctx, state, action);
    case "NEXT_LOT":
      return nextLot(ctx, state, action);
    case "BID":
      return bid(ctx, state, action);
    case "PASS":
      return pass(ctx, state, action);
    case "TICK":
      return tick(ctx, state, action);
    case "SUBMIT_LINEUP":
      return submitLineup(ctx, state, action);
  }
}
