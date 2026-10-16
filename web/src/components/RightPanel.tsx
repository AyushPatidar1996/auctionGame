import { useEffect, useState } from 'react'
import {
  chooseLineup,
  isOverseas,
  lineupError,
  requiredLineupSize,
  type AuctionState,
  type TeamId,
} from '@auction/engine'
import { ctx, rules } from '../data'
import type { LocalHost } from '../host/localHost'
import { REASON_TEXT, TIER_LABEL, money } from '../lib/format'
import { playersOf, summarise } from '../lib/squad'
import { Badge, PlayerRow, Tabs, TeamBadge } from './ui'

interface Props {
  host: LocalHost
  state: AuctionState
  me: TeamId
}

type MainTab = 'teams' | 'players' | 'chat' | 'lineup'

/** The tabbed right half: opposition teams, the player pool, chat, and (late) my lineup. */
export function RightPanel({ host, state, me }: Props) {
  const selecting = state.phase === 'SELECTING'
  const [tab, setTab] = useState<MainTab>('teams')

  // When selection starts, take the user straight to the lineup picker.
  useEffect(() => {
    if (selecting) setTab('lineup')
  }, [selecting])

  const tabs: { id: MainTab; label: string; badge?: string }[] = [
    { id: 'teams', label: 'Teams' },
    { id: 'players', label: 'Players' },
    { id: 'chat', label: 'Chat' },
  ]
  if (selecting) tabs.push({ id: 'lineup', label: 'Lineup', badge: '!' })

  return (
    <section className="card right" aria-label="The room">
      <Tabs label="Room" value={tab} onChange={setTab} tabs={tabs} />
      <div className="tab-body">
        {tab === 'teams' && <TeamsTab state={state} me={me} />}
        {tab === 'players' && <PlayersTab state={state} />}
        {tab === 'chat' && <ChatTab state={state} />}
        {tab === 'lineup' && selecting && <LineupTab host={host} state={state} me={me} />}
      </div>
    </section>
  )
}

// ───── Teams: one sub-tab per team ─────

function TeamsTab({ state, me }: { state: AuctionState; me: TeamId }) {
  const [selected, setSelected] = useState<TeamId>(me)
  const team = state.teams[selected] ?? state.teams[me]
  if (!team) return null
  const s = summarise(team, rules)
  const lineupIds = team.lineup

  return (
    <>
      <div role="tablist" aria-label="Teams" className="team-chips">
        {state.teamOrder.map((id) => {
          const t = state.teams[id]
          if (!t) return null
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={id === team.id}
              aria-label={t.name}
              title={t.name}
              className={id === team.id ? 'chip active' : 'chip'}
              onClick={() => setSelected(id)}
            >
              <TeamBadge name={t.name} you={id === me} size="sm" />
              <span className="chip-label">{state.teams[id]?.squad.length}</span>
            </button>
          )
        })}
      </div>

      <header className="team-head">
        <TeamBadge name={team.name} you={team.id === me} />
        <div>
          <h3>
            {team.name} {team.id === me && <Badge tone="good">You</Badge>}
          </h3>
          <span className="muted small">
            {s.size} players · {s.overseas} overseas · spent {money(s.spent)}
          </span>
        </div>
        <div className="purse">
          <span className="muted small">Purse</span>
          <strong>{money(team.purse)}</strong>
        </div>
      </header>

      {team.squad.length === 0 ? (
        <p className="empty">No players yet.</p>
      ) : (
        <ul className="roster">
          {team.squad.map((entry) => {
            const player = ctx.players.get(entry.playerId)
            if (!player) return null
            const inXii = lineupIds?.includes(entry.playerId)
            return (
              <PlayerRow
                key={entry.playerId}
                player={player}
                sub={`Lot ${entry.lotIndex + 1}`}
                right={
                  <>
                    {inXii && <Badge tone="good">XII</Badge>} {money(entry.price)}
                  </>
                }
              />
            )
          })}
        </ul>
      )}
    </>
  )
}

// ───── Players: sold / unsold / upcoming ─────

type PlayersSub = 'sold' | 'unsold' | 'upcoming'

function PlayersTab({ state }: { state: AuctionState }) {
  const [sub, setSub] = useState<PlayersSub>('upcoming')
  const sold = state.history.flatMap((r) => (r.outcome === 'sold' ? [r] : [])).reverse()
  const unsold = [...state.unsold].reverse()
  const upcoming = state.lots.slice(state.lotIndex + 1)

  return (
    <>
      <Tabs
        small
        label="Players"
        value={sub}
        onChange={setSub}
        tabs={[
          { id: 'upcoming', label: 'Upcoming', badge: upcoming.length },
          { id: 'sold', label: 'Sold', badge: sold.length },
          { id: 'unsold', label: 'Unsold', badge: unsold.length },
        ]}
      />
      <ul className="roster scroll">
        {sub === 'sold' &&
          (sold.length === 0 ? (
            <li className="empty">Nobody has been sold yet.</li>
          ) : (
            sold.map((r) => {
              const player = ctx.players.get(r.playerId)
              return player ? (
                <PlayerRow
                  key={r.playerId}
                  player={player}
                  sub={state.teams[r.teamId]?.name ?? r.teamId}
                  right={
                    <>
                      {r.assignedBy === 'forced' && <Badge tone="warn">Assigned</Badge>} {money(r.price)}
                    </>
                  }
                />
              ) : null
            })
          ))}
        {sub === 'unsold' &&
          (unsold.length === 0 ? (
            <li className="empty">No unsold players.</li>
          ) : (
            unsold.map((id) => {
              const player = ctx.players.get(id)
              return player ? (
                <PlayerRow key={id} player={player} right={`Base ${money(rules.tierBasePrice[player.auctionTier])}`} />
              ) : null
            })
          ))}
        {sub === 'upcoming' &&
          (upcoming.length === 0 ? (
            <li className="empty">No more lots.</li>
          ) : (
            upcoming.slice(0, 80).map((id) => {
              const player = ctx.players.get(id)
              return player ? (
                <PlayerRow
                  key={id}
                  player={player}
                  sub={TIER_LABEL[player.auctionTier]}
                  right={`Base ${money(rules.tierBasePrice[player.auctionTier])}`}
                />
              ) : null
            })
          ))}
        {sub === 'upcoming' && upcoming.length > 80 && (
          <li className="empty">…and {upcoming.length - 80} more.</li>
        )}
      </ul>
    </>
  )
}

// ───── Chat: sold announcements (player chat arrives with online rooms, M4) ─────

function ChatTab({ state }: { state: AuctionState }) {
  const feed = [...state.history].reverse()
  return (
    <>
      <ul className="feed scroll" aria-live="polite">
        {feed.length === 0 && <li className="empty">Announcements appear here as lots close.</li>}
        {feed.map((r) => {
          const player = ctx.players.get(r.playerId)
          const name = player?.displayName ?? r.playerId
          if (r.outcome === 'unsold') {
            return (
              <li key={r.playerId} className="feed-item unsold">
                <strong>{name}</strong> went unsold.
              </li>
            )
          }
          return (
            <li key={r.playerId} className="feed-item">
              <strong>{name}</strong> {r.assignedBy === 'forced' ? 'was assigned to' : 'sold to'}{' '}
              <strong>{state.teams[r.teamId]?.name ?? r.teamId}</strong> for {money(r.price)}.
            </li>
          )
        })}
      </ul>
      <form className="chat-form" onSubmit={(event) => event.preventDefault()}>
        <input type="text" disabled placeholder="Chatting opens with online rooms" aria-label="Chat message" />
        <button type="submit" className="btn" disabled>
          Send
        </button>
      </form>
    </>
  )
}

// ───── Lineup: pick the playing XII ─────

function LineupTab({ host, state, me }: Props) {
  const team = state.teams[me]
  const [picked, setPicked] = useState<readonly string[]>(team?.lineup ?? [])
  if (!team) return null

  const size = requiredLineupSize(rules, ctx, team)
  const players = playersOf(team)
  const chosen = picked.flatMap((id) => {
    const player = ctx.players.get(id)
    return player ? [player] : []
  })
  const away = chosen.filter((p) => isOverseas(p, rules)).length
  const keepers = chosen.filter((p) => p.isKeeper).length
  const bowlers = chosen.filter((p) => p.bowlType !== null).length
  const error = lineupError(state, ctx, me, picked)
  const submitted = team.lineup !== null
  const waiting = state.teamOrder.filter((id) => state.teams[id]?.lineup === null).length

  const toggle = (id: string) =>
    setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))

  return (
    <>
      <p className="muted">
        Choose your playing {size}
        {size < rules.lineup.size && ` (your squad can field at most ${size})`}. At most {rules.lineup.maxOverseas}{' '}
        overseas players.
      </p>

      <div className="lineup-status" aria-live="polite">
        <Badge tone={picked.length === size ? 'good' : 'warn'}>
          {picked.length}/{size} picked
        </Badge>
        <Badge tone={away <= rules.lineup.maxOverseas ? 'good' : 'bad'}>
          {away}/{rules.lineup.maxOverseas} overseas
        </Badge>
        <Badge tone={keepers > 0 ? 'good' : 'warn'}>{keepers > 0 ? 'Keeper picked' : 'No keeper yet'}</Badge>
        <Badge tone={bowlers >= 5 ? 'good' : 'warn'}>{bowlers} bowling options</Badge>
      </div>

      <div className="actions">
        <button type="button" className="btn" onClick={() => setPicked(chooseLineup(ctx, state, me))}>
          Auto-pick
        </button>
        <button type="button" className="btn" onClick={() => setPicked([])}>
          Clear
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={error !== null}
          onClick={() => host.dispatch({ type: 'SUBMIT_LINEUP', at: host.now(), teamId: me, playerIds: picked })}
        >
          {submitted ? 'Update lineup' : 'Submit lineup'}
        </button>
      </div>
      <p className="muted small reason" aria-live="polite">
        {error && picked.length > 0 ? REASON_TEXT[error] : ''}
        {submitted && ` Submitted. Waiting for ${waiting} other ${waiting === 1 ? 'team' : 'teams'}.`}
      </p>

      <ul className="roster scroll">
        {players.map((player) => (
          <PlayerRow
            key={player.id}
            player={player}
            left={
              <input
                type="checkbox"
                aria-label={`Pick ${player.displayName}`}
                checked={picked.includes(player.id)}
                onChange={() => toggle(player.id)}
              />
            }
            sub={`Bat ${player.batScore} · Bowl ${player.bowlScore} · Field ${player.fieldScore}`}
          />
        ))}
      </ul>
    </>
  )
}
