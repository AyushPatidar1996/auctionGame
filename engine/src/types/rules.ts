import type {
  AuctionTier,
  Currency,
  LotOrder,
  PoolSelection,
} from "../constants";
import type { Lakhs } from "./ids";

/** Bid step for prices below `upTo`. Exactly one band has `upTo: null`, and it is last. */
export interface IncrementBand {
  readonly upTo: Lakhs | null;
  readonly step: Lakhs;
}

/** Plain data (data/rules.<preset>.json). Validators live in the engine. */
export interface RuleSet {
  readonly rulesVersion: number;
  readonly currency: Currency;
  readonly homeCountry: string;
  readonly teams: number;
  /** Starting purse per team. */
  readonly purse: Lakhs;
  readonly squad: {
    readonly min: number;
    readonly max: number;
    readonly maxOverseas: number;
  };
  readonly lineup: {
    readonly size: number;
    readonly maxOverseas: number;
  };
  readonly pool: {
    readonly selection: PoolSelection;
    /** How many players of each tier go into the auction pool. */
    readonly composition: Readonly<Record<AuctionTier, number>>;
  };
  readonly tierBasePrice: Readonly<Record<AuctionTier, Lakhs>>;
  /** A permutation of all tiers. Lots are offered in this order. */
  readonly tierOrder: readonly AuctionTier[];
  readonly lotOrder: LotOrder;
  readonly increments: readonly IncrementBand[];
  readonly timer: {
    readonly bidWindowMs: number;
    readonly resetOnBid: boolean;
  };
}
