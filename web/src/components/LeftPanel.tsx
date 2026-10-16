import {
  canBid,
  nextBid,
  passError,
  reserveRequired,
  squadPressure,
  type AuctionState,
  type RejectReason,
  type TeamId,
} from '@auction/engine'
import { ctx, rules } from '../data'
import type { LocalHost } from '../host/localHost'
import { REASON_TEXT, money } from '../lib/format'
import { useNow } from '../lib/hooks'
import { playersOf, summarise } from '../lib/squad'
import { Bar, Badge, PlayerCard, PlayerRow, TeamBadge } from './ui'

interface Props {
  host: LocalHost
  state: AuctionState
  me: TeamId
}

/** The static left half: the lot on the block, my team so far, and my team's stats. */
export function LeftPanel(props: Props) {
  return (
    <div className="left">
      <LotPanel {...props} />
      <MyTeam state={props.state} me={props.me} />
    </div>
  )
}

function LotPanel({ host, state, me }: Props) {
  const now = useNow(100)
  const lot = state.lot

  if (!lot) return <LotIdle state={state} />

  const player = ctx.players.get(lot.playerId)
  const amount = nextBid(state)
  const at = host.now()
  const bidReason = amount === null ? 'WRONG_PHASE' : canBid(state, ctx, me, amount, at)
  const passReason = passError(state, me, at)
  const pressure = squadPressure(state)
  const remaining = Math.max(0, lot.deadline - now)
  const share = Math.min(1, remaining / rules.timer.bidWindowMs)
  const leader = lot.highBid ? state.teams[lot.highBid.teamId] : undefined
  const iLead = lot.highBid?.teamId === me
  const hint = (reason: RejectReason | null) => (reason ? REASON_TEXT[reason] : undefined)
  // Why a button is disabled, in plain words (the bid reason wins over the pass reason).
  const message = hint(bidReason) ?? hint(passReason) ?? ''

  return (
    <section className="card lot" aria-label="Current lot">
      <div className="lot-top">
        <span className="muted">
          Lot {state.lotIndex + 1} of {state.lots.length}
        </span>
        {pressure.forced && <Badge tone="bad">Forced lot</Badge>}
      </div>

      {player && <PlayerCard player={player} base={lot.basePrice} />}

      {pressure.forced ? (
        <p className="notice bad" role="alert">
          Every remaining lot must go to a team still short of {rules.squad.min} players. Passing is switched
          off, and an unbid player is assigned to one of those teams at base price.
        </p>
      ) : (
        pressure.slack <= 3 && (
          <p className="notice warn">
            Only {pressure.slack} more {pressure.slack === 1 ? 'player' : 'players'} can go unsold before every
            remaining lot is forced.
          </p>
        )
      )}

      <div className="bid-box">
        <div className="current-bid">
          <span className="muted">{lot.highBid ? 'Current bid' : 'No bids yet'}</span>
          <strong className="bid-amount">{money(lot.highBid ? lot.highBid.amount : lot.basePrice)}</strong>
          <span className={iLead ? 'leader you' : 'leader'}>
            {leader ? (
              <>
                <TeamBadge name={leader.name} you={iLead} size="sm" /> {iLead ? 'You' : leader.name}
              </>
            ) : (
              'Opening at base price'
            )}
          </span>
        </div>
        <div className="timer" role="timer" aria-label="Time left to bid">
          <div className="timer-track">
            <div className={share < 0.3 ? 'timer-fill low' : 'timer-fill'} style={{ width: `${share * 100}%` }} />
          </div>
          <span className="timer-text">{(remaining / 1000).toFixed(1)}s</span>
        </div>
      </div>

      <div className="actions">
        <button
          type="button"
          className="btn primary"
          disabled={bidReason !== null || amount === null}
          onClick={() => amount !== null && host.dispatch({ type: 'BID', at: host.now(), teamId: me, amount })}
        >
          Bid {amount !== null ? money(amount) : ''}
        </button>
        <button
          type="button"
          className="btn"
          disabled={passReason !== null}
          onClick={() => host.dispatch({ type: 'PASS', at: host.now(), teamId: me })}
        >
          Pass
        </button>
      </div>
      <p className="muted small reason" aria-live="polite">
        {message}
      </p>
    </section>
  )
}

/** Between lots: the result banner for the lot that just closed. */
function LotIdle({ state }: { state: AuctionState }) {
  const last = state.history[state.history.length - 1]
  const player = last ? ctx.players.get(last.playerId) : undefined
  return (
    <section className="card lot idle" aria-label="Between lots" aria-live="polite">
      {last && player ? (
        <>
          <p className="muted">Last lot</p>
          <h2>{player.displayName}</h2>
          {last.outcome === 'sold' ? (
            <p className="result sold">
              {last.assignedBy === 'forced' ? 'Assigned' : 'Sold'} to{' '}
              <strong>{state.teams[last.teamId]?.name ?? last.teamId}</strong> for{' '}
              <strong>{money(last.price)}</strong>
              {last.assignedBy === 'forced' && ' (forced lot, base price)'}
            </p>
          ) : (
            <p className="result unsold">Unsold</p>
          )}
        </>
      ) : (
        <h2>The auction is about to begin…</h2>
      )}
      <p className="muted">
        {state.phase === 'SELECTING' || state.phase === 'FINISHED'
          ? 'All lots are done.'
          : 'The next lot opens in a moment.'}
      </p>
    </section>
  )
}

function MyTeam({ state, me }: { state: AuctionState; me: TeamId }) {
  const team = state.teams[me]
  if (!team) return null
  const s = summarise(team, rules)
  const needed = Math.max(0, rules.squad.min - s.size)
  const players = playersOf(team)

  return (
    <section className="card my-team" aria-label="My team">
      <header className="my-team-head">
        <TeamBadge name={team.name} you />
        <div>
          <h3>{team.name}</h3>
          <span className="muted small">Your team</span>
        </div>
        <div className="purse">
          <span className="muted small">Purse</span>
          <strong>{money(team.purse)}</strong>
        </div>
      </header>

      <dl className="stats">
        <div>
          <dt>Squad</dt>
          <dd>
            {s.size}
            <span className="muted"> / {rules.squad.min}–{rules.squad.max}</span>
          </dd>
        </div>
        <div>
          <dt>Overseas</dt>
          <dd>
            {s.overseas}
            <span className="muted"> / {rules.squad.maxOverseas}</span>
          </dd>
        </div>
        <div>
          <dt>Still needed</dt>
          <dd>{needed}</dd>
        </div>
        <div>
          <dt>Reserved</dt>
          <dd>{money(Math.min(team.purse, reserveRequired(rules, s.size)))}</dd>
        </div>
      </dl>

      <p className="muted small mix">
        {s.batters} batters · {s.bowlers} bowlers · {s.allRounders} all-rounders · {s.keepers} keepers
      </p>
      <div className="bars">
        <Bar label="Batting" value={s.batting} tone="bat" />
        <Bar label="Bowling" value={s.bowling} tone="bowl" />
        <Bar label="Fielding" value={s.fielding} tone="field" />
        <Bar label="Brand" value={s.brand} tone="brand" />
      </div>
      <p className="muted small">Provisional bars: average of your best players in each area.</p>

      {players.length === 0 ? (
        <p className="empty">No players yet. Win a lot to start your squad.</p>
      ) : (
        <ul className="roster">
          {team.squad.map((entry) => {
            const player = ctx.players.get(entry.playerId)
            return player ? (
              <PlayerRow key={entry.playerId} player={player} right={money(entry.price)} />
            ) : null
          })}
        </ul>
      )}
    </section>
  )
}
