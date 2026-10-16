import { describe, expect, it } from "vitest";
import { reduce } from "../src/engine";
import type { Action, AuctionState } from "../src/types";
import { ctx, openFirstLot, rules, step, withTeam } from "./fixtures";

const pass = (at: number, teamId: string): Action => ({ type: "PASS", at, teamId });
const bid = (at: number, teamId: string, amount: number): Action => ({ type: "BID", at, teamId, amount });

function lotOf(state: AuctionState) {
  if (!state.lot) throw new Error("test setup: no open lot");
  return state.lot;
}

const others = (except: string[]): string[] =>
  Array.from({ length: rules.teams }, (_, i) => `t${i + 1}`).filter((id) => !except.includes(id));

describe("PASS", () => {
  it("records the pass and keeps the lot open while someone can still bid", () => {
    const open = openFirstLot();
    const state = step(open, pass(3500, "t2"));
    expect(lotOf(state).passed).toEqual(["t2"]);
    expect(state.phase).toBe("LOT_OPEN");
    expect(state.revision).toBe(open.revision + 1);
    expect(state.lastActionAt).toBe(3500);
    expect(lotOf(state).deadline).toBe(lotOf(open).deadline); // passing does not extend the clock
  });

  it("stops the passing team from bidding on that lot", () => {
    const state = step(openFirstLot(), pass(3500, "t2"));
    const result = reduce(ctx, state, bid(3600, "t2", lotOf(state).basePrice));
    expect(result.error).toBe("HAS_PASSED");
  });

  it("does not stop other teams from bidding", () => {
    const state = step(openFirstLot(), pass(3500, "t2"));
    const next = step(state, bid(3600, "t3", lotOf(state).basePrice));
    expect(lotOf(next).highBid?.teamId).toBe("t3");
  });

  it("does not modify the state it was given", () => {
    const open = openFirstLot();
    const snapshot = structuredClone(open);
    step(open, pass(3500, "t2"));
    expect(open).toEqual(snapshot);
  });
});

describe("PASS: rejections leave the state untouched", () => {
  it("outside an open lot", () => {
    const open = openFirstLot();
    const closed = step(open, { type: "TICK", at: lotOf(open).deadline });
    expect(reduce(ctx, closed, pass(99999, "t1")).error).toBe("WRONG_PHASE");
  });

  it("unknown team", () => {
    expect(reduce(ctx, openFirstLot(), pass(3500, "nope")).error).toBe("UNKNOWN_TEAM");
  });

  it("at or after the deadline", () => {
    const open = openFirstLot();
    expect(reduce(ctx, open, pass(lotOf(open).deadline, "t1")).error).toBe("LOT_EXPIRED");
  });

  it("when time goes backwards", () => {
    expect(reduce(ctx, openFirstLot(1, 3000), pass(2999, "t1")).error).toBe("TIME_WENT_BACKWARDS");
  });

  it("twice by the same team", () => {
    const state = step(openFirstLot(), pass(3500, "t2"));
    expect(reduce(ctx, state, pass(3600, "t2")).error).toBe("ALREADY_PASSED");
  });

  it("by the current high bidder", () => {
    const open = openFirstLot();
    const state = step(open, bid(3500, "t1", lotOf(open).basePrice));
    expect(reduce(ctx, state, pass(3600, "t1")).error).toBe("HIGH_BIDDER_CANNOT_PASS");
  });

  it("returns the same state object", () => {
    const open = openFirstLot();
    expect(reduce(ctx, open, pass(3500, "nope")).state).toBe(open);
  });
});

describe("early close", () => {
  it("ends the lot unsold when every team passes (and not before)", () => {
    let state = openFirstLot();
    const ids = others([]);
    ids.slice(0, -1).forEach((id, i) => {
      state = step(state, pass(3500 + i, id));
      expect(state.phase).toBe("LOT_OPEN");
    });
    const last = ids[ids.length - 1] as string;
    state = step(state, pass(3600, last));
    expect(state.phase).toBe("BETWEEN_LOTS");
    expect(state.lot).toBeNull();
    expect(state.history[0]).toMatchObject({ outcome: "unsold", closedAt: 3600 });
    expect(state.unsold).toHaveLength(1);
  });

  it("sells to the leader when everyone else has passed (and not before)", () => {
    const open = openFirstLot();
    const base = lotOf(open).basePrice;
    let state = step(open, bid(3500, "t1", base));
    const rest = others(["t1"]);
    rest.slice(0, -1).forEach((id, i) => {
      state = step(state, pass(3600 + i, id));
      expect(state.phase).toBe("LOT_OPEN");
    });
    state = step(state, pass(3700, rest[rest.length - 1] as string));
    expect(state.phase).toBe("BETWEEN_LOTS");
    expect(state.history[0]).toMatchObject({ outcome: "sold", teamId: "t1", price: base, assignedBy: "bid" });
    expect(state.teams["t1"]?.purse).toBe(rules.purse - base);
  });

  it("sells at once when a bid leaves nobody able to outbid it", () => {
    let open = openFirstLot();
    for (const id of others(["t1"])) open = withTeam(open, id, { purse: 0 });
    const state = step(open, bid(3500, "t1", lotOf(open).basePrice));
    expect(state.phase).toBe("BETWEEN_LOTS");
    expect(state.history[0]).toMatchObject({ outcome: "sold", teamId: "t1" });
  });

  it("does not wait for teams that cannot outbid anyway", () => {
    let open = openFirstLot();
    for (const id of others(["t1", "t3"])) open = withTeam(open, id, { purse: 0 });
    let state = step(open, bid(3500, "t1", lotOf(open).basePrice));
    expect(state.phase).toBe("LOT_OPEN"); // t3 could still outbid
    state = step(state, pass(3600, "t3"));
    expect(state.phase).toBe("BETWEEN_LOTS");
    expect(state.history[0]).toMatchObject({ outcome: "sold", teamId: "t1" });
  });

  it("counts one action once: a closing pass bumps the revision by exactly 1", () => {
    let open = openFirstLot();
    for (const id of others(["t1", "t3"])) open = withTeam(open, id, { purse: 0 });
    const led = step(open, bid(3500, "t1", lotOf(open).basePrice));
    const closed = step(led, pass(3600, "t3"));
    expect(closed.revision).toBe(led.revision + 1);
  });
});
