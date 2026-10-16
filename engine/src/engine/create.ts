import { SCHEMA_VERSION, type GameMode } from "../constants";
import type {
  AuctionState,
  Ctx,
  Dataset,
  GameId,
  Millis,
  ParticipantId,
  RuleSet,
} from "../types";

export interface CreateGameArgs {
  readonly gameId: GameId;
  readonly mode: GameMode;
  readonly createdAt: Millis;
  readonly hostId: ParticipantId | null;
  readonly datasetVersion: number;
  readonly rules: RuleSet;
}

/** A game in phase SETUP: no teams, no pool, no seed. START fills those in. */
export function createGame(args: CreateGameArgs): AuctionState {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    meta: {
      gameId: args.gameId,
      mode: args.mode,
      createdAt: args.createdAt,
      startedAt: null,
      finishedAt: null,
      hostId: args.hostId,
    },
    datasetVersion: args.datasetVersion,
    rules: args.rules,
    seed: null,
    phase: "SETUP",
    teams: {},
    teamOrder: [],
    seats: {},
    lots: [],
    lotIndex: -1,
    lot: null,
    unsold: [],
    history: [],
    lastActionAt: args.createdAt,
  };
}

/** Builds the read-only context the reducer needs from a validated dataset. */
export function createCtx(dataset: Dataset): Ctx {
  return {
    datasetVersion: dataset.datasetVersion,
    players: new Map(dataset.players.map((player) => [player.id, player])),
  };
}
