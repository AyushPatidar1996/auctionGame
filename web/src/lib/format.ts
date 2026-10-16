import type { BatType, BowlPhase, BowlType, Lakhs, Player, RejectReason } from '@auction/engine'

/** 100 lakhs = 1 crore. */
export const money = (l: Lakhs): string =>
  l >= 100 ? `₹${(l / 100).toFixed(2)} Cr` : `₹${l} L`

/** Two-letter team badge from the team name (PROJECT.md 4a: initials for now). */
export function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase())
  if (letters.length === 1) return name.trim().slice(0, 2).toUpperCase()
  return letters.slice(0, 2).join('') || '?'
}

export const TYPE_LABEL: Record<Player['type'], string> = {
  bat: 'Batter',
  bowl: 'Bowler',
  'all-rounder': 'All-rounder',
}

export const TYPE_SHORT: Record<Player['type'], string> = {
  bat: 'BAT',
  bowl: 'BWL',
  'all-rounder': 'AR',
}

export const BAT_LABEL: Record<BatType, string> = {
  opener: 'Opener',
  middle: 'Middle order',
  anchor: 'Anchor',
  finisher: 'Finisher',
}

export const BOWL_LABEL: Record<BowlType, string> = {
  pace: 'Pace',
  offSpin: 'Off spin',
  legSpin: 'Leg spin',
  leftArmOrthodox: 'Left-arm spin',
  chinaman: 'Chinaman',
}

export const PHASE_LABEL: Record<BowlPhase, string> = {
  powerplay: 'Powerplay',
  middle: 'Middle overs',
  death: 'Death overs',
}

export const TIER_LABEL: Record<Player['auctionTier'], string> = {
  marquee: 'Marquee',
  A: 'Set A',
  B: 'Set B',
  C: 'Set C',
}

/** Plain-English reasons for the engine's reject codes (shown next to disabled buttons). */
export const REASON_TEXT: Partial<Record<RejectReason, string>> = {
  WRONG_PHASE: 'No lot is open right now.',
  LOT_EXPIRED: 'The timer has run out.',
  HAS_PASSED: 'You passed on this player.',
  QUOTA_MET: 'Forced lot: only teams still short of the minimum squad may bid.',
  ALREADY_HIGHEST: 'You hold the highest bid.',
  STALE_AMOUNT: 'The price just moved. Try again.',
  INSUFFICIENT_PURSE: 'Not enough purse left for this bid.',
  RESERVE_VIOLATION: 'You must keep enough purse to fill your minimum squad.',
  SQUAD_FULL: 'Your squad is full.',
  OVERSEAS_CAP: 'You already have the maximum overseas players.',
  FORCED_LOT: 'Forced lot: you cannot pass on this player.',
  ALREADY_PASSED: 'You already passed.',
  HIGH_BIDDER_CANNOT_PASS: 'You hold the highest bid.',
  WRONG_LINEUP_SIZE: 'Pick exactly the required number of players.',
  DUPLICATE_PLAYER: 'A player is listed twice.',
  PLAYER_NOT_IN_SQUAD: 'A picked player is not in your squad.',
  LINEUP_OVERSEAS_CAP: 'Too many overseas players in the lineup.',
}
