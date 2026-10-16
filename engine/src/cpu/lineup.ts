import { isOverseas, requiredLineupSize } from "../engine/selectors";
import type { Action, AuctionState, Ctx, Millis, Player, PlayerId, TeamId } from "../types";

/** A simple all-round value for ordering players (M1; M3 can weight by team needs). */
function overall(player: Player): number {
  return player.batScore + player.bowlScore + player.fieldScore;
}

/**
 * The best-looking legal playing 12 from a team's own squad: highest overall first,
 * overseas players only up to the lineup cap. Always reaches `requiredLineupSize`.
 */
export function chooseLineup(ctx: Ctx, state: AuctionState, teamId: TeamId): PlayerId[] {
  const team = state.teams[teamId];
  if (!team) throw new Error(`chooseLineup: unknown team ${teamId}`);
  const { rules } = state;

  const squad = team.squad
    .map((entry) => ctx.players.get(entry.playerId))
    .filter((player): player is Player => player !== undefined)
    .sort((a, b) => overall(b) - overall(a) || a.id.localeCompare(b.id));

  const size = requiredLineupSize(rules, ctx, team);
  const picked: PlayerId[] = [];
  let overseas = 0;
  for (const player of squad) {
    if (picked.length === size) break;
    if (isOverseas(player, rules)) {
      if (overseas === rules.lineup.maxOverseas) continue;
      overseas++;
    }
    picked.push(player.id);
  }
  return picked;
}

/** The CPU's lineup submission, or null if it is not selection time for this team. */
export function lineupAction(
  ctx: Ctx,
  view: AuctionState,
  teamId: TeamId,
  at: Millis,
): Action | null {
  const team = view.teams[teamId];
  if (view.phase !== "SELECTING" || !team || team.lineup !== null) return null;
  return { type: "SUBMIT_LINEUP", at, teamId, playerIds: chooseLineup(ctx, view, teamId) };
}
