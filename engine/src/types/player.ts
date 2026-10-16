import type {
  AuctionTier,
  BatType,
  BowlPhase,
  BowlType,
  Hand,
  PlayerType,
} from "../constants";
import type { PlayerId } from "./ids";

/** Static game content (data/players.v<N>.json). Not part of AuctionState. */
export interface Player {
  readonly id: PlayerId;
  readonly name: string;
  readonly displayName: string;
  /** Overseas iff nationality !== rules.homeCountry. */
  readonly nationality: string;
  readonly auctionTier: AuctionTier;
  readonly type: PlayerType;
  readonly isKeeper: boolean;
  readonly battingHand: Hand;
  /** Non-null iff batScore > SKILL_THRESHOLD. */
  readonly batType: BatType | null;
  /** Non-null iff bowlScore > SKILL_THRESHOLD. */
  readonly bowlType: BowlType | null;
  /** Non-null iff bowlType is non-null. */
  readonly bowlingArm: Hand | null;
  /** Non-empty iff bowlType is non-null. */
  readonly bowlPhases: readonly BowlPhase[];
  /** Integers, SCORE_MIN..SCORE_MAX. 0 means "doesn't do this". */
  readonly batScore: number;
  readonly bowlScore: number;
  readonly fieldScore: number;
  readonly brandAppeal: number;
}

export interface Dataset {
  readonly datasetVersion: number;
  readonly players: readonly Player[];
}
