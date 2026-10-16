import { expect } from "vitest";
import {
  cheapestBasePrice,
  isOverseas,
  overseasCount,
  requiredLineupSize,
  squadPressure,
} from "../src/engine";
import type { AuctionState, Ctx } from "../src/types";

/**
 * The properties that must hold after every accepted action (PROJECT.md 4.3).
 * Cheap enough to call inside a loop, so a rule that breaks money bookkeeping
 * is caught at the exact action that broke it.
 */
export function checkInvariants(state: AuctionState, ctx: Ctx): void {
  const { rules } = state;
  const owned = new Map<string, string>();

  for (const id of state.teamOrder) {
    const team = state.teams[id];
    if (!team) throw new Error(`teamOrder lists missing team ${id}`);
    const spent = team.squad.reduce((sum, entry) => sum + entry.price, 0);

    // Money: every lakh is either in the purse or in a squad entry.
    expect(team.purse + spent, `${id}: purse + spent`).toBe(rules.purse);
    expect(team.purse, `${id}: purse`).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(team.purse), `${id}: integer purse`).toBe(true);

    // Squad limits.
    expect(team.squad.length, `${id}: squad max`).toBeLessThanOrEqual(rules.squad.max);
    expect(overseasCount(team, ctx, rules), `${id}: overseas cap`).toBeLessThanOrEqual(
      rules.squad.maxOverseas,
    );

    // Reserve rule: a team short of the minimum can still afford to complete it.
    const stillNeeded = Math.max(0, rules.squad.min - team.squad.length);
    expect(team.purse, `${id}: reserve`).toBeGreaterThanOrEqual(
      stillNeeded * cheapestBasePrice(rules),
    );

    for (const entry of team.squad) {
      expect(owned.has(entry.playerId), `${entry.playerId} owned twice`).toBe(false);
      owned.set(entry.playerId, id);
      expect(state.lots[entry.lotIndex], `${id}: lotIndex`).toBe(entry.playerId);
    }
  }

  // A player is in at most one place: a squad, the unsold list, or the open lot.
  const unsold = new Set(state.unsold);
  expect(unsold.size, "unsold has repeats").toBe(state.unsold.length);
  for (const playerId of state.unsold) expect(owned.has(playerId), `${playerId} sold and unsold`).toBe(false);
  if (state.lot) {
    expect(owned.has(state.lot.playerId)).toBe(false);
    expect(unsold.has(state.lot.playerId)).toBe(false);
  }

  // History agrees with the squads and the unsold list.
  const soldIds = state.history.flatMap((r) => (r.outcome === "sold" ? [r.playerId] : []));
  expect(new Set(soldIds)).toEqual(new Set(owned.keys()));
  const unsoldIds = state.history.flatMap((r) => (r.outcome === "unsold" ? [r.playerId] : []));
  expect(unsoldIds).toEqual(state.unsold);
  for (const record of state.history) {
    if (record.outcome === "sold") {
      const entry = state.teams[record.teamId]?.squad.find((e) => e.playerId === record.playerId);
      expect(entry?.price, `${record.playerId}: price in squad`).toBe(record.price);
      expect(record.price).toBeGreaterThanOrEqual(record.basePrice);
    }
  }

  // Lot bookkeeping.
  expect(state.history.length + (state.lot ? 1 : 0)).toBe(Math.max(0, state.lotIndex + 1));
  expect(state.lot !== null).toBe(state.phase === "LOT_OPEN");

  // Lineups: a named lineup is a legal one, and the game finishes exactly when all are in.
  for (const id of state.teamOrder) {
    const team = state.teams[id];
    if (!team?.lineup) continue;
    expect(["SELECTING", "FINISHED"], `${id}: lineup outside selection`).toContain(state.phase);
    const squadIds = new Set(team.squad.map((e) => e.playerId));
    expect(new Set(team.lineup).size, `${id}: lineup repeats a player`).toBe(team.lineup.length);
    for (const playerId of team.lineup) expect(squadIds.has(playerId), `${id}: ${playerId} not in squad`).toBe(true);
    expect(team.lineup.length, `${id}: lineup size`).toBe(requiredLineupSize(rules, ctx, team));
    const away = team.lineup.filter((pid) => {
      const player = ctx.players.get(pid);
      return player !== undefined && isOverseas(player, rules);
    }).length;
    expect(away, `${id}: lineup overseas cap`).toBeLessThanOrEqual(rules.lineup.maxOverseas);
  }
  const allIn = state.teamOrder.every((id) => state.teams[id]?.lineup != null);
  if (state.phase === "FINISHED") {
    expect(allIn, "FINISHED needs every lineup").toBe(true);
    expect(state.meta.finishedAt, "finishedAt").not.toBeNull();
  } else {
    expect(state.meta.finishedAt, "finishedAt before the end").toBeNull();
    if (state.phase === "SELECTING") expect(allIn, "SELECTING with every lineup in").toBe(false);
  }

  // Forced-lot guarantee: there are always enough lots left to bring every team to the
  // minimum squad, and once bidding is over every team has reached it.
  if (state.phase === "LOT_OPEN" || state.phase === "BETWEEN_LOTS") {
    expect(squadPressure(state).slack, "lots left minus slots needed").toBeGreaterThanOrEqual(0);
  }
  if (state.phase === "SELECTING" || state.phase === "FINISHED") {
    for (const id of state.teamOrder) {
      expect(state.teams[id]?.squad.length, `${id}: reached the minimum squad`).toBeGreaterThanOrEqual(
        rules.squad.min,
      );
    }
  }
}
