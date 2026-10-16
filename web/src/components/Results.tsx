import type { AuctionState, TeamId } from '@auction/engine'
import { ctx, rules } from '../data'
import { money } from '../lib/format'
import { barsOf, playersOf } from '../lib/squad'
import { Badge, PlayerRow, TeamBadge } from './ui'

/**
 * End-of-auction summary. The real scoring module (strength by aspect, balance, brand,
 * bench) is not designed yet, so the figures here are provisional averages of each
 * team's chosen XII; they are for looking at the squads, not a final ranking.
 */
export function Results({ state, me, onNewGame }: { state: AuctionState; me: TeamId; onNewGame: () => void }) {
  const rows = state.teamOrder.flatMap((id) => {
    const team = state.teams[id]
    if (!team) return []
    const xii = (team.lineup ?? []).flatMap((pid) => {
      const player = ctx.players.get(pid)
      return player ? [player] : []
    })
    const inXii = new Set(team.lineup ?? [])
    const bench = playersOf(team).filter((p) => !inXii.has(p.id))
    const bars = barsOf(xii)
    const performance = Math.round((bars.batting + bars.bowling + bars.fielding) / 3)
    const benchAvg = bench.length
      ? Math.round(bench.reduce((sum, p) => sum + (p.batScore + p.bowlScore + p.fieldScore) / 3, 0) / bench.length)
      : 0
    const spent = team.squad.reduce((sum, e) => sum + e.price, 0)
    return [{ team, bars, performance, benchAvg, spent, xiiSize: xii.length, bench: bench.length }]
  })
  rows.sort((a, b) => b.performance - a.performance)
  const mine = state.teams[me]

  return (
    <main className="results">
      <div className="card">
        <header className="results-head">
          <div>
            <h1>Auction complete</h1>
            <p className="muted">
              Provisional comparison of each team's playing XII. Final scoring (strength, balance, brand appeal and bench
              strength) is still to come.
            </p>
          </div>
          <button type="button" className="btn primary" onClick={onNewGame}>
            New game
          </button>
        </header>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Team</th>
                <th>XII batting</th>
                <th>XII bowling</th>
                <th>XII fielding</th>
                <th>Performance</th>
                <th>Brand</th>
                <th>Bench</th>
                <th>Squad</th>
                <th>Spent</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.team.id} className={row.team.id === me ? 'me' : ''}>
                  <td>{i + 1}</td>
                  <td>
                    <span className="team-cell">
                      <TeamBadge name={row.team.name} you={row.team.id === me} size="sm" /> {row.team.name}
                      {row.xiiSize < rules.lineup.size && <Badge tone="warn">XII: {row.xiiSize}</Badge>}
                    </span>
                  </td>
                  <td>{row.bars.batting}</td>
                  <td>{row.bars.bowling}</td>
                  <td>{row.bars.fielding}</td>
                  <td>
                    <strong>{row.performance}</strong>
                  </td>
                  <td>{row.bars.brand}</td>
                  <td>{row.benchAvg}</td>
                  <td>{row.team.squad.length}</td>
                  <td>{money(row.spent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {mine && (
          <>
            <h2>Your squad</h2>
            <ul className="roster two-col">
              {mine.squad.map((entry) => {
                const player = ctx.players.get(entry.playerId)
                return player ? (
                  <PlayerRow
                    key={entry.playerId}
                    player={player}
                    right={
                      <>
                        {mine.lineup?.includes(entry.playerId) && <Badge tone="good">XII</Badge>} {money(entry.price)}
                      </>
                    }
                  />
                ) : null
              })}
            </ul>
          </>
        )}
      </div>
    </main>
  )
}
