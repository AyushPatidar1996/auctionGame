import type { PassRejectReason } from "../constants";
import type {
  Action,
  AuctionState,
  Ctx,
  Millis,
  ReduceResult,
  TeamId,
} from "../types";
import { hasContender } from "./canBid";
import { accept, reject } from "./reject";
import { squadPressure } from "./selectors";
import { settleLot } from "./settle";

type PassAction = Extract<Action, { type: "PASS" }>;

/**
 * Why `teamId` cannot pass on the open lot at time `at`, or null if it can. Shared by the
 * reducer and the UI (to disable the button), like `canBid`. Not allowed on a forced lot,
 * where skipping is exactly what the forced-lot rule forbids.
 */
export function passError(
  state: AuctionState,
  teamId: TeamId,
  at: Millis,
): PassRejectReason | null {
  const { lot } = state;
  if (state.phase !== "LOT_OPEN" || !lot) return "WRONG_PHASE";
  if (!state.teams[teamId]) return "UNKNOWN_TEAM";
  if (at >= lot.deadline) return "LOT_EXPIRED";
  if (lot.passed.includes(teamId)) return "ALREADY_PASSED";
  if (lot.highBid?.teamId === teamId) return "HIGH_BIDDER_CANNOT_PASS";
  if (squadPressure(state).forced) return "FORCED_LOT";
  return null;
}

/**
 * A team drops out of the open lot. If that leaves nobody able to outbid, the lot ends
 * at once (sold if someone leads, unsold if not).
 */
export function pass(ctx: Ctx, state: AuctionState, action: PassAction): ReduceResult {
  const { lot } = state;
  if (state.phase !== "LOT_OPEN" || !lot) return reject(state, "WRONG_PHASE");
  if (action.at < state.lastActionAt) return reject(state, "TIME_WENT_BACKWARDS");

  const reason = passError(state, action.teamId, action.at);
  if (reason) return reject(state, reason);

  const after: AuctionState = {
    ...state,
    lot: { ...lot, passed: [...lot.passed, action.teamId] },
  };
  return accept(
    hasContender(after, ctx, action.at) ? after : settleLot(after, ctx, action.at),
    action.at,
  );
}
