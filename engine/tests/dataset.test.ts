import { describe, expect, it } from "vitest";
import { loadDataset } from "../src/loaders";
import { cloneRaw, expectError, readData, type Raw } from "./helpers";

const FILE = "players.v1.json";
const first = (players: Raw[], pred: (p: Raw) => boolean): Raw => {
  const found = players.find(pred);
  if (!found) throw new Error("test setup: no player matches the predicate");
  return found;
};

describe("loadDataset: the real file", () => {
  it("loads cleanly", () => {
    const result = loadDataset(readData(FILE));
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.value.datasetVersion).toBe(1);
    expect(result.value.players.length).toBeGreaterThan(0);
  });
});

describe("loadDataset: rejects broken data", () => {
  // Each case breaks one rule on a fresh copy of the real file.
  const cases: [string, (d: Raw) => void, string][] = [
    ["duplicate id", (d) => (d.players[1].id = d.players[0].id), "duplicate id"],
    ["malformed id", (d) => (d.players[0].id = "x1"), "id must match"],
    ["unknown tier", (d) => (d.players[0].auctionTier = "Z"), "auctionTier must be one of"],
    ["unknown player type", (d) => (d.players[0].type = "keeper"), "type must be one of"],
    ["score above 100", (d) => (d.players[0].batScore = 101), "batScore must be an integer"],
    ["fractional score", (d) => (d.players[0].fieldScore = 50.5), "fieldScore must be an integer"],
    ["negative score", (d) => (d.players[0].brandAppeal = -1), "brandAppeal must be an integer"],
    ["empty name", (d) => (d.players[0].name = " "), "name must be a non-empty string"],
    ["isKeeper not boolean", (d) => (d.players[0].isKeeper = "yes"), "isKeeper must be true or false"],
    ["unexpected field", (d) => (d.players[0].colour = "blue"), 'unexpected field "colour"'],
    ["dataset version 0", (d) => (d.datasetVersion = 0), "datasetVersion must be an integer"],
    ["empty players", (d) => (d.players = []), "players must be a non-empty array"],
    [
      "batType null on a strong batter",
      (d) => {
        const p = first(d.players, (x) => x.batType !== null && x.batScore > 60);
        p.batType = null;
      },
      "batType is null but batScore",
    ],
    [
      "batType set on a non-batter",
      (d) => {
        const p = first(d.players, (x) => x.batScore <= 20);
        p.batType = "middle";
      },
      "batType is middle but batScore",
    ],
    [
      "bowlingArm without bowlType",
      (d) => {
        const p = first(d.players, (x) => x.bowlType === null);
        p.bowlingArm = "R";
      },
      "bowlingArm must be set exactly when bowlType is set",
    ],
    [
      "bowler with no phases",
      (d) => {
        const p = first(d.players, (x) => x.bowlType !== null);
        p.bowlPhases = [];
      },
      "bowlPhases must be non-empty exactly when bowlType is set",
    ],
    [
      "repeated phase",
      (d) => {
        const p = first(d.players, (x) => x.bowlType !== null);
        p.bowlPhases = ["death", "death"];
      },
      'lists "death" twice',
    ],
    [
      "all-rounder who cannot bowl",
      (d) => {
        const p = first(d.players, (x) => x.type === "all-rounder");
        Object.assign(p, { bowlType: null, bowlingArm: null, bowlPhases: [], bowlScore: 0 });
      },
      "requires a bowlType",
    ],
    [
      "tier with no players",
      (d) => {
        d.players = d.players.filter((p: Raw) => p.auctionTier !== "marquee");
      },
      'no player has auctionTier "marquee"',
    ],
  ];

  it.each(cases)("%s", (_name, mutate, expected) => {
    const data = cloneRaw(FILE);
    mutate(data);
    expectError(loadDataset(data), expected);
  });

  it("rejects non-objects", () => {
    for (const bad of [null, [], "x", 3]) {
      expectError(loadDataset(bad), "expected an object");
    }
  });

  it("reports every problem at once, not just the first", () => {
    const data = cloneRaw(FILE);
    data.players[0].batScore = 500;
    data.players[1].auctionTier = "Z";
    data.players[2].name = "";
    const result = loadDataset(data);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  it("names the offending player in each message", () => {
    const data = cloneRaw(FILE);
    const id = data.players[5].id;
    data.players[5].batScore = 500;
    const result = loadDataset(data);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain(id);
  });
});
