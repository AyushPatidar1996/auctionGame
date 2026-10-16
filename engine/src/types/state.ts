import type {
  AssignedBy,
  GameMode,
  LotOutcome,
  Phase,
  TeamKind,
} from "../constants";
import type {
  GameId,
  Lakhs,
  Millis,
  ParticipantId,
  PlayerId,
  TeamId,
} from "./ids";
import type { RuleSet } from "./rules";

// A complete, JSON-safe snapshot of one game (PROJECT.md 4.3): no Map, Set,
// Date or undefined. State holds facts; derived values are selectors.

export interface SquadEntry {
  readonly playerId: PlayerId;
  /** What the team paid. */
  readonly price: Lakhs;
  /** Index into `AuctionState.lots` of the lot it was won in. */
  readonly lotIndex: number;
}

export interface Team {
  readonly id: TeamId;
  readonly name: string;
  readonly kind: TeamKind;
  /** CPU personality (M3). */
  readonly profileId: string | null;
  /** Remaining. Never negative. */
  readonly purse: Lakhs;
  /** Every player the team owns right now. */
  readonly squad: readonly SquadEntry[];
  /** The playing 12. Set during SELECTING. */
  readonly lineup: readonly PlayerId[] | null;
}

export interface HighBid {
  readonly teamId: TeamId;
  readonly amount: Lakhs;
}

/** The open lot. Exists only in phase LOT_OPEN. */
export interface Lot {
  readonly playerId: PlayerId;
  readonly basePrice: Lakhs;
  readonly highBid: HighBid | null;
  /** Absolute time. Moves on each valid bid when `timer.resetOnBid`. */
  readonly deadline: Millis;
  readonly passed: readonly TeamId[];
}

/** One closed lot. Outcome only; per-lot bid trails are deliberately not stored. */
export type LotRecord = {
  readonly playerId: PlayerId;
  readonly basePrice: Lakhs;
  readonly closedAt: Millis;
} & (
  | { readonly outcome: Extract<LotOutcome, "unsold"> }
  | {
      readonly outcome: Extract<LotOutcome, "sold">;
      readonly teamId: TeamId;
      readonly price: Lakhs;
      readonly assignedBy: AssignedBy;
    }
);

export interface GameMeta {
  readonly gameId: GameId;
  readonly mode: GameMode;
  readonly createdAt: Millis;
  readonly startedAt: Millis | null;
  readonly finishedAt: Millis | null;
  readonly hostId: ParticipantId | null;
}

export interface AuctionState {
  readonly schemaVersion: number;
  /** +1 on every accepted action. */
  readonly revision: number;
  readonly meta: GameMeta;
  readonly datasetVersion: number;
  /** Frozen at start so replays and joining clients see the same rules. */
  readonly rules: RuleSet;
  /** Null until START. */
  readonly seed: number | null;
  readonly phase: Phase;

  readonly teams: Readonly<Record<TeamId, Team>>;
  /** Stable display order. */
  readonly teamOrder: readonly TeamId[];
  /** Who controls each team. */
  readonly seats: Readonly<Record<TeamId, ParticipantId | null>>;

  /** Full auction order, fixed at START. */
  readonly lots: readonly PlayerId[];
  /** -1 before the first lot. */
  readonly lotIndex: number;
  readonly lot: Lot | null;
  readonly unsold: readonly PlayerId[];
  readonly history: readonly LotRecord[];
  readonly lastActionAt: Millis;
}
