import { describe, expect, it } from "vitest";
import { loadRules } from "../src/loaders";
import { cloneRaw, expectError, readData, type Raw } from "./helpers";

const FILE = "rules.default.json";

describe("loadRules: the real file", () => {
  it("loads cleanly", () => {
    const result = loadRules(readData(FILE));
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.value.teams).toBe(10);
    expect(result.value.squad).toEqual({ min: 15, max: 25, maxOverseas: 8 });
    expect(result.value.increments.at(-1)?.upTo).toBeNull();
  });
});

describe("loadRules: rejects broken rules", () => {
  const cases: [string, (r: Raw) => void, string][] = [
    ["unexpected field", (r) => (r.extra = 1), 'unexpected field "extra"'],
    ["unknown currency", (r) => (r.currency = "usd"), "currency must be one of"],
    ["unknown lot order", (r) => (r.lotOrder = "random"), "lotOrder must be one of"],
    ["single team", (r) => (r.teams = 1), "teams must be an integer"],
    ["fractional purse", (r) => (r.purse = 100.5), "purse must be an integer"],
    ["squad min above max", (r) => (r.squad.min = 30), "squad.min must not exceed squad.max"],
    [
      "squad overseas above max",
      (r) => (r.squad.maxOverseas = 30),
      "squad.maxOverseas must not exceed squad.max",
    ],
    ["lineup larger than min squad", (r) => (r.lineup.size = 20), "lineup.size must not exceed squad.min"],
    [
      "lineup overseas above lineup size",
      (r) => (r.lineup.maxOverseas = 13),
      "lineup.maxOverseas must not exceed lineup.size",
    ],
    [
      "lineup overseas above squad overseas",
      (r) => {
        r.squad.maxOverseas = 3;
        r.lineup.maxOverseas = 4;
      },
      "lineup.maxOverseas must not exceed squad.maxOverseas",
    ],
    ["missing tier base price", (r) => delete r.tierBasePrice.A, "tierBasePrice"],
    ["unknown tier key", (r) => (r.tierBasePrice.D = 10), 'unexpected field "D"'],
    [
      "base price off the step grid",
      (r) => (r.tierBasePrice.C = 22),
      "must be a multiple of 5",
    ],
    ["tier order missing a tier", (r) => (r.tierOrder = ["marquee", "A", "B"]), "every tier exactly once"],
    ["tier order repeats a tier", (r) => (r.tierOrder = ["marquee", "A", "B", "B"]), "every tier exactly once"],
    ["increments empty", (r) => (r.increments = []), "expected a non-empty array"],
    [
      "increments do not end in null",
      (r) => (r.increments[3].upTo = 1000),
      "exactly one band may have upTo null",
    ],
    [
      "two null bands",
      (r) => (r.increments[2].upTo = null),
      "exactly one band may have upTo null",
    ],
    [
      "increment bounds out of order",
      (r) => {
        r.increments[0].upTo = 200;
        r.increments[0].step = 5;
      },
      "strictly increasing",
    ],
    ["upTo not a multiple of step", (r) => (r.increments[0].upTo = 52), "must be a multiple of its step"],
    [
      "purse cannot fund the minimum squad",
      (r) => (r.purse = 100),
      "cannot cover squad.min",
    ],
    [
      "pool too small for the minimum squads",
      (r) => (r.pool.composition.C = 0),
      "below teams x squad.min",
    ],
    ["negative pool count", (r) => (r.pool.composition.A = -1), "composition: A must be an integer"],
    ["zero bid window", (r) => (r.timer.bidWindowMs = 0), "bidWindowMs must be an integer"],
    ["resetOnBid not boolean", (r) => (r.timer.resetOnBid = "yes"), "resetOnBid must be true or false"],
  ];

  it.each(cases)("%s", (_name, mutate, expected) => {
    const rules = cloneRaw(FILE);
    mutate(rules);
    expectError(loadRules(rules), expected);
  });

  it("rejects non-objects", () => {
    for (const bad of [null, [], "x", 3]) {
      expectError(loadRules(bad), "expected an object");
    }
  });

  it("reports every problem at once, not just the first", () => {
    const rules = cloneRaw(FILE);
    rules.teams = 1;
    rules.currency = "usd";
    rules.timer.bidWindowMs = 0;
    const result = loadRules(rules);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});
