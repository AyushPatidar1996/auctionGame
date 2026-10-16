// Provisional squad read-outs for the M1 UI. The real scoring module (strength by aspect,
// balance, brand, bench) is still to be designed; these are plain facts and averages.
import { isOverseas, type AuctionState, type Player, type RuleSet, type Team } from '@auction/engine'
import { ctx } from '../data'

export function playersOf(team: Team): Player[] {
  return team.squad.flatMap((entry) => {
    const player = ctx.players.get(entry.playerId)
    return player ? [player] : []
  })
}

const avgTop = (values: number[], n: number): number => {
  const top = [...values].sort((a, b) => b - a).slice(0, n)
  return top.length === 0 ? 0 : Math.round(top.reduce((a, b) => a + b, 0) / top.length)
}

/** Provisional 0-100 bars: the average of the best few players in each discipline. */
export function barsOf(players: readonly Player[]) {
  return {
    batting: avgTop(players.map((p) => p.batScore), 7),
    bowling: avgTop(players.filter((p) => p.bowlType !== null).map((p) => p.bowlScore), 5),
    fielding: avgTop(players.map((p) => p.fieldScore), 8),
    brand: avgTop(players.map((p) => p.brandAppeal), 6),
  }
}

export interface SquadSummary {
  readonly size: number
  readonly overseas: number
  readonly keepers: number
  readonly batters: number
  readonly bowlers: number
  readonly allRounders: number
  readonly spent: number
  readonly batting: number
  readonly bowling: number
  readonly fielding: number
  readonly brand: number
}

export function summarise(team: Team, rules: RuleSet): SquadSummary {
  const players = playersOf(team)
  return {
    size: players.length,
    overseas: players.filter((p) => isOverseas(p, rules)).length,
    keepers: players.filter((p) => p.isKeeper).length,
    batters: players.filter((p) => p.type === 'bat').length,
    bowlers: players.filter((p) => p.type === 'bowl').length,
    allRounders: players.filter((p) => p.type === 'all-rounder').length,
    spent: team.squad.reduce((sum, e) => sum + e.price, 0),
    ...barsOf(players),
  }
}

/** The one human team (the first team with kind "human"). */
export function humanTeamId(state: AuctionState): string {
  return state.teamOrder.find((id) => state.teams[id]?.kind === 'human') ?? state.teamOrder[0] ?? ''
}
