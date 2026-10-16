import { describe, expect, it } from "vitest";
import {
  canBid,
  incrementAt,
  nextBid,
  reduce,
  squadPressure,
} from "../src/engine";
import type { Action, AuctionState, RuleSet } from "../src/types";
import { checkInvariants } from "./invariants";
import {
  ctx,
  newGame,
  openFirstLot,
  rules,
  started,
  step,
  tierOf,
  withTeam,
} from "./fixtures";
import { playRandomLots } from "./sim";

const bid = (at: number, teamId: string, amount: number): Action => ({
  type: "BID",
  at,
  teamId,
  amount,
});

function lotOf(state: AuctionState) {
  if (!state.lot) throw new Error("test setup: no open lot");
  return state.lot;
}

describe("incrementAt / nextBid", () => {
  it("uses the band the current price sits in", () => {
    // rules.default: <50 step 5, <100 step 10, <500 step 25, then 50
    const cases: [number, number][] = [
      [20, 5], [45, 5], [50, 10], [90, 10], [100, 25], [475, 25], [500, 50], [900, 50],
    ];
    for (const [price, step] of cases) expect(incrementAt(rules, price), `at ${price}`).toBe(step);
  });

  it("is null when no lot is open", () => {
    expect(nextBid(started())).toBeNull();
  });

  it("is the base price before any bid, then climbs by the band step", () => {
    let state = openFirstLot();
    const base = lotOf(state).basePrice;
    expect(nextBid(state)).toBe(base);
    state = step(state, bid(3100, "t1", base));
    expect(nextBid(state)).toBe(base + incrementAt(rules, base));
  });

  it("steps across a band boundary correctly", () => {
    const state = openFirstLot();
    const lot = lotOf(state);
    const at90: AuctionState = { ...state, lot: { ...lot, highBid: { teamId: "t1", amount: 90 } } };
    const at100: AuctionState = { ...state, lot: { ...lot, highBid: { teamId: "t1", amount: 100 } } };
    expect(nextBid(at90)).toBe(100);
    expect(nextBid(at100)).toBe(125);
  });
});

describe("squadPressure", () => {
  it("starts with plenty of slack", () => {
    expect(squadPressure(started())).toEqual({ needed: 150, left: 180, slack: 30, forced: false });
  });

  it("counts the open lot as still to sell", () => {
    expect(squadPressure(openFirstLot())).toMatchObject({ left: 180, needed: 150, forced: false });
  });

  it("is forced when lots left equal the slots needed", () => {
    const state = openFirstLot();
    const trimmed: AuctionState = { ...state, lots: state.lots.slice(0, 150) };
    expect(squadPressure(trimmed)).toMatchObject({ left: 150, needed: 150, slack: 0, forced: true });
  });
});

describe("NEXT_LOT", () => {
  it("opens the first lot at the tier's base price with a fresh deadline", () => {
    const before = started();
    const state = step(before, { type: "NEXT_LOT", at: 3000 });
    const lot = lotOf(state);
    expect(state.phase).toBe("LOT_OPEN");
    expect(state.lotIndex).toBe(0);
    expect(state.revision).toBe(before.revision + 1);
    expect(lot.playerId).toBe(before.lots[0]);
    expect(lot.basePrice).toBe(rules.tierBasePrice[tierOf(lot.playerId)]);
    expect(lot).toMatchObject({ highBid: null, passed: [] });
    expect(lot.deadline).toBe(3000 + rules.timer.bidWindowMs);
    expect(state.lastActionAt).toBe(3000);
  });

  it("is rejected outside BETWEEN_LOTS", () => {
    expect(reduce(ctx, newGame(), { type: "NEXT_LOT", at: 3000 }).error).toBe("WRONG_PHASE");
    expect(reduce(ctx, openFirstLot(), { type: "NEXT_LOT", at: 4000 }).error).toBe("WRONG_PHASE");
  });

  it("is rejected when time goes backwards", () => {
    expect(reduce(ctx, started(), { type: "NEXT_LOT", at: 1999 }).error).toBe("TIME_WENT_BACKWARDS");
  });

  it("closes a lot unsold at once when no team can bid the base price", () => {
    let state = started();
    for (const id of state.teamOrder) state = withTeam(state, id, { purse: 0 });
    const next = step(state, { type: "NEXT_LOT", at: 3000 });
    expect(next.phase).toBe("BETWEEN_LOTS");
    expect(next.lot).toBeNull();
    expect(next.lotIndex).toBe(0);
    expect(next.unsold).toEqual([state.lots[0]]);
    expect(next.history).toHaveLength(1);
    expect(next.revision).toBe(state.revision + 1);
  });

  it("moves to SELECTING after the last lot", () => {
    let state = started();
    let now = 3000;
    // Nobody ever bids. The first 30 lots (the pool's slack) go unsold; after that the
    // forced-lot rule hands every remaining lot to a team still short of its minimum.
    for (let i = 0; i < state.lots.length; i++) {
      state = step(state, { type: "NEXT_LOT", at: now });
      now = lotOf(state).deadline;
      state = step(state, { type: "TICK", at: now });
    }
    expect(state.unsold).toHaveLength(30);
    state = step(state, { type: "NEXT_LOT", at: now + 1 });
    expect(state.phase).toBe("SELECTING");
    expect(state.lot).toBeNull();
    checkInvariants(state, ctx);
  });
});

describe("BID: the happy path", () => {
  it("sets the high bid and moves the deadline", () => {
    const open = openFirstLot();
    const base = lotOf(open).basePrice;
    const state = step(open, bid(5000, "t2", base));
    expect(lotOf(state).highBid).toEqual({ teamId: "t2", amount: base });
    expect(lotOf(state).deadline).toBe(5000 + rules.timer.bidWindowMs);
    expect(state.revision).toBe(open.revision + 1);
    expect(state.lastActionAt).toBe(5000);
  });

  it("lets teams outbid each other up the ladder", () => {
    let state = openFirstLot();
    let amount = lotOf(state).basePrice;
    for (let i = 0; i < 8; i++) {
      const teamId = i % 2 === 0 ? "t1" : "t2";
      state = step(state, bid(4000 + i, teamId, amount));
      expect(lotOf(state).highBid).toEqual({ teamId, amount });
      amount = nextBid(state) ?? -1;
    }
  });

  it("keeps the deadline when resetOnBid is off", () => {
    const fixed: RuleSet = { ...rules, timer: { ...rules.timer, resetOnBid: false } };
    const started0 = step(newGame({ rules: fixed }), {
      type: "START", at: 2000, seed: 1,
      teams: Array.from({ length: fixed.teams }, (_, i) => ({
        id: `t${i + 1}`, name: `T${i + 1}`, kind: "cpu" as const, profileId: null, participantId: null,
      })),
    });
    const open = step(started0, { type: "NEXT_LOT", at: 3000 });
    const state = step(open, bid(5000, "t1", lotOf(open).basePrice));
    expect(lotOf(state).deadline).toBe(lotOf(open).deadline);
  });

  it("does not modify the state it was given", () => {
    const open = openFirstLot();
    const snapshot = structuredClone(open);
    step(open, bid(5000, "t1", lotOf(open).basePrice));
    expect(open).toEqual(snapshot);
  });
});

describe("BID: rejections leave the state untouched", () => {
  const base = () => lotOf(openFirstLot()).basePrice;

  it("outside an open lot", () => {
    expect(reduce(ctx, started(), bid(3000, "t1", 20)).error).toBe("WRONG_PHASE");
  });

  it("unknown team", () => {
    expect(reduce(ctx, openFirstLot(), bid(3500, "nope", base())).error).toBe("UNKNOWN_TEAM");
  });

  it("after the deadline", () => {
    const open = openFirstLot();
    expect(reduce(ctx, open, bid(lotOf(open).deadline, "t1", base())).error).toBe("LOT_EXPIRED");
  });

  it("when time goes backwards", () => {
    const open = openFirstLot(1, 3000);
    expect(reduce(ctx, open, bid(2999, "t1", base())).error).toBe("TIME_WENT_BACKWARDS");
  });

  it("when the team already leads", () => {
    const state = step(openFirstLot(), bid(3500, "t1", base()));
    const next = nextBid(state) ?? -1;
    expect(reduce(ctx, state, bid(3600, "t1", next)).error).toBe("ALREADY_HIGHEST");
  });

  it("when the amount is not the next bid (too low, too high, repeated)", () => {
    const open = openFirstLot();
    const b = base();
    expect(reduce(ctx, open, bid(3500, "t1", b - 5)).error).toBe("STALE_AMOUNT");
    expect(reduce(ctx, open, bid(3500, "t1", b + 5)).error).toBe("STALE_AMOUNT");
    const led = step(open, bid(3500, "t1", b));
    expect(reduce(ctx, led, bid(3600, "t2", b)).error).toBe("STALE_AMOUNT"); // the double-click case
  });

  it("when the team cannot afford the amount", () => {
    const open = withTeam(openFirstLot(), "t1", { purse: base() - 1 });
    expect(reduce(ctx, open, bid(3500, "t1", base())).error).toBe("INSUFFICIENT_PURSE");
  });

  it("when paying would break the reserve for the minimum squad", () => {
    const b = base();
    const needed = b + 14 * 20; // this bid plus 14 more players at the cheapest base price
    const short = withTeam(openFirstLot(), "t1", { purse: needed - 1 });
    const enough = withTeam(openFirstLot(), "t1", { purse: needed });
    expect(reduce(ctx, short, bid(3500, "t1", b)).error).toBe("RESERVE_VIOLATION");
    expect(reduce(ctx, enough, bid(3500, "t1", b)).error).toBeNull();
  });

  it("when the squad is full", () => {
    const open = openFirstLot();
    const filler = [...ctx.players.values()]
      .filter((p) => p.nationality === rules.homeCountry && p.id !== lotOf(open).playerId)
      .slice(0, rules.squad.max)
      .map((p, i) => ({ playerId: p.id, price: 0, lotIndex: i }));
    const full = withTeam(open, "t1", { squad: filler });
    expect(reduce(ctx, full, bid(3500, "t1", base())).error).toBe("SQUAD_FULL");
  });

  it("when the overseas cap is reached and the lot player is overseas", () => {
    const open = openFirstLot();
    const overseas = [...ctx.players.values()].filter((p) => p.nationality !== rules.homeCountry);
    const lotPlayer = overseas[0];
    if (!lotPlayer) throw new Error("test setup: no overseas player");
    const onLot: AuctionState = { ...open, lot: { ...lotOf(open), playerId: lotPlayer.id } };
    const squad = overseas.slice(1, 1 + rules.squad.maxOverseas).map((p, i) => ({
      playerId: p.id, price: 0, lotIndex: i,
    }));
    const capped = withTeam(onLot, "t1", { squad });
    const oneShort = withTeam(onLot, "t1", { squad: squad.slice(1) });
    expect(reduce(ctx, capped, bid(3500, "t1", base())).error).toBe("OVERSEAS_CAP");
    expect(reduce(ctx, oneShort, bid(3500, "t1", base())).error).toBeNull();
  });

  it("returns the same state object", () => {
    const open = openFirstLot();
    expect(reduce(ctx, open, bid(3500, "nope", base())).state).toBe(open);
  });
});

describe("canBid agrees with the reducer", () => {
  it("accepts exactly when canBid says null", () => {
    const open = openFirstLot();
    const b = lotOf(open).basePrice;
    for (const amount of [b - 5, b, b + 5]) {
      for (const teamId of ["t1", "nope"]) {
        const predicted = canBid(open, ctx, teamId, amount, 3500);
        expect(reduce(ctx, open, bid(3500, teamId, amount)).error).toBe(predicted);
      }
    }
  });
});

describe("TICK and closing a lot", () => {
  it("sells the player to the high bidder and charges the purse", () => {
    const open = openFirstLot();
    const lot = lotOf(open);
    let state = step(open, bid(3500, "t1", lot.basePrice));
    state = step(state, bid(3600, "t2", nextBid(state) ?? -1));
    const price = lotOf(state).highBid?.amount ?? -1;
    const closed = step(state, { type: "TICK", at: lotOf(state).deadline });

    expect(closed.phase).toBe("BETWEEN_LOTS");
    expect(closed.lot).toBeNull();
    expect(closed.teams["t2"]?.purse).toBe(rules.purse - price);
    expect(closed.teams["t2"]?.squad).toEqual([{ playerId: lot.playerId, price, lotIndex: 0 }]);
    expect(closed.teams["t1"]).toMatchObject({ purse: rules.purse, squad: [] });
    expect(closed.history).toEqual([
      {
        playerId: lot.playerId, basePrice: lot.basePrice, closedAt: lotOf(state).deadline,
        outcome: "sold", teamId: "t2", price, assignedBy: "bid",
      },
    ]);
    checkInvariants(closed, ctx);
  });

  it("marks the player unsold when nobody bid", () => {
    const open = openFirstLot();
    const lot = lotOf(open);
    const closed = step(open, { type: "TICK", at: lot.deadline });
    expect(closed.unsold).toEqual([lot.playerId]);
    expect(closed.history[0]).toMatchObject({ outcome: "unsold", playerId: lot.playerId });
    expect(Object.values(closed.teams).every((t) => t.squad.length === 0)).toBe(true);
    checkInvariants(closed, ctx);
  });

  it("is a no-op before the deadline, in any phase", () => {
    const open = openFirstLot();
    const early = reduce(ctx, open, { type: "TICK", at: lotOf(open).deadline - 1 });
    expect(early).toEqual({ state: open, error: null });
    expect(early.state).toBe(open);
    const idle = started();
    expect(reduce(ctx, idle, { type: "TICK", at: 9999999 }).state).toBe(idle);
  });

  it("rejects a closing tick that goes back in time", () => {
    // Unreachable through normal play (only a rejected action can follow a deadline),
    // so build the state by hand to prove the guard works.
    const open = openFirstLot(1, 3000);
    const deadline = lotOf(open).deadline;
    const odd: AuctionState = { ...open, lastActionAt: deadline + 10 };
    const result = reduce(ctx, odd, { type: "TICK", at: deadline });
    expect(result.error).toBe("TIME_WENT_BACKWARDS");
    expect(result.state).toBe(odd);
  });

  it("lets the next lot open afterwards", () => {
    const open = openFirstLot();
    const closed = step(open, { type: "TICK", at: lotOf(open).deadline });
    const second = step(closed, { type: "NEXT_LOT", at: lotOf(open).deadline + 1 });
    expect(second.lotIndex).toBe(1);
    expect(lotOf(second).playerId).toBe(second.lots[1]);
  });
});

describe("a whole auction under random bidding keeps every invariant", () => {
  it.each([1, 2, 3])("seed %i: 40 lots, invariants checked after every action", (seed) => {
    const state = playRandomLots(started(seed), 40, seed * 101);
    expect(state.history).toHaveLength(40);
    expect(state.history.some((r) => r.outcome === "sold")).toBe(true);
    checkInvariants(state, ctx);
  });

  it("plays all 180 lots, then moves to SELECTING", { timeout: 60_000 }, () => {
    let state = playRandomLots(started(1), 180, 101);
    expect(state.history).toHaveLength(180);
    state = step(state, { type: "NEXT_LOT", at: state.lastActionAt + 1 });
    expect(state.phase).toBe("SELECTING");
    checkInvariants(state, ctx);
  });

  it("is deterministic: the same seeds replay the same auction", () => {
    const a = playRandomLots(started(5), 30, 777);
    const b = playRandomLots(started(5), 30, 777);
    expect(a).toEqual(b);
  });
});
