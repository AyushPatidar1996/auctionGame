import { expect } from "vitest";
import { nextBid, reduce } from "../src/engine";
import { createRng } from "../src/random";
import type { Action, AuctionState } from "../src/types";
import { ctx, step } from "./fixtures";
import { checkInvariants } from "./invariants";

export interface SimOptions {
  /** Chance an attempt is a bid (the rest of the attempts are passes or nothing). */
  readonly bidChance?: number;
  readonly passChance?: number;
  /** Counts of every rejection reason seen, filled in as the sim runs. */
  readonly rejections?: Record<string, number>;
}

/**
 * Plays whole lots with random teams firing blind actions at the reducer (legal and
 * illegal), then lets the clock run out. After every accepted action the invariants are
 * checked; every rejected action must leave the state object untouched. Not a CPU
 * strategy, just enough traffic to shake out bookkeeping bugs.
 */
export function playRandomLots(
  start: AuctionState,
  lotCount: number,
  seed: number,
  options: SimOptions = {},
): AuctionState {
  const { bidChance = 0.5, passChance = 0.15, rejections } = options;
  const rng = createRng(seed);
  let state = start;
  let now = state.lastActionAt;

  const attempt = (action: Action): void => {
    const result = reduce(ctx, state, action);
    if (result.error) {
      expect(result.state, `${action.type} rejected as ${result.error}`).toBe(state);
      if (rejections) rejections[result.error] = (rejections[result.error] ?? 0) + 1;
      return;
    }
    expect(result.state.revision).toBe(state.revision + 1);
    state = result.state;
    checkInvariants(state, ctx);
  };

  for (let n = 0; n < lotCount && state.lotIndex + 1 < state.lots.length; n++) {
    now += 1000;
    state = step(state, { type: "NEXT_LOT", at: now });
    checkInvariants(state, ctx);

    const attempts = Math.floor(rng() * 14);
    for (let i = 0; i < attempts && state.phase === "LOT_OPEN"; i++) {
      const teamId = state.teamOrder[Math.floor(rng() * state.teamOrder.length)];
      const amount = nextBid(state);
      if (teamId === undefined || amount === null) break;
      now += 1;
      const roll = rng();
      if (roll < passChance) {
        attempt({ type: "PASS", at: now, teamId });
      } else if (roll < passChance + bidChance) {
        const wrong = rng() < 0.1; // sometimes a stale amount, to exercise rejections
        attempt({ type: "BID", at: now, teamId, amount: wrong ? amount + 1 : amount });
      }
    }

    if (state.phase === "LOT_OPEN" && state.lot) {
      now = state.lot.deadline;
      state = step(state, { type: "TICK", at: now });
      checkInvariants(state, ctx);
    }
  }
  return state;
}
