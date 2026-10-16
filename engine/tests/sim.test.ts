import { describe, expect, it } from "vitest";
import { decide, type CpuProfile } from "../src/cpu";
import { playAuction, replayActions } from "../src/sim";
import { ACTION_TYPES } from "../src/constants";
import { ctx, rules, started } from "./fixtures";
import { checkInvariants } from "./invariants";

// Seeds known to avoid the deferred overseas-cap hole (PROJECT.md 4.5 "KNOWN HOLE"):
// about 1 in 10 random games falls into it, and these do not.
const CLEAN_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

const profiles = (n: number, over: Partial<CpuProfile>): CpuProfile[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, seed: i + 1, bidChance: 0.5, passChance: 0.1, ceilingFactor: 2, ...over,
  }));

describe("playAuction: a whole game on the virtual clock", () => {
  it.each(CLEAN_SEEDS)("seed %i runs from START to FINISHED", (seed) => {
    const { state } = playAuction({ ctx, rules, seed });
    expect(state.phase).toBe("FINISHED");
    expect(state.history).toHaveLength(state.lots.length);
    expect(state.meta.startedAt).not.toBeNull();
    expect(state.meta.finishedAt).not.toBeNull();
    for (const id of state.teamOrder) {
      expect(state.teams[id]?.lineup, `${id} lineup`).not.toBeNull();
      expect(state.teams[id]?.squad.length).toBeGreaterThanOrEqual(rules.squad.min);
    }
    checkInvariants(state, ctx);
  });

  it("keeps every invariant after every single action", { timeout: 120_000 }, () => {
    for (const seed of [1, 2, 3]) {
      let steps = 0;
      playAuction({ ctx, rules, seed, onStep: ({ after }) => { steps++; checkInvariants(after, ctx); } });
      expect(steps).toBeGreaterThan(500);
    }
  });

  it("is deterministic, and the seed matters", () => {
    expect(playAuction({ ctx, rules, seed: 4 }).actions).toEqual(playAuction({ ctx, rules, seed: 4 }).actions);
    expect(playAuction({ ctx, rules, seed: 4 }).actions).not.toEqual(playAuction({ ctx, rules, seed: 5 }).actions);
  });

  it("replays exactly: the recorded actions rebuild the same final state", () => {
    const { initial, state, actions } = playAuction({ ctx, rules, seed: 2 });
    expect(initial.phase).toBe("SETUP");
    expect(replayActions(ctx, initial, actions)).toEqual(state);
  });

  it("records only real actions, in time order, using known types", () => {
    const { actions } = playAuction({ ctx, rules, seed: 2 });
    expect(actions[0]?.type).toBe("START");
    expect(actions.at(-1)?.type).toBe("SUBMIT_LINEUP");
    for (const a of actions) expect(ACTION_TYPES).toContain(a.type);
    for (let i = 1; i < actions.length; i++) {
      expect(actions[i]!.at, `action ${i}`).toBeGreaterThanOrEqual(actions[i - 1]!.at);
    }
  });

  it("builds the pool from the game seed, exactly as a plain START would", () => {
    const { state } = playAuction({ ctx, rules, seed: 4 });
    expect(state.seed).toBe(4);
    expect(state.lots).toEqual(started(4).lots);
  });

  it("leaves a pause after each lot before the next one opens", () => {
    const { actions } = playAuction({ ctx, rules, seed: 2 });
    const BANNER_MS = 1500; // the driver's pause for the "SOLD" banner
    const opens = actions.flatMap((a, i) => (a.type === "NEXT_LOT" && i > 1 ? [a.at - actions[i - 1]!.at] : []));
    expect(opens.length).toBeGreaterThan(100);
    for (const gap of opens) expect(gap).toBeGreaterThanOrEqual(BANNER_MS);
  });

  it("ends with a JSON-safe state", () => {
    const { state } = playAuction({ ctx, rules, seed: 2 });
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it("holds real auctions: contested lots, a mix of prices, no overspending", () => {
    const { state } = playAuction({ ctx, rules, seed: 1 });
    const prices = state.history.flatMap((r) => (r.outcome === "sold" ? [r.price] : []));
    expect(Math.max(...prices)).toBeGreaterThan(rules.tierBasePrice.marquee);
    expect(Math.min(...prices)).toBeLessThanOrEqual(rules.tierBasePrice.C * 2);
    for (const id of state.teamOrder) expect(state.teams[id]!.purse).toBeGreaterThanOrEqual(0);
  });
});

describe("playAuction: extreme CPUs", () => {
  it("nobody ever bids: lots go unsold until the forced-lot rule fills every squad", () => {
    const quiet = profiles(rules.teams, { bidChance: 0, passChance: 0 });
    const { state } = playAuction({ ctx, rules, seed: 1, profiles: quiet });
    expect(state.phase).toBe("FINISHED");
    expect(state.unsold).toHaveLength(state.lots.length - rules.teams * rules.squad.min);
    for (const id of state.teamOrder) expect(state.teams[id]?.squad).toHaveLength(rules.squad.min);
    expect(state.history.filter((r) => r.outcome === "sold" && r.assignedBy === "forced")).toHaveLength(
      rules.teams * rules.squad.min,
    );
    checkInvariants(state, ctx);
  });

  it("everybody always bids with no price limit: the game still finishes and no purse goes negative", () => {
    const keen = profiles(rules.teams, { bidChance: 1, passChance: 0, ceilingFactor: 1000 });
    const { state } = playAuction({ ctx, rules, seed: 1, profiles: keen });
    expect(state.phase).toBe("FINISHED");
    for (const id of state.teamOrder) {
      const team = state.teams[id]!;
      expect(team.purse).toBeGreaterThanOrEqual(0);
      const spent = team.squad.reduce((sum, e) => sum + e.price, 0);
      expect(team.purse + spent).toBe(rules.purse);
    }
  });

  // KNOWN ISSUE (PROJECT.md 4.5 "KNOWN HOLE", money variant). Keen CPUs spend nearly the
  // whole purse on the first ~55 lots. The reserve rule only protects the cheapest base
  // price (20) per open slot, so when forced mode starts during the A/B tiers (base 50 and
  // 100) needy teams cannot afford the lot; it goes unsold and teams end below the minimum.
  // Turns red once fixed: delete the wrapper then.
  it.fails("KNOWN ISSUE: free-spending CPUs still end with every team at the minimum squad", () => {
    const keen = profiles(rules.teams, { bidChance: 1, passChance: 0, ceilingFactor: 1000 });
    const { state } = playAuction({ ctx, rules, seed: 1, profiles: keen });
    for (const id of state.teamOrder) {
      expect(state.teams[id]?.squad.length).toBeGreaterThanOrEqual(rules.squad.min);
    }
  });

  it("everybody passes at once: ordinary lots close early, only forced lots wait for the timer", () => {
    const shy = profiles(rules.teams, { bidChance: 0, passChance: 1 });
    const { state, actions } = playAuction({ ctx, rules, seed: 1, profiles: shy });
    expect(state.phase).toBe("FINISHED");
    const forcedLots = rules.teams * rules.squad.min; // passing is not allowed on these
    expect(actions.filter((a) => a.type === "TICK")).toHaveLength(forcedLots);
    expect(state.unsold).toHaveLength(state.lots.length - forcedLots);
  });
});

describe("the CPU only sees what it is allowed to", () => {
  it("every decision is made on a viewFor projection", () => {
    let calls = 0;
    const sawSeed: unknown[] = [];
    const sawLineups: (readonly string[] | null)[] = [];
    playAuction({
      ctx, rules, seed: 1,
      decide: (c, view, teamId, profile, rng, at) => {
        calls++;
        sawSeed.push(view.seed);
        for (const id of view.teamOrder) if (id !== teamId) sawLineups.push(view.teams[id]?.lineup ?? null);
        return decide(c, view, teamId, profile, rng, at);
      },
    });
    expect(calls).toBeGreaterThan(1000);
    expect(new Set(sawSeed)).toEqual(new Set([null])); // the raw state has a numeric seed
    expect(sawLineups.every((l) => l === null)).toBe(true);
  });
});
