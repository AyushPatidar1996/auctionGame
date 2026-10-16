import type { AssignedBy } from "../constants";
import type { AuctionState, Lakhs, LotRecord, Millis, TeamId } from "../types";

/**
 * Closes the open lot and moves the phase to BETWEEN_LOTS. The lot is sold to the high
 * bidder; with no bid it is sold to `assignTo` at base price (the forced-lot rule) if
 * given, otherwise it goes unsold. Does NOT bump `revision` or `lastActionAt`; the
 * calling handler does that once per action.
 */
export function closeLot(state: AuctionState, at: Millis, assignTo?: TeamId): AuctionState {
  const { lot } = state;
  if (!lot) throw new Error("closeLot: no open lot");

  const base = { playerId: lot.playerId, basePrice: lot.basePrice, closedAt: at };
  const sale = lot.highBid
    ? { teamId: lot.highBid.teamId, price: lot.highBid.amount, assignedBy: "bid" as AssignedBy }
    : assignTo !== undefined
      ? { teamId: assignTo, price: lot.basePrice as Lakhs, assignedBy: "forced" as AssignedBy }
      : null;

  if (!sale) {
    const record: LotRecord = { ...base, outcome: "unsold" };
    return {
      ...state,
      unsold: [...state.unsold, lot.playerId],
      history: [...state.history, record],
      lot: null,
      phase: "BETWEEN_LOTS",
    };
  }

  const winner = state.teams[sale.teamId];
  if (!winner) throw new Error(`closeLot: unknown winning team ${sale.teamId}`);
  const record: LotRecord = { ...base, outcome: "sold", ...sale };
  return {
    ...state,
    teams: {
      ...state.teams,
      [sale.teamId]: {
        ...winner,
        purse: winner.purse - sale.price,
        squad: [
          ...winner.squad,
          { playerId: lot.playerId, price: sale.price, lotIndex: state.lotIndex },
        ],
      },
    },
    history: [...state.history, record],
    lot: null,
    phase: "BETWEEN_LOTS",
  };
}
