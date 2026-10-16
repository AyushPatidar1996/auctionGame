import {
  CURRENCIES,
  LOT_ORDERS,
  POOL_SELECTIONS,
  TIERS,
  type AuctionTier,
} from "../constants";
import type { IncrementBand, RuleSet } from "../types";
import {
  bool,
  checkKeys,
  inList,
  int,
  isObj,
  oneOf,
  str,
  type Report,
} from "./guards";
import { fail, ok, type Result } from "./result";

const RULE_KEYS = [
  "rulesVersion", "currency", "homeCountry", "teams", "purse", "squad", "lineup",
  "pool", "tierBasePrice", "tierOrder", "lotOrder", "increments", "timer",
];

type TierMap = Readonly<Record<AuctionTier, number>>;

/** Validates already-parsed JSON (no file I/O in the engine) and collects every error. */
export function loadRules(raw: unknown): Result<RuleSet> {
  if (!isObj(raw)) return fail(["rules: expected an object"]);
  const errors: string[] = [];
  const report: Report = (m) => errors.push(`rules: ${m}`);
  const sub = (name: string): Report => (m) => errors.push(`rules.${name}: ${m}`);

  checkKeys(raw, RULE_KEYS, report);
  const rulesVersion = int(raw.rulesVersion, "rulesVersion", report, 1);
  const currency = oneOf(CURRENCIES, raw.currency, "currency", report);
  const homeCountry = str(raw.homeCountry, "homeCountry", report);
  const teams = int(raw.teams, "teams", report, 2);
  const purse = int(raw.purse, "purse", report, 1);
  const lotOrder = oneOf(LOT_ORDERS, raw.lotOrder, "lotOrder", report);

  const squad = parseSquad(raw.squad, sub("squad"));
  const lineup = parseLineup(raw.lineup, sub("lineup"));
  const pool = parsePool(raw.pool, sub("pool"));
  const tierBasePrice = parseTierMap(raw.tierBasePrice, 1, sub("tierBasePrice"));
  const tierOrder = parseTierOrder(raw.tierOrder, sub("tierOrder"));
  const increments = parseIncrements(raw.increments, sub("increments"));
  const timer = parseTimer(raw.timer, sub("timer"));

  // Cross-field rules (each runs only when the parts it needs parsed cleanly).
  if (squad && lineup) {
    if (squad.min > squad.max) report("squad.min must not exceed squad.max");
    if (squad.maxOverseas > squad.max) {
      report("squad.maxOverseas must not exceed squad.max");
    }
    if (lineup.size > squad.min) report("lineup.size must not exceed squad.min");
    if (lineup.maxOverseas > lineup.size) {
      report("lineup.maxOverseas must not exceed lineup.size");
    }
    if (lineup.maxOverseas > squad.maxOverseas) {
      report("lineup.maxOverseas must not exceed squad.maxOverseas");
    }
  }
  if (tierBasePrice && increments) {
    const smallestStep = Math.min(...increments.map((band) => band.step));
    for (const tier of TIERS) {
      if (tierBasePrice[tier] % smallestStep !== 0) {
        report(
          `tierBasePrice.${tier} (${tierBasePrice[tier]}) must be a multiple of ${smallestStep}`,
        );
      }
    }
  }
  if (purse !== undefined && squad && tierBasePrice) {
    const cheapest = Math.min(...TIERS.map((tier) => tierBasePrice[tier]));
    if (squad.min * cheapest > purse) {
      report(
        `purse ${purse} cannot cover squad.min (${squad.min}) x cheapest base price (${cheapest})`,
      );
    }
  }
  if (teams !== undefined && squad && pool) {
    const poolSize = TIERS.reduce((sum, tier) => sum + pool.composition[tier], 0);
    if (poolSize < teams * squad.min) {
      report(
        `pool.composition totals ${poolSize}, below teams x squad.min (${teams * squad.min})`,
      );
    }
  }

  if (
    errors.length > 0 ||
    rulesVersion === undefined || currency === undefined || homeCountry === undefined ||
    teams === undefined || purse === undefined || lotOrder === undefined ||
    !squad || !lineup || !pool || !tierBasePrice || !tierOrder || !increments || !timer
  ) {
    return fail(errors);
  }
  return ok({
    rulesVersion, currency, homeCountry, teams, purse, squad, lineup,
    pool, tierBasePrice, tierOrder, lotOrder, increments, timer,
  });
}

function parseSquad(raw: unknown, report: Report) {
  if (!isObj(raw)) {
    report("expected an object");
    return undefined;
  }
  checkKeys(raw, ["min", "max", "maxOverseas"], report);
  const min = int(raw.min, "min", report, 1);
  const max = int(raw.max, "max", report, 1);
  const maxOverseas = int(raw.maxOverseas, "maxOverseas", report, 0);
  if (min === undefined || max === undefined || maxOverseas === undefined) {
    return undefined;
  }
  return { min, max, maxOverseas };
}

function parseLineup(raw: unknown, report: Report) {
  if (!isObj(raw)) {
    report("expected an object");
    return undefined;
  }
  checkKeys(raw, ["size", "maxOverseas"], report);
  const size = int(raw.size, "size", report, 1);
  const maxOverseas = int(raw.maxOverseas, "maxOverseas", report, 0);
  if (size === undefined || maxOverseas === undefined) return undefined;
  return { size, maxOverseas };
}

function parsePool(raw: unknown, report: Report) {
  if (!isObj(raw)) {
    report("expected an object");
    return undefined;
  }
  checkKeys(raw, ["selection", "composition"], report);
  const selection = oneOf(POOL_SELECTIONS, raw.selection, "selection", report);
  const composition = parseTierMap(raw.composition, 0, (m) => report(`composition: ${m}`));
  if (selection === undefined || composition === undefined) return undefined;
  return { selection, composition };
}

/** An object with exactly one integer (>= min) per tier. */
function parseTierMap(raw: unknown, min: number, report: Report): TierMap | undefined {
  if (!isObj(raw)) {
    report("expected an object");
    return undefined;
  }
  checkKeys(raw, TIERS, report);
  const marquee = int(raw.marquee, "marquee", report, min);
  const A = int(raw.A, "A", report, min);
  const B = int(raw.B, "B", report, min);
  const C = int(raw.C, "C", report, min);
  if (marquee === undefined || A === undefined || B === undefined || C === undefined) {
    return undefined;
  }
  return { marquee, A, B, C };
}

function parseTierOrder(raw: unknown, report: Report): readonly AuctionTier[] | undefined {
  if (!Array.isArray(raw)) {
    report("expected an array");
    return undefined;
  }
  const order: AuctionTier[] = [];
  for (const item of raw) {
    if (!inList(TIERS, item)) {
      report(`invalid tier (allowed: ${TIERS.join(", ")})`);
      return undefined;
    }
    order.push(item);
  }
  const listsEveryTierOnce =
    order.length === TIERS.length && TIERS.every((tier) => order.includes(tier));
  if (!listsEveryTierOnce) {
    report("must list every tier exactly once");
    return undefined;
  }
  return order;
}

function parseIncrements(raw: unknown, report: Report): readonly IncrementBand[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    report("expected a non-empty array");
    return undefined;
  }
  const bands: IncrementBand[] = [];
  let valid = true;
  raw.forEach((item: unknown, index: number) => {
    const at: Report = (m) => report(`[${index}] ${m}`);
    if (!isObj(item)) {
      at("expected an object");
      valid = false;
      return;
    }
    checkKeys(item, ["upTo", "step"], at);
    const step = int(item.step, "step", at, 1);
    const upTo = item.upTo === null ? null : int(item.upTo, "upTo", at, 1);
    if (step === undefined || upTo === undefined) {
      valid = false;
      return;
    }
    if (upTo !== null && upTo % step !== 0) {
      at(`upTo ${upTo} must be a multiple of its step ${step}`);
      valid = false;
    }
    bands.push({ upTo, step });
  });
  if (!valid) return undefined;

  const nullCount = bands.filter((band) => band.upTo === null).length;
  if (nullCount !== 1 || bands[bands.length - 1]?.upTo !== null) {
    report("exactly one band may have upTo null, and it must be last");
    return undefined;
  }
  const bounds = bands.slice(0, -1).map((band) => band.upTo ?? 0);
  if (bounds.some((bound, i) => i > 0 && bound <= (bounds[i - 1] ?? 0))) {
    report("upTo values must be strictly increasing");
    return undefined;
  }
  return bands;
}

function parseTimer(raw: unknown, report: Report) {
  if (!isObj(raw)) {
    report("expected an object");
    return undefined;
  }
  checkKeys(raw, ["bidWindowMs", "resetOnBid"], report);
  const bidWindowMs = int(raw.bidWindowMs, "bidWindowMs", report, 1);
  const resetOnBid = bool(raw.resetOnBid, "resetOnBid", report);
  if (bidWindowMs === undefined || resetOnBid === undefined) return undefined;
  return { bidWindowMs, resetOnBid };
}
