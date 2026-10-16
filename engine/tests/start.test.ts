import { describe, expect, it } from "vitest";
import { TIERS } from "../src/constants";
import { reduce } from "../src/engine";
import type { RuleSet } from "../src/types";
import { ctx, newGame, rules, started, startAction, teamSetups, tierOf } from "./fixtures";

describe("createGame", () => {
  it("starts in SETUP with nothing in it", () => {
    const game = newGame();
    expect(game.phase).toBe("SETUP");
    expect(game.revision).toBe(0);
    expect(game.seed).toBeNull();
    expect(game.lots).toEqual([]);
    expect(game.lotIndex).toBe(-1);
    expect(game.teamOrder).toEqual([]);
    expect(game.meta.startedAt).toBeNull();
    expect(game.lastActionAt).toBe(1000);
  });
});

describe("START: the new state", () => {
  it("moves to BETWEEN_LOTS and records the start", () => {
    const state = started(7);
    expect(state.phase).toBe("BETWEEN_LOTS");
    expect(state.revision).toBe(1);
    expect(state.seed).toBe(7);
    expect(state.meta.startedAt).toBe(2000);
    expect(state.lastActionAt).toBe(2000);
    expect(state.lotIndex).toBe(-1);
    expect(state.lot).toBeNull();
    expect(state.history).toEqual([]);
    expect(state.unsold).toEqual([]);
  });

  it("creates every team with a full purse, no squad and no lineup", () => {
    const state = started();
    expect(state.teamOrder).toEqual(teamSetups().map((t) => t.id));
    for (const id of state.teamOrder) {
      const team = state.teams[id];
      expect(team).toMatchObject({ purse: rules.purse, squad: [], lineup: null });
    }
    expect(state.teams["t1"]).toMatchObject({ kind: "human", name: "Team 1" });
    expect(state.seats["t1"]).toBe("me");
    expect(state.seats["t2"]).toBeNull();
  });

  it("is JSON-safe (survives a round trip unchanged)", () => {
    const state = started();
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it("does not modify the state it was given", () => {
    const before = newGame();
    const snapshot = structuredClone(before);
    reduce(ctx, before, startAction());
    expect(before).toEqual(snapshot);
  });
});

describe("START: the pool and lot order", () => {
  it("has the composition the rules ask for, with no repeats", () => {
    const { lots } = started();
    const total = TIERS.reduce((sum, tier) => sum + rules.pool.composition[tier], 0);
    expect(lots).toHaveLength(total);
    expect(new Set(lots).size).toBe(lots.length);
    for (const tier of TIERS) {
      expect(lots.filter((id) => tierOf(id) === tier)).toHaveLength(
        rules.pool.composition[tier],
      );
    }
  });

  it("only uses players that exist in the dataset", () => {
    for (const id of started().lots) expect(ctx.players.has(id)).toBe(true);
  });

  it("offers tiers in the order the rules set", () => {
    const rank = (id: string) => rules.tierOrder.indexOf(tierOf(id));
    const ranks = started().lots.map(rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("is identical for the same seed", () => {
    expect(started(5).lots).toEqual(started(5).lots);
  });

  it("does not depend on the order players were loaded in", () => {
    const reversed = { ...ctx, players: new Map([...ctx.players].reverse()) };
    const fromReversed = reduce(reversed, newGame(), startAction(5));
    expect(fromReversed.error).toBeNull();
    expect(fromReversed.state.lots).toEqual(started(5).lots);
  });

  it("differs between seeds", () => {
    expect(started(5).lots).not.toEqual(started(6).lots);
  });

  it("draws different players for different seeds, not just reordered ones", () => {
    const a = new Set(started(5).lots);
    const b = new Set(started(6).lots);
    const onlyInA = [...a].filter((id) => !b.has(id));
    expect(onlyInA.length).toBeGreaterThan(0);
  });

  it("covers the whole tier when the composition equals the tier size", () => {
    const sizes = TIERS.map((t) => [...ctx.players.values()].filter((p) => p.auctionTier === t).length);
    const everyone: RuleSet = {
      ...rules,
      pool: {
        ...rules.pool,
        composition: { marquee: sizes[0] ?? 0, A: sizes[1] ?? 0, B: sizes[2] ?? 0, C: sizes[3] ?? 0 },
      },
    };
    const result = reduce(ctx, newGame({ rules: everyone }), startAction());
    expect(result.error).toBeNull();
    expect(result.state.lots).toHaveLength(ctx.players.size);
  });
});

describe("START: rejections leave the state untouched", () => {
  const cases: [string, () => ReturnType<typeof reduce>, string][] = [
    [
      "started twice",
      () => reduce(ctx, started(), startAction()),
      "WRONG_PHASE",
    ],
    [
      "too few teams",
      () => reduce(ctx, newGame(), startAction(1, 2000, teamSetups(9))),
      "TEAM_COUNT_MISMATCH",
    ],
    [
      "too many teams",
      () => reduce(ctx, newGame(), startAction(1, 2000, teamSetups(11))),
      "TEAM_COUNT_MISMATCH",
    ],
    [
      "duplicate team id",
      () => {
        const teams = teamSetups();
        teams[1] = { ...teams[0]!, name: "Clone" };
        return reduce(ctx, newGame(), startAction(1, 2000, teams));
      },
      "INVALID_TEAMS",
    ],
    [
      "blank team name",
      () => {
        const teams = teamSetups();
        teams[3] = { ...teams[3]!, name: "  " };
        return reduce(ctx, newGame(), startAction(1, 2000, teams));
      },
      "INVALID_TEAMS",
    ],
    [
      "time before the game was created",
      () => reduce(ctx, newGame(), startAction(1, 999)),
      "TIME_WENT_BACKWARDS",
    ],
    [
      "dataset version differs",
      () => reduce({ ...ctx, datasetVersion: 99 }, newGame(), startAction()),
      "DATASET_MISMATCH",
    ],
    [
      "a tier asks for more players than exist",
      () => {
        const greedy: RuleSet = {
          ...rules,
          pool: { ...rules.pool, composition: { ...rules.pool.composition, marquee: 999 } },
        };
        return reduce(ctx, newGame({ rules: greedy }), startAction());
      },
      "POOL_TOO_SMALL",
    ],
    [
      "pool smaller than the minimum squads",
      () => {
        const tiny: RuleSet = {
          ...rules,
          pool: { ...rules.pool, composition: { marquee: 1, A: 1, B: 1, C: 1 } },
        };
        return reduce(ctx, newGame({ rules: tiny }), startAction());
      },
      "POOL_TOO_SMALL",
    ],
  ];

  it.each(cases)("%s", (_name, run, expected) => {
    const result = run();
    expect(result.error).toBe(expected);
  });

  it("returns the very same state object when rejecting", () => {
    const game = newGame();
    const result = reduce(ctx, game, startAction(1, 2000, teamSetups(9)));
    expect(result.state).toBe(game);
  });

  it("can be retried after a rejection", () => {
    const game = newGame();
    const bad = reduce(ctx, game, startAction(1, 2000, teamSetups(9)));
    const good = reduce(ctx, bad.state, startAction());
    expect(good.error).toBeNull();
    expect(good.state.revision).toBe(1);
  });
});
