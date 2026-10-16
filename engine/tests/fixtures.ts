import { expect } from "vitest";
import type { AuctionTier } from "../src/constants";
import { createCtx, createGame, reduce } from "../src/engine";
import { loadDataset, loadRules } from "../src/loaders";
import type {
  Action,
  AuctionState,
  Ctx,
  RuleSet,
  Team,
  TeamSetup,
} from "../src/types";
import { readData } from "./helpers";

export type StartAction = Extract<Action, { type: "START" }>;

function loadReal(): { ctx: Ctx; rules: RuleSet } {
  const dataset = loadDataset(readData("players.v1.json"));
  const rules = loadRules(readData("rules.default.json"));
  if (!dataset.ok) throw new Error(dataset.errors.join("\n"));
  if (!rules.ok) throw new Error(rules.errors.join("\n"));
  return { ctx: createCtx(dataset.value), rules: rules.value };
}

export const { ctx, rules } = loadReal();

export function teamSetups(count = rules.teams): TeamSetup[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `t${i + 1}`,
    name: `Team ${i + 1}`,
    kind: i === 0 ? ("human" as const) : ("cpu" as const),
    profileId: null,
    participantId: i === 0 ? "me" : null,
  }));
}

export function newGame(overrides: Partial<{ rules: RuleSet }> = {}): AuctionState {
  return createGame({
    gameId: "g1",
    mode: "offline",
    createdAt: 1000,
    hostId: "me",
    datasetVersion: ctx.datasetVersion,
    rules: overrides.rules ?? rules,
  });
}

export function startAction(seed = 1, at = 2000, teams = teamSetups()): StartAction {
  return { type: "START", at, seed, teams };
}

export function started(seed = 1): AuctionState {
  return step(newGame(), startAction(seed));
}

export const tierOf = (id: string): AuctionTier => {
  const player = ctx.players.get(id);
  if (!player) throw new Error(`unknown player ${id}`);
  return player.auctionTier;
};

/** Applies an action that must be accepted; also checks the revision bookkeeping. */
export function step(state: AuctionState, action: Action): AuctionState {
  const result = reduce(ctx, state, action);
  expect(result.error, `${action.type} was rejected`).toBeNull();
  const bumped = result.state.revision - state.revision;
  expect([0, 1]).toContain(bumped);
  if (bumped === 0) expect(result.state).toBe(state); // only a no-op may skip the bump
  return result.state;
}

/** Replaces one team's fields, for building edge-case states. */
export function withTeam(state: AuctionState, id: string, patch: Partial<Team>): AuctionState {
  const team = state.teams[id];
  if (!team) throw new Error(`no team ${id}`);
  return { ...state, teams: { ...state.teams, [id]: { ...team, ...patch } } };
}

/** A started game with the first lot open, plus the time it opened at. */
export function openFirstLot(seed = 1, at = 3000): AuctionState {
  return step(started(seed), { type: "NEXT_LOT", at });
}
