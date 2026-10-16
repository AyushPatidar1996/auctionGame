import { useState } from 'react'
import { rules } from '../data'
import { money } from '../lib/format'

export interface SetupChoice {
  readonly teamName: string
  readonly seed: number
}

export function Setup({ onStart }: { onStart: (choice: SetupChoice) => void }) {
  const [teamName, setTeamName] = useState('My Team')
  const [seedText, setSeedText] = useState('')

  const start = () => {
    const typed = Number(seedText)
    const seed = seedText.trim() !== '' && Number.isFinite(typed) ? Math.floor(typed) : Math.floor(Math.random() * 1_000_000)
    onStart({ teamName: teamName.trim() || 'My Team', seed })
  }

  return (
    <main className="setup">
      <div className="card setup-card">
        <h1>Auction Room</h1>
        <p className="muted">
          Build a squad against {rules.teams - 1} computer teams. Bid on players, keep your purse healthy, then pick
          your playing {rules.lineup.size}.
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            start()
          }}
        >
          <label>
            Your team name
            <input value={teamName} maxLength={24} onChange={(e) => setTeamName(e.target.value)} />
          </label>
          <label>
            Game seed <span className="muted">(optional: the same seed replays the same auction)</span>
            <input
              inputMode="numeric"
              placeholder="random"
              value={seedText}
              onChange={(e) => setSeedText(e.target.value.replace(/[^0-9]/g, ''))}
            />
          </label>
          <button type="submit" className="btn primary big">
            Start auction
          </button>
        </form>

        <dl className="rules">
          <div>
            <dt>Teams</dt>
            <dd>{rules.teams}</dd>
          </div>
          <div>
            <dt>Purse each</dt>
            <dd>{money(rules.purse)}</dd>
          </div>
          <div>
            <dt>Squad</dt>
            <dd>
              {rules.squad.min}–{rules.squad.max}
            </dd>
          </div>
          <div>
            <dt>Overseas</dt>
            <dd>up to {rules.squad.maxOverseas}</dd>
          </div>
          <div>
            <dt>Players up for auction</dt>
            <dd>
              {rules.pool.composition.marquee + rules.pool.composition.A + rules.pool.composition.B + rules.pool.composition.C}
            </dd>
          </div>
          <div>
            <dt>Bid window</dt>
            <dd>{rules.timer.bidWindowMs / 1000}s</dd>
          </div>
        </dl>
      </div>
    </main>
  )
}
