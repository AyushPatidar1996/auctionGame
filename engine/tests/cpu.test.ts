import { describe, expect, it } from "vitest";
import {
  chooseLineup,
  decide,
  lineupAction,
  randomProfiles,
  type CpuProfile,
} from "../src/cpu";
import {
  isOverseas,
  lineupError,
  nextBid,
  reduce,
  requiredLineupSize,
  squadPressure,
  viewFor,
} from "../src/engine";
import { createRng } from "../src/random";
import { playAuction } from "../src/sim";
import type { Action, AuctionState, PlayerId, SquadEntry } from "../src/types";
import { ctx, openFirstLot, rules, started, step, withTeam } from "./fixtures";

const profile = (over: Partial<CpuProfile> = {}): CpuProfile => ({
  id: "test",
  seed: 1,
  bidChance: 1,
  passChance: 0,
  ceilingFactor: 100,
  ...over,
});

const at = 3500;
const bid = (teamId: string, amount: number): Action => ({ type: "BID", at, teamId, amount });

describe("randomProfiles", () => {
  it("is deterministic per seed and differs between seeds", () => {
    expect(randomProfiles(3, 10)).toEqual(randomProfiles(3, 10));
    expect(randomProfiles(3, 10)).not.toEqual(randomProfiles(4, 10));
  });

  it("gives every team its own profile, within sensible ranges", () => {
    const profiles = randomProfiles(9, 10);
    expect(new Set(profiles.map((p) => p.id)).size).toBe(10);
    expect(new Set(profiles.map((p) => p.seed)).size).toBe(10);
    for (const p of profiles) {
      expect(p.bidChance).toBeGreaterThanOrEqual(0.3);
      expect(p.bidChance).toBeLessThan(0.7);
      expect(p.passChance).toBeGreaterThanOrEqual(0.05);
      expect(p.passChance).toBeLessThan(0.2);
      expect(p.ceilingFactor).toBeGreaterThanOrEqual(1.5);
      expect(p.ceilingFactor).toBeLessThan(4);
    }
  });
});

describe("decide", () => {
  const rng = () => createRng(5);

  it("waits when no lot is open", () => {
    expect(decide(ctx, started(), "t1", profile(), rng(), at)).toBeNull();
  });

  it("bids the exact next amount, and the reducer accepts it", () => {
    const open = openFirstLot();
    const action = decide(ctx, viewFor(open, "t1"), "t1", profile(), rng(), at);
    expect(action).toEqual({ type: "BID", at, teamId: "t1", amount: nextBid(open) });
    expect(reduce(ctx, open, action as Action).error).toBeNull();
  });

  it("waits when it neither bids nor passes", () => {
    const open = openFirstLot();
    expect(decide(ctx, open, "t1", profile({ bidChance: 0, passChance: 0 }), rng(), at)).toBeNull();
  });

  it("passes when it only wants to drop out", () => {
    const open = openFirstLot();
    const action = decide(ctx, open, "t1", profile({ bidChance: 0, passChance: 1 }), rng(), at);
    expect(action).toEqual({ type: "PASS", at, teamId: "t1" });
  });

  it("steps aside when it cannot afford the bid, which lets the lot close early", () => {
    const open = withTeam(openFirstLot(), "t1", { purse: 0 });
    expect(decide(ctx, open, "t1", profile(), rng(), at)).toEqual({ type: "PASS", at, teamId: "t1" });
  });

  it("does nothing while it is the high bidder", () => {
    const led = step(openFirstLot(), bid("t1", nextBid(openFirstLot()) ?? 0));
    expect(decide(ctx, led, "t1", profile(), rng(), at)).toBeNull();
  });

  it("does nothing after it has passed", () => {
    const passed = step(openFirstLot(), { type: "PASS", at, teamId: "t1" });
    expect(decide(ctx, passed, "t1", profile(), rng(), at)).toBeNull();
  });

  it("drops out once the price passes its ceiling", () => {
    let state = openFirstLot();
    state = step(state, bid("t2", nextBid(state) ?? 0)); // price is now above base
    const stingy = profile({ ceilingFactor: 0 }); // ceiling = base price
    expect(decide(ctx, state, "t1", stingy, rng(), at)).toEqual({ type: "PASS", at, teamId: "t1" });
  });

  it("is deterministic for a given rng", () => {
    const open = openFirstLot();
    const p = profile({ bidChance: 0.5, passChance: 0.3 });
    const run = () => {
      const r = createRng(11);
      return Array.from({ length: 30 }, () => decide(ctx, open, "t1", p, r, at));
    };
    expect(run()).toEqual(run());
  });

  describe("on a forced lot", () => {
    function forcedLot(): AuctionState {
      const s = started(1);
      return step({ ...s, lots: s.lots.slice(0, 150) }, { type: "NEXT_LOT", at: 3000 });
    }

    it("is really forced", () => {
      expect(squadPressure(forcedLot()).forced).toBe(true);
    });

    it("never passes", () => {
      const state = forcedLot();
      expect(decide(ctx, state, "t1", profile({ bidChance: 0, passChance: 1 }), rng(), at)).toBeNull();
      const broke = withTeam(state, "t1", { purse: 0 });
      expect(decide(ctx, broke, "t1", profile(), rng(), at)).toBeNull();
    });

    it("ignores its price ceiling", () => {
      let state = forcedLot();
      state = step(state, bid("t2", nextBid(state) ?? 0));
      const stingy = profile({ ceilingFactor: 0 });
      const action = decide(ctx, state, "t1", stingy, rng(), at);
      expect(action?.type).toBe("BID");
    });
  });
});

// ───── lineups ─────

const home = [...ctx.players.values()].filter((p) => !isOverseas(p, rules)).map((p) => p.id).sort();
const away = [...ctx.players.values()].filter((p) => isOverseas(p, rules)).map((p) => p.id).sort();
const entries = (ids: readonly PlayerId[]): SquadEntry[] =>
  ids.map((playerId, i) => ({ playerId, price: 0, lotIndex: -1 - i }));
const overall = (id: PlayerId) => {
  const p = ctx.players.get(id)!;
  return p.batScore + p.bowlScore + p.fieldScore;
};

/** The game as it stood the moment selection began, captured from a real CPU auction. */
function selectingState(): AuctionState {
  let captured: AuctionState | undefined;
  playAuction({
    ctx,
    rules,
    seed: 3,
    onStep: ({ after }) => {
      if (after.phase === "SELECTING" && !captured) captured = after;
    },
  });
  if (!captured) throw new Error("test setup: never reached SELECTING");
  return captured;
}

describe("chooseLineup", () => {
  it("picks the best players, taking overseas only up to the cap", () => {
    const bestAway = [...away].sort((a, b) => overall(b) - overall(a)).slice(0, 6);
    const homeSquad = home.slice(0, 10);
    const state = withTeam(selectingState(), "t1", { squad: entries([...homeSquad, ...bestAway]) });
    const lineup = chooseLineup(ctx, state, "t1");

    expect(lineup).toHaveLength(12);
    expect(lineup.filter((id) => away.includes(id))).toEqual(bestAway.slice(0, rules.lineup.maxOverseas).sort((a, b) => lineup.indexOf(a) - lineup.indexOf(b)));
    const bestHome = [...homeSquad].sort((a, b) => overall(b) - overall(a)).slice(0, 8);
    for (const id of bestHome) expect(lineup).toContain(id);
  });

  it("is always legal for every team in a real auction", () => {
    const state = selectingState();
    for (const id of state.teamOrder) {
      const lineup = chooseLineup(ctx, state, id);
      expect(lineupError(state, ctx, id, lineup), `${id}`).toBeNull();
    }
  });

  it("names as many as the squad can legally field when that is fewer than 12", () => {
    const squad = [...home.slice(0, 5), ...away.slice(0, 10)]; // 5 home + 4 overseas = 9
    const state = withTeam(selectingState(), "t1", { squad: entries(squad) });
    const team = state.teams["t1"]!;
    expect(requiredLineupSize(rules, ctx, team)).toBe(9);
    expect(chooseLineup(ctx, state, "t1")).toHaveLength(9);
    expect(lineupError(state, ctx, "t1", chooseLineup(ctx, state, "t1"))).toBeNull();
  });

  it("returns an empty lineup for an empty squad", () => {
    const state = withTeam(selectingState(), "t1", { squad: [] });
    expect(chooseLineup(ctx, state, "t1")).toEqual([]);
  });
});

describe("lineupAction", () => {
  it("submits the chosen lineup during selection", () => {
    const state = selectingState();
    expect(lineupAction(ctx, state, "t1", 9000)).toEqual({
      type: "SUBMIT_LINEUP",
      at: 9000,
      teamId: "t1",
      playerIds: chooseLineup(ctx, state, "t1"),
    });
  });

  it("does nothing outside selection or once submitted", () => {
    expect(lineupAction(ctx, started(), "t1", 9000)).toBeNull();
    const state = selectingState();
    const done = step(state, lineupAction(ctx, state, "t1", state.lastActionAt + 1) as Action);
    expect(lineupAction(ctx, done, "t1", done.lastActionAt + 1)).toBeNull();
  });
});

describe("viewFor", () => {
  function withLineups(): AuctionState {
    let state = selectingState();
    for (const id of ["t1", "t2"]) {
      state = step(state, lineupAction(ctx, state, id, state.lastActionAt + 1) as Action);
    }
    return state;
  }

  it("hides the seed", () => {
    const state = started(5);
    expect(state.seed).toBe(5);
    expect(viewFor(state, "t1").seed).toBeNull();
  });

  it("hides other teams' lineups during selection, but not the viewer's own", () => {
    const state = withLineups();
    const view = viewFor(state, "t1");
    expect(view.teams["t1"]?.lineup).toEqual(state.teams["t1"]?.lineup);
    expect(view.teams["t2"]?.lineup).toBeNull();
    expect(view.teams["t3"]?.lineup).toBeNull();
  });

  it("hides every lineup from a spectator", () => {
    const view = viewFor(withLineups(), null);
    for (const id of view.teamOrder) expect(view.teams[id]?.lineup).toBeNull();
  });

  it("shows everything else, including every squad and purse", () => {
    const state = withLineups();
    const view = viewFor(state, "t1");
    for (const id of state.teamOrder) {
      expect(view.teams[id]?.squad).toEqual(state.teams[id]?.squad);
      expect(view.teams[id]?.purse).toBe(state.teams[id]?.purse);
    }
    expect(view.lots).toEqual(state.lots); // upcoming lots are public
    expect(view.history).toEqual(state.history);
  });

  it("changes only the seed outside selection", () => {
    const open = openFirstLot();
    expect(viewFor(open, "t1")).toEqual({ ...open, seed: null });
  });

  it("never modifies the state", () => {
    const state = withLineups();
    const snapshot = structuredClone(state);
    viewFor(state, "t1");
    expect(state).toEqual(snapshot);
  });
});
