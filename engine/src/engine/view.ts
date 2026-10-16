import type { AuctionState, TeamId } from "../types";

/**
 * What `viewer` is allowed to see of the game (PROJECT.md 4.3). A pure projection with
 * the same shape as the state, so selectors like `canBid` work on it unchanged.
 * Hidden: the seed (it would reveal forced-lot picks) and, while lineups are being
 * chosen, every other team's lineup. Pass `null` for a spectator who owns no team.
 * The CPU and, online, every client only ever receive views, never the raw state.
 */
export function viewFor(state: AuctionState, viewer: TeamId | null): AuctionState {
  const teams = { ...state.teams };
  if (state.phase === "SELECTING") {
    for (const id of state.teamOrder) {
      const team = teams[id];
      if (team && id !== viewer && team.lineup !== null) teams[id] = { ...team, lineup: null };
    }
  }
  return { ...state, seed: null, teams };
}
