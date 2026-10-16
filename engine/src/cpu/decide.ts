import { canBid } from "../engine/canBid";
import { nextBid, squadPressure } from "../engine/selectors";
import { createRng, deriveSeed, type Rng } from "../random";
import type { Action, AuctionState, Ctx, Millis, TeamId } from "../types";
import type { CpuProfile } from "./profiles";

/**
 * One CPU decision for the open lot: an ordinary BID or PASS action, or null to keep
 * waiting. `view` must come from `viewFor`, so the CPU only uses public information, and
 * every bid goes through the same `canBid` the reducer uses, so it never proposes an
 * illegal one. This is the random baseline (M1); M3 replaces the body, not the contract.
 */
export function decide(
  ctx: Ctx,
  view: AuctionState,
  teamId: TeamId,
  profile: CpuProfile,
  rng: Rng,
  at: Millis,
): Action | null {
  const { lot } = view;
  const amount = nextBid(view);
  if (view.phase !== "LOT_OPEN" || !lot || amount === null) return null;

  const forced = squadPressure(view).forced;
  const reason = canBid(view, ctx, teamId, amount, at);

  if (reason !== null) {
    // Nothing to do when already leading or out; on a forced lot passing is not allowed.
    // Otherwise a team that cannot bid steps aside, which lets the lot close early.
    const settled = reason === "HAS_PASSED" || reason === "ALREADY_HIGHEST";
    if (settled || forced || reason === "WRONG_PHASE" || reason === "LOT_EXPIRED") return null;
    return { type: "PASS", at, teamId };
  }

  // A per-lot ceiling, stable across the decisions made during one lot.
  const unit = createRng(deriveSeed(profile.seed, "ceiling", view.lotIndex))();
  const ceiling = lot.basePrice * (1 + profile.ceilingFactor * unit);
  if (amount > ceiling && !forced) return { type: "PASS", at, teamId };

  if (rng() < profile.bidChance) return { type: "BID", at, teamId, amount };
  if (!forced && rng() < profile.passChance) return { type: "PASS", at, teamId };
  return null;
}
