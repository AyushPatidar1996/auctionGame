import { describe, expect, it } from "vitest";
import { createRng, deriveSeed, pickIndex, shuffled } from "../src/random";

const take = (rng: () => number, n: number): number[] =>
  Array.from({ length: n }, () => rng());

describe("createRng", () => {
  it("replays the same sequence for the same seed", () => {
    expect(take(createRng(42), 20)).toEqual(take(createRng(42), 20));
  });

  it("gives different sequences for different seeds", () => {
    expect(take(createRng(1), 5)).not.toEqual(take(createRng(2), 5));
  });

  it("stays within [0, 1)", () => {
    for (const value of take(createRng(7), 2000)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("is roughly uniform", () => {
    const values = take(createRng(123), 10000);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
  });
});

describe("deriveSeed", () => {
  it("is stable", () => {
    expect(deriveSeed(5, "pool", "A")).toBe(deriveSeed(5, "pool", "A"));
  });

  it("changes with the seed and with each label", () => {
    const base = deriveSeed(5, "pool", "A");
    expect(deriveSeed(6, "pool", "A")).not.toBe(base);
    expect(deriveSeed(5, "pool", "B")).not.toBe(base);
    expect(deriveSeed(5, "forced", "A")).not.toBe(base);
  });

  it("returns an unsigned 32-bit integer", () => {
    const seed = deriveSeed(-3, "x", 9);
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(2 ** 32);
  });
});

describe("shuffled", () => {
  const items = Array.from({ length: 50 }, (_, i) => i);

  it("returns a permutation and leaves the input alone", () => {
    const copy = [...items];
    const result = shuffled(items, createRng(9));
    expect(items).toEqual(copy);
    expect([...result].sort((a, b) => a - b)).toEqual(items);
  });

  it("actually reorders", () => {
    expect(shuffled(items, createRng(9))).not.toEqual(items);
  });

  it("is deterministic per seed", () => {
    expect(shuffled(items, createRng(3))).toEqual(shuffled(items, createRng(3)));
    expect(shuffled(items, createRng(3))).not.toEqual(shuffled(items, createRng(4)));
  });

  it("handles empty and single-item lists", () => {
    expect(shuffled([], createRng(1))).toEqual([]);
    expect(shuffled(["a"], createRng(1))).toEqual(["a"]);
  });
});

describe("pickIndex", () => {
  it("is deterministic and in range", () => {
    expect(pickIndex(11, 7, "forced", 3)).toBe(pickIndex(11, 7, "forced", 3));
    for (let lot = 0; lot < 200; lot++) {
      const index = pickIndex(11, 7, "forced", lot);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(7);
    }
  });

  it("uses every slot over many lots", () => {
    const seen = new Set<number>();
    for (let lot = 0; lot < 300; lot++) seen.add(pickIndex(11, 5, "forced", lot));
    expect(seen.size).toBe(5);
  });
});
