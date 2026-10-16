import type { RejectReason } from "../constants";
import type { PlayerId } from "./ids";
import type { Player } from "./player";
import type { AuctionState } from "./state";

/** Read-only context passed alongside state. Not part of the state. */
export interface Ctx {
  /** Must equal `state.datasetVersion`, or START is rejected (DATASET_MISMATCH). */
  readonly datasetVersion: number;
  readonly players: ReadonlyMap<PlayerId, Player>;
}

/** A rejected action returns the same state object, unchanged. */
export interface ReduceResult {
  readonly state: AuctionState;
  readonly error: RejectReason | null;
}

/** Output of the `squadPressure` selector (forced-lot rule, PROJECT.md 4.5). */
export interface SquadPressure {
  /** Sum over teams of max(0, squad.min - squadSize). */
  readonly needed: number;
  /** Lots still to sell, including the open lot. */
  readonly left: number;
  /** left - needed. Invariant: never negative. */
  readonly slack: number;
  /** True when slack is 0. */
  readonly forced: boolean;
}
