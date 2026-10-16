import type { ActionType, TeamKind } from "../constants";
import type { Lakhs, Millis, ParticipantId, PlayerId, TeamId } from "./ids";

export interface TeamSetup {
  readonly id: TeamId;
  readonly name: string;
  readonly kind: TeamKind;
  readonly profileId: string | null;
  readonly participantId: ParticipantId | null;
}

// Every action carries `at` (injected time). See PROJECT.md 4.5 for preconditions.
export type Action =
  | {
      readonly type: "START";
      readonly at: Millis;
      readonly seed: number;
      readonly teams: readonly TeamSetup[];
    }
  | { readonly type: "NEXT_LOT"; readonly at: Millis }
  | {
      readonly type: "BID";
      readonly at: Millis;
      readonly teamId: TeamId;
      /** Must equal the current next valid bid, or the action is rejected as stale. */
      readonly amount: Lakhs;
    }
  | { readonly type: "PASS"; readonly at: Millis; readonly teamId: TeamId }
  | { readonly type: "TICK"; readonly at: Millis }
  | {
      readonly type: "SUBMIT_LINEUP";
      readonly at: Millis;
      readonly teamId: TeamId;
      readonly playerIds: readonly PlayerId[];
    };

// Compile-time check: ACTION_TYPES and the Action union list the same types.
// Fails to compile if one is changed without the other.
type AssertNever<T extends never> = T;
export type _ActionTypesMatch = AssertNever<
  Exclude<Action["type"], ActionType> | Exclude<ActionType, Action["type"]>
>;
