// Single source of truth for every closed set of values (PROJECT.md 4.6).
// Types are derived from these arrays and loaders validate against them,
// so the runtime lists and the compile-time types cannot drift apart.

export const SCHEMA_VERSION = 1;

/** A player's batType / bowlType is set iff the matching score is above this. */
export const SKILL_THRESHOLD = 20;
export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

// ───── player ─────

export const TIERS = ["marquee", "A", "B", "C"] as const;
export type AuctionTier = (typeof TIERS)[number];

export const PLAYER_TYPES = ["bat", "bowl", "all-rounder"] as const;
export type PlayerType = (typeof PLAYER_TYPES)[number];

export const HANDS = ["L", "R"] as const;
export type Hand = (typeof HANDS)[number];

export const BAT_TYPES = ["opener", "middle", "anchor", "finisher"] as const;
export type BatType = (typeof BAT_TYPES)[number];

export const BOWL_TYPES = [
  "pace",
  "offSpin",
  "legSpin",
  "leftArmOrthodox",
  "chinaman",
] as const;
export type BowlType = (typeof BOWL_TYPES)[number];

export const BOWL_PHASES = ["powerplay", "middle", "death"] as const;
export type BowlPhase = (typeof BOWL_PHASES)[number];

// ───── rules ─────

export const CURRENCIES = ["lakhs"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const POOL_SELECTIONS = ["stratified-seeded"] as const;
export type PoolSelection = (typeof POOL_SELECTIONS)[number];

export const LOT_ORDERS = ["by-tier-then-shuffle"] as const;
export type LotOrder = (typeof LOT_ORDERS)[number];

// ───── state ─────

export const PHASES = [
  "SETUP",
  "LOT_OPEN",
  "BETWEEN_LOTS",
  "SELECTING",
  "FINISHED",
] as const;
export type Phase = (typeof PHASES)[number];

export const TEAM_KINDS = ["human", "cpu"] as const;
export type TeamKind = (typeof TEAM_KINDS)[number];

export const GAME_MODES = ["offline", "online"] as const;
export type GameMode = (typeof GAME_MODES)[number];

export const LOT_OUTCOMES = ["sold", "unsold"] as const;
export type LotOutcome = (typeof LOT_OUTCOMES)[number];

export const ASSIGNED_BY = ["bid", "forced"] as const;
export type AssignedBy = (typeof ASSIGNED_BY)[number];

// ───── actions ─────

export const ACTION_TYPES = [
  "START",
  "NEXT_LOT",
  "BID",
  "PASS",
  "TICK",
  "SUBMIT_LINEUP",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const REJECT_REASONS = [
  // any action
  "WRONG_PHASE",
  "TIME_WENT_BACKWARDS",
  "UNKNOWN_TEAM",
  // START
  "TEAM_COUNT_MISMATCH",
  "INVALID_TEAMS",
  "POOL_TOO_SMALL",
  "DATASET_MISMATCH",
  // BID
  "LOT_EXPIRED",
  "HAS_PASSED",
  "QUOTA_MET",
  "ALREADY_HIGHEST",
  "STALE_AMOUNT",
  "INSUFFICIENT_PURSE",
  "RESERVE_VIOLATION",
  "SQUAD_FULL",
  "OVERSEAS_CAP",
  // PASS
  "ALREADY_PASSED",
  "HIGH_BIDDER_CANNOT_PASS",
  "FORCED_LOT",
  // SUBMIT_LINEUP
  "WRONG_LINEUP_SIZE",
  "DUPLICATE_PLAYER",
  "PLAYER_NOT_IN_SQUAD",
  "LINEUP_OVERSEAS_CAP",
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

/** The subset `canBid` can return, in the order the checks run (PROJECT.md 4.5). */
export const BID_REJECT_REASONS = [
  "WRONG_PHASE",
  "UNKNOWN_TEAM",
  "LOT_EXPIRED",
  "HAS_PASSED",
  "QUOTA_MET",
  "ALREADY_HIGHEST",
  "STALE_AMOUNT",
  "INSUFFICIENT_PURSE",
  "RESERVE_VIOLATION",
  "SQUAD_FULL",
  "OVERSEAS_CAP",
] as const satisfies readonly RejectReason[];
export type BidRejectReason = (typeof BID_REJECT_REASONS)[number];

/** The subset `passError` can return, in the order the checks run. */
export const PASS_REJECT_REASONS = [
  "WRONG_PHASE",
  "UNKNOWN_TEAM",
  "LOT_EXPIRED",
  "ALREADY_PASSED",
  "HIGH_BIDDER_CANNOT_PASS",
  "FORCED_LOT",
] as const satisfies readonly RejectReason[];
export type PassRejectReason = (typeof PASS_REJECT_REASONS)[number];

/** The subset `lineupError` can return, in the order the checks run. */
export const LINEUP_REJECT_REASONS = [
  "WRONG_PHASE",
  "UNKNOWN_TEAM",
  "WRONG_LINEUP_SIZE",
  "DUPLICATE_PLAYER",
  "PLAYER_NOT_IN_SQUAD",
  "LINEUP_OVERSEAS_CAP",
] as const satisfies readonly RejectReason[];
export type LineupRejectReason = (typeof LINEUP_REJECT_REASONS)[number];
