import { useEffect, useMemo, useState } from 'react'
import { defaultTeams, viewFor, type TeamSetup } from '@auction/engine'
import { ctx, rules } from './data'
import { LocalHost } from './host/localHost'
import { LeftPanel } from './components/LeftPanel'
import { Results } from './components/Results'
import { RightPanel } from './components/RightPanel'
import { Setup, type SetupChoice } from './components/Setup'
import { useHostState } from './lib/hooks'
import { humanTeamId } from './lib/squad'

function teamsFor(name: string): TeamSetup[] {
  const cpu = defaultTeams(rules.teams - 1).map((team, i) => ({ ...team, id: `t${i + 2}` }))
  return [{ id: 't1', name, kind: 'human', profileId: null, participantId: 'me' }, ...cpu]
}

export default function App() {
  const [host, setHost] = useState<LocalHost | null>(null)

  // Stop the old game's timers when it is replaced or the page goes away.
  useEffect(() => {
    if (!host) return
    const stop = () => host.dispose()
    window.addEventListener('pagehide', stop)
    return () => window.removeEventListener('pagehide', stop)
  }, [host])

  const start = (choice: SetupChoice) =>
    setHost(new LocalHost({ ctx, rules, seed: choice.seed, teams: teamsFor(choice.teamName) }))

  const newGame = () => {
    host?.dispose()
    setHost(null)
  }

  return host ? <Room host={host} onNewGame={newGame} /> : <Setup onStart={start} />
}

function Room({ host, onNewGame }: { host: LocalHost; onNewGame: () => void }) {
  const raw = useHostState(host)
  const me = humanTeamId(raw)
  // The UI only ever reads the public view, exactly as an online client will.
  const state = useMemo(() => viewFor(raw, me), [raw, me])
  const [fast, setFast] = useState(false)

  if (state.phase === 'FINISHED') return <Results state={state} me={me} onNewGame={onNewGame} />

  const lotsDone = Math.max(0, state.lotIndex + (state.lot ? 0 : 1))

  return (
    <div className="room">
      <header className="topbar">
        <h1>Auction Room</h1>
        <span className="progress">
          {state.phase === 'SELECTING'
            ? 'Choose your playing XII'
            : `${lotsDone} of ${state.lots.length} lots done`}
        </span>
        <div className="topbar-actions">
          <label className="speed">
            <input
              type="checkbox"
              checked={fast}
              onChange={(event) => {
                setFast(event.target.checked)
                host.setSpeed(event.target.checked ? 4 : 1)
              }}
            />
            Fast CPUs
          </label>
          <button type="button" className="btn" onClick={onNewGame}>
            New game
          </button>
        </div>
      </header>
      <div className="room-grid">
        <LeftPanel host={host} state={state} me={me} />
        <RightPanel host={host} state={state} me={me} />
      </div>
    </div>
  )
}
