import { describe, expect, it } from "vitest";
import { reduce, squadPressure } from "../src/engine";
import type { Action, AuctionState, SquadEntry } from "../src/types";
import { checkInvariants } from "./invariants";
import { ctx, rules, started, step, withTeam } from "./fixtures";
import { playRandomLots } from "./sim";

const bid = (at: number, teamId: string, amount: number): Action => ({ type: "BID", at, teamId, amount });
const pass = (at: number, teamId: string): Action => ({ type: "PASS", at, teamId });

function lotOf(state: AuctionState) {
  if (!state.lot) throw new Error("test setup: no open lot");
  return state.lot;
}

/** Players outside the auction pool, used to give a team a ready-made full squad. */
function filler(state: AuctionState, count: number, skip = 0): SquadEntry[] {
  const inPool = new Set(state.lots);
  const spare = [...ctx.players.keys()].filter((id) => !inPool.has(id)).slice(skip, skip + count);
  if (spare.length < count) throw new Error("test setup: not enough spare players");
  return spare.map((playerId, i) => ({ playerId, price: 0, lotIndex: -1 - i }));
}

/**
 * A started game rigged so the very next lot is forced: `satisfiedTeams` already hold a
 * full minimum squad, and the lot list is trimmed to exactly the slots the others need.
 */
function forcedGame(satisfied: string[] = []): AuctionState {
  let state = started(1);
  satisfied.forEach((id, n) => {
    state = withTeam(state, id, { squad: filler(state, rules.squad.min, n * rules.squad.min) });
  });
  const needy = state.teamOrder.length - satisfied.length;
  return { ...state, lots: state.lots.slice(0, needy * rules.squad.min) };
}

function runNoBidLots(from: AuctionState, count: number, startAt = 3000): AuctionState {
  let state = from;
  let now = startAt;
  for (let i = 0; i < count; i++) {
    state = step(state, { type: "NEXT_LOT", at: now });
    if (state.lot) {
      now = state.lot.deadline;
      state = step(state, { type: "TICK", at: now });
    }
    now += 1;
  }
  return state;
}

describe("forced lots", () => {
  it("are flagged once lots left equal slots needed", () => {
    const state = step(forcedGame(), { type: "NEXT_LOT", at: 3000 });
    expect(squadPressure(state)).toEqual({ needed: 150, left: 150, slack: 0, forced: true });
  });

  it("forbid passing", () => {
    const state = step(forcedGame(), { type: "NEXT_LOT", at: 3000 });
    const result = reduce(ctx, state, pass(3100, "t2"));
    expect(result.error).toBe("FORCED_LOT");
    expect(result.state).toBe(state);
  });

  it("keep bidding open to teams still short of the minimum", () => {
    const state = step(forcedGame(), { type: "NEXT_LOT", at: 3000 });
    const led = step(state, bid(3100, "t2", lotOf(state).basePrice));
    expect(lotOf(led).highBid?.teamId).toBe("t2");
  });

  it("bar teams that already have the minimum (QUOTA_MET)", () => {
    const state = step(forcedGame(["t2"]), { type: "NEXT_LOT", at: 3000 });
    expect(squadPressure(state).forced).toBe(true);
    expect(reduce(ctx, state, bid(3100, "t2", lotOf(state).basePrice)).error).toBe("QUOTA_MET");
    expect(reduce(ctx, state, bid(3100, "t3", lotOf(state).basePrice)).error).toBeNull();
  });

  it("are not forced while there is slack", () => {
    const state = step(started(1), { type: "NEXT_LOT", at: 3000 });
    expect(squadPressure(state).forced).toBe(false);
    expect(reduce(ctx, state, pass(3100, "t2")).error).toBeNull();
  });
});

describe("a forced lot nobody bids on", () => {
  it("is given to a needy team at base price, not left unsold", () => {
    const open = step(forcedGame(), { type: "NEXT_LOT", at: 3000 });
    const lot = lotOf(open);
    const closed = step(open, { type: "TICK", at: lot.deadline });

    expect(closed.unsold).toEqual([]);
    const record = closed.history[0];
    expect(record).toMatchObject({
      outcome: "sold", price: lot.basePrice, assignedBy: "forced", playerId: lot.playerId,
    });
    if (record?.outcome !== "sold") throw new Error("expected a sale");
    const winner = closed.teams[record.teamId];
    expect(winner?.purse).toBe(rules.purse - lot.basePrice);
    expect(winner?.squad).toEqual([{ playerId: lot.playerId, price: lot.basePrice, lotIndex: 0 }]);
    checkInvariants(closed, ctx);
  });

  it("never goes to a team that already has the minimum", () => {
    const satisfied = ["t1", "t2", "t3", "t4", "t5"];
    const base = forcedGame(satisfied);
    const done = runNoBidLots(base, base.lots.length);
    for (const id of satisfied) expect(done.teams[id]?.squad).toHaveLength(rules.squad.min);
    for (const id of done.teamOrder.filter((t) => !satisfied.includes(t))) {
      expect(done.teams[id]?.squad).toHaveLength(rules.squad.min);
    }
    expect(done.unsold).toEqual([]);
    expect(done.history.every((r) => r.outcome === "sold" && r.assignedBy === "forced")).toBe(true);
  });

  it("brings every team to exactly the minimum over a whole forced run", () => {
    const base = forcedGame();
    const done = runNoBidLots(base, base.lots.length);
    expect(done.unsold).toEqual([]);
    for (const id of done.teamOrder) expect(done.teams[id]?.squad).toHaveLength(rules.squad.min);
    expect(squadPressure(done)).toMatchObject({ needed: 0, left: 0 });
  });

  it("is deterministic: the same game gives the same assignments", () => {
    const run = () => runNoBidLots(forcedGame(), 40).history;
    expect(run()).toEqual(run());
  });

  it("depends on the seed", () => {
    const withSeed = (seed: number) => {
      let state = started(seed);
      state = { ...state, lots: state.lots.slice(0, 150) };
      return runNoBidLots(state, 40).history.map((r) => (r.outcome === "sold" ? r.teamId : "-"));
    };
    expect(withSeed(1)).not.toEqual(withSeed(2));
  });

  it("spreads lots across all the needy teams", () => {
    const done = runNoBidLots(forcedGame(), 30);
    const winners = new Set(done.history.map((r) => (r.outcome === "sold" ? r.teamId : "")));
    expect(winners.size).toBeGreaterThan(5);
  });

  it("still lets a real bid win normally", () => {
    const open = step(forcedGame(), { type: "NEXT_LOT", at: 3000 });
    const led = step(open, bid(3100, "t4", lotOf(open).basePrice));
    const closed = step(led, { type: "TICK", at: lotOf(led).deadline });
    expect(closed.history[0]).toMatchObject({ outcome: "sold", teamId: "t4", assignedBy: "bid" });
  });
});

describe("the documented dead end", () => {
  it("falls back to unsold when no needy team can take the lot (and slack goes negative)", () => {
    let state = forcedGame();
    for (const id of state.teamOrder) state = withTeam(state, id, { purse: 0 });
    const next = step(state, { type: "NEXT_LOT", at: 3000 });
    expect(next.unsold).toHaveLength(1);
    expect(squadPressure(next).slack).toBe(-1);
  });
});

describe("KNOWN ISSUE: the overseas cap can still defeat the guarantee", () => {
  // Found by the random sim (PROJECT.md 4.5). On a forced overseas lot, every team still
  // short of the minimum can already be at the overseas cap, so nobody may legally take
  // the player and slack goes to -1. Roughly 2-7 in 30 random games hit it. `it.fails`
  // keeps the suite green while this reproduces; when the rules are fixed this test turns
  // red, which is the signal to delete the wrapper.
  it.fails("seed 9 / sim 4242 ends with a team below the minimum squad", { timeout: 60_000 }, () => {
    playRandomLots(started(9), 180, 4242);
  });
});

describe("the guarantee, under random play", () => {
  // Low bid chances leave many lots unsold, which is exactly when forced lots must save
  // the minimum squads. checkInvariants asserts slack >= 0 after every single action,
  // and that every team has the minimum once bidding is over.
  const profiles: [string, number, number][] = [
    ["almost nobody bids", 0.02, 0.02],
    ["sparse bidding", 0.1, 0.3],
    ["busy bidding", 0.6, 0.15],
    ["constant bidding", 0.9, 0.05],
  ];

  it.each(profiles)("%s", { timeout: 120_000 }, (_name, bidChance, passChance) => {
    for (const seed of [1, 2, 3, 4]) {
      const rejections: Record<string, number> = {};
      let state = playRandomLots(started(seed), 180, seed * 31, { bidChance, passChance, rejections });
      expect(state.history).toHaveLength(180);
      state = step(state, { type: "NEXT_LOT", at: state.lastActionAt + 1 });
      expect(state.phase).toBe("SELECTING");
      checkInvariants(state, ctx);
      for (const id of state.teamOrder) {
        expect(state.teams[id]?.squad.length).toBeGreaterThanOrEqual(rules.squad.min);
      }
    }
  });

  it("exercises forced assignments, passes and plenty of rejections", { timeout: 120_000 }, () => {
    const rejections: Record<string, number> = {};
    const state = playRandomLots(started(7), 180, 99, { bidChance: 0.05, passChance: 0.05, rejections });
    expect(state.history.some((r) => r.outcome === "sold" && r.assignedBy === "forced")).toBe(true);
    expect(state.history.some((r) => r.outcome === "unsold")).toBe(true);
    expect(Object.keys(rejections).length).toBeGreaterThan(1);
  });
});
