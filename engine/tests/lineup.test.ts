import { describe, expect, it } from "vitest";
import { isOverseas, lineupError, reduce, requiredLineupSize } from "../src/engine";
import type { Action, AuctionState, PlayerId, SquadEntry, TeamId } from "../src/types";
import { ctx, rules, started, step, withTeam } from "./fixtures";
import { checkInvariants } from "./invariants";
import { playRandomLots } from "./sim";

const submit = (at: number, teamId: TeamId, playerIds: readonly PlayerId[]): Action => ({
  type: "SUBMIT_LINEUP",
  at,
  teamId,
  playerIds,
});

const home = [...ctx.players.values()].filter((p) => !isOverseas(p, rules)).map((p) => p.id).sort();
const away = [...ctx.players.values()].filter((p) => isOverseas(p, rules)).map((p) => p.id).sort();
const entries = (ids: readonly PlayerId[]): SquadEntry[] =>
  ids.map((playerId, i) => ({ playerId, price: 0, lotIndex: -1 - i }));

/** A SELECTING game whose squads came from a real (random-bid) auction. Built once. */
let cached: AuctionState | undefined;
function selecting(): AuctionState {
  if (!cached) {
    const done = playRandomLots(started(1), 180, 101);
    cached = step(done, { type: "NEXT_LOT", at: done.lastActionAt + 1 });
  }
  return cached;
}

/** SELECTING with t1 holding exactly this squad (invariants do not apply to rigged squads). */
function selectingWith(squad: readonly PlayerId[]): AuctionState {
  return withTeam(selecting(), "t1", { squad: entries(squad), lineup: null });
}

/** Any legal lineup for a team: home players first, then overseas up to the cap. */
function legalLineup(state: AuctionState, teamId: TeamId): PlayerId[] {
  const team = state.teams[teamId];
  if (!team) throw new Error(`no team ${teamId}`);
  const size = requiredLineupSize(rules, ctx, team);
  const ids = team.squad.map((e) => e.playerId);
  const isAway = (id: PlayerId) => isOverseas(ctx.players.get(id)!, rules);
  const picked = [
    ...ids.filter((id) => !isAway(id)),
    ...ids.filter(isAway).slice(0, rules.lineup.maxOverseas),
  ];
  return picked.slice(0, size);
}

describe("requiredLineupSize", () => {
  const sizeFor = (squad: readonly PlayerId[]) =>
    requiredLineupSize(rules, ctx, { ...selecting().teams["t1"]!, squad: entries(squad) });

  it("is the lineup size for a normal squad", () => {
    expect(sizeFor([...home.slice(0, 10), ...away.slice(0, 5)])).toBe(12);
  });

  it("is smaller when the squad has too few players", () => {
    expect(sizeFor(home.slice(0, 9))).toBe(9);
    expect(sizeFor([])).toBe(0);
  });

  it("is smaller when too few home players can fill the lineup around the overseas cap", () => {
    // 5 home + 10 overseas: at most 5 + 4 (the cap) = 9 can play
    expect(sizeFor([...home.slice(0, 5), ...away.slice(0, 10)])).toBe(9);
  });
});

describe("SUBMIT_LINEUP", () => {
  it("is not available before selection", () => {
    const result = reduce(ctx, started(), submit(5000, "t1", []));
    expect(result.error).toBe("WRONG_PHASE");
  });

  it("stores a legal lineup and keeps selecting until everyone is in", () => {
    const before = selectingWith([...home.slice(0, 10), ...away.slice(0, 5)]);
    const lineup = legalLineup(before, "t1");
    expect(lineup).toHaveLength(12);
    const state = step(before, submit(before.lastActionAt + 10, "t1", lineup));
    expect(state.teams["t1"]?.lineup).toEqual(lineup);
    expect(state.phase).toBe("SELECTING");
    expect(state.revision).toBe(before.revision + 1);
    expect(state.lastActionAt).toBe(before.lastActionAt + 10);
    expect(state.meta.finishedAt).toBeNull();
  });

  it("lets a team change its lineup before the phase ends", () => {
    const before = selectingWith(home.slice(0, 15));
    const first = home.slice(0, 12);
    const second = home.slice(1, 13);
    let state = step(before, submit(before.lastActionAt + 10, "t1", first));
    state = step(state, submit(before.lastActionAt + 20, "t1", second));
    expect(state.teams["t1"]?.lineup).toEqual(second);
    expect(state.phase).toBe("SELECTING");
  });

  it("finishes the game when the last team submits, and then closes the door", () => {
    let state = selecting();
    let now = state.lastActionAt;
    const ids = state.teamOrder;
    ids.forEach((id, i) => {
      now += 10;
      state = step(state, submit(now, id, legalLineup(state, id)));
      checkInvariants(state, ctx);
      expect(state.phase).toBe(i === ids.length - 1 ? "FINISHED" : "SELECTING");
    });
    expect(state.meta.finishedAt).toBe(now);
    expect(reduce(ctx, state, submit(now + 1, "t1", legalLineup(state, "t1"))).error).toBe("WRONG_PHASE");
  });

  it("survives a JSON round trip", () => {
    const before = selecting();
    const state = step(before, submit(before.lastActionAt + 10, "t1", legalLineup(before, "t1")));
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it("does not modify the state it was given", () => {
    const before = selecting();
    const snapshot = structuredClone(before);
    step(before, submit(before.lastActionAt + 10, "t1", legalLineup(before, "t1")));
    expect(before).toEqual(snapshot);
  });
});

describe("SUBMIT_LINEUP: rejections leave the state untouched", () => {
  const at = () => selecting().lastActionAt + 10;
  const legal = () => legalLineup(selecting(), "t1");

  it("unknown team", () => {
    expect(reduce(ctx, selecting(), submit(at(), "nope", legal())).error).toBe("UNKNOWN_TEAM");
  });

  it("when time goes backwards", () => {
    const state = selecting();
    expect(reduce(ctx, state, submit(state.lastActionAt - 1, "t1", legal())).error).toBe("TIME_WENT_BACKWARDS");
  });

  it("with too few or too many players", () => {
    const state = selectingWith(home.slice(0, 15));
    expect(reduce(ctx, state, submit(at(), "t1", home.slice(0, 11))).error).toBe("WRONG_LINEUP_SIZE");
    expect(reduce(ctx, state, submit(at(), "t1", home.slice(0, 13))).error).toBe("WRONG_LINEUP_SIZE");
    expect(reduce(ctx, state, submit(at(), "t1", home.slice(0, 12))).error).toBeNull();
  });

  it("with a repeated player", () => {
    const state = selectingWith(home.slice(0, 15));
    const lineup = [...home.slice(0, 11), home[0]!];
    expect(reduce(ctx, state, submit(at(), "t1", lineup)).error).toBe("DUPLICATE_PLAYER");
  });

  it("with a player from outside the squad (another team's, or unknown)", () => {
    const state = selectingWith(home.slice(0, 15));
    const outsider = home[20]!;
    expect(reduce(ctx, state, submit(at(), "t1", [...home.slice(0, 11), outsider])).error).toBe("PLAYER_NOT_IN_SQUAD");
    expect(reduce(ctx, state, submit(at(), "t1", [...home.slice(0, 11), "p999"])).error).toBe("PLAYER_NOT_IN_SQUAD");
  });

  it("with more overseas players than the lineup allows", () => {
    const squad = [...home.slice(0, 10), ...away.slice(0, 5)];
    const state = selectingWith(squad);
    const tooMany = [...home.slice(0, 7), ...away.slice(0, 5)]; // 5 overseas, cap is 4
    expect(reduce(ctx, state, submit(at(), "t1", tooMany)).error).toBe("LINEUP_OVERSEAS_CAP");
    const atCap = [...home.slice(0, 8), ...away.slice(0, 4)];
    expect(reduce(ctx, state, submit(at(), "t1", atCap)).error).toBeNull();
  });

  it("returns the same state object", () => {
    const state = selecting();
    expect(reduce(ctx, state, submit(at(), "nope", legal())).state).toBe(state);
  });

  it("agrees with lineupError", () => {
    const state = selectingWith([...home.slice(0, 10), ...away.slice(0, 5)]);
    const tries: PlayerId[][] = [
      [...home.slice(0, 8), ...away.slice(0, 4)],
      [...home.slice(0, 7), ...away.slice(0, 5)],
      home.slice(0, 12),
      [],
    ];
    for (const lineup of tries) {
      expect(reduce(ctx, state, submit(at(), "t1", lineup)).error).toBe(lineupError(state, ctx, "t1", lineup));
    }
  });
});

describe("a team that cannot field a full legal 12 can still finish", () => {
  it("names the most it can field", () => {
    const squad = [...home.slice(0, 5), ...away.slice(0, 10)]; // 9 can play: 5 home + 4 overseas
    const state = selectingWith(squad);
    const lineup = [...home.slice(0, 5), ...away.slice(0, 4)];
    expect(reduce(ctx, state, submit(selecting().lastActionAt + 10, "t1", lineup)).error).toBeNull();
    expect(reduce(ctx, state, submit(selecting().lastActionAt + 10, "t1", squad.slice(0, 12))).error).toBe("WRONG_LINEUP_SIZE");
  });

  it("an empty squad submits an empty lineup", () => {
    const state = selectingWith([]);
    expect(reduce(ctx, state, submit(selecting().lastActionAt + 10, "t1", [])).error).toBeNull();
  });
});
