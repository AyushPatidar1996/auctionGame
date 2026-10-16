import { TIERS } from "../constants";
import { createRng, deriveSeed, shuffled } from "../random";
import type {
  Action,
  AuctionState,
  Ctx,
  PlayerId,
  ReduceResult,
  Team,
  TeamId,
  ParticipantId,
} from "../types";
import { reject } from "./reject";

type StartAction = Extract<Action, { type: "START" }>;

/**
 * SETUP -> BETWEEN_LOTS. Builds the auction pool and lot order from the seed
 * (a seeded sample per tier, then tiers in `rules.tierOrder`) and creates the teams.
 */
export function start(ctx: Ctx, state: AuctionState, action: StartAction): ReduceResult {
  if (state.phase !== "SETUP") return reject(state, "WRONG_PHASE");
  if (action.at < state.lastActionAt) return reject(state, "TIME_WENT_BACKWARDS");

  const { rules } = state;
  if (action.teams.length !== rules.teams) return reject(state, "TEAM_COUNT_MISMATCH");
  const ids = new Set(action.teams.map((team) => team.id.trim()));
  const hasBlank = action.teams.some((team) => !team.id.trim() || !team.name.trim());
  if (hasBlank || ids.size !== action.teams.length) return reject(state, "INVALID_TEAMS");

  if (ctx.datasetVersion !== state.datasetVersion) return reject(state, "DATASET_MISMATCH");

  const lots = buildLots(ctx, state, action.seed);
  if (!lots || lots.length < rules.teams * rules.squad.min) {
    return reject(state, "POOL_TOO_SMALL");
  }

  const teams: Record<TeamId, Team> = {};
  const seats: Record<TeamId, ParticipantId | null> = {};
  for (const setup of action.teams) {
    teams[setup.id] = {
      id: setup.id,
      name: setup.name,
      kind: setup.kind,
      profileId: setup.profileId,
      purse: rules.purse,
      squad: [],
      lineup: null,
    };
    seats[setup.id] = setup.participantId;
  }

  return {
    state: {
      ...state,
      revision: state.revision + 1,
      meta: { ...state.meta, startedAt: action.at },
      seed: action.seed,
      phase: "BETWEEN_LOTS",
      teams,
      teamOrder: action.teams.map((team) => team.id),
      seats,
      lots,
      lotIndex: -1,
      lastActionAt: action.at,
    },
    error: null,
  };
}

/** Null when a tier has fewer players than the rules ask for. */
function buildLots(ctx: Ctx, state: AuctionState, seed: number): PlayerId[] | null {
  const { rules } = state;
  const idsByTier = new Map<string, PlayerId[]>(TIERS.map((tier) => [tier, []]));
  for (const player of ctx.players.values()) idsByTier.get(player.auctionTier)?.push(player.id);

  const lots: PlayerId[] = [];
  for (const tier of rules.tierOrder) {
    // Sorted first so the result depends on the seed, not on Map iteration order.
    const candidates = (idsByTier.get(tier) ?? []).sort();
    const wanted = rules.pool.composition[tier];
    if (candidates.length < wanted) return null;
    const order = shuffled(candidates, createRng(deriveSeed(seed, "pool", tier)));
    lots.push(...order.slice(0, wanted));
  }
  return lots;
}
