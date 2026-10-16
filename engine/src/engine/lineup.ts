import type { LineupRejectReason } from "../constants";
import type { Action, AuctionState, Ctx, PlayerId, ReduceResult, TeamId } from "../types";
import { accept, reject } from "./reject";
import { isOverseas, requiredLineupSize } from "./selectors";

type SubmitLineupAction = Extract<Action, { type: "SUBMIT_LINEUP" }>;

/**
 * Why `playerIds` is not a legal lineup for `teamId`, or null if it is. Shared by the
 * reducer, the lineup picker UI and the CPU, like `canBid`. Checks run in the order
 * PROJECT.md 4.5 lists them.
 */
export function lineupError(
  state: AuctionState,
  ctx: Ctx,
  teamId: TeamId,
  playerIds: readonly PlayerId[],
): LineupRejectReason | null {
  const { rules } = state;
  if (state.phase !== "SELECTING") return "WRONG_PHASE";
  const team = state.teams[teamId];
  if (!team) return "UNKNOWN_TEAM";
  if (playerIds.length !== requiredLineupSize(rules, ctx, team)) return "WRONG_LINEUP_SIZE";
  if (new Set(playerIds).size !== playerIds.length) return "DUPLICATE_PLAYER";

  const owned = new Set(team.squad.map((entry) => entry.playerId));
  if (playerIds.some((id) => !owned.has(id))) return "PLAYER_NOT_IN_SQUAD";

  const overseas = playerIds.filter((id) => {
    const player = ctx.players.get(id);
    return player !== undefined && isOverseas(player, rules);
  }).length;
  if (overseas > rules.lineup.maxOverseas) return "LINEUP_OVERSEAS_CAP";
  return null;
}

/**
 * Names a team's playing 12. A team may resubmit until the phase ends; the phase ends
 * (FINISHED) the moment every team has a lineup.
 */
export function submitLineup(
  ctx: Ctx,
  state: AuctionState,
  action: SubmitLineupAction,
): ReduceResult {
  if (state.phase !== "SELECTING") return reject(state, "WRONG_PHASE");
  if (action.at < state.lastActionAt) return reject(state, "TIME_WENT_BACKWARDS");

  const reason = lineupError(state, ctx, action.teamId, action.playerIds);
  if (reason) return reject(state, reason);

  const team = state.teams[action.teamId];
  if (!team) return reject(state, "UNKNOWN_TEAM"); // unreachable: lineupError checked it
  const teams = {
    ...state.teams,
    [action.teamId]: { ...team, lineup: [...action.playerIds] },
  };
  const everyoneIn = state.teamOrder.every((id) => teams[id]?.lineup != null);

  return accept(
    {
      ...state,
      teams,
      phase: everyoneIn ? "FINISHED" : "SELECTING",
      meta: everyoneIn ? { ...state.meta, finishedAt: action.at } : state.meta,
    },
    action.at,
  );
}
