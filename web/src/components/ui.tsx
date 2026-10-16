import type { ReactNode } from 'react'
import { isOverseas, type Player } from '@auction/engine'
import { rules } from '../data'
import { BAT_LABEL, BOWL_LABEL, PHASE_LABEL, TIER_LABEL, TYPE_LABEL, TYPE_SHORT, initials } from '../lib/format'

export function Tabs<T extends string>(props: {
  label: string
  value: T
  onChange: (id: T) => void
  tabs: readonly { id: T; label: string; badge?: string | number }[]
  small?: boolean
}) {
  return (
    <div role="tablist" aria-label={props.label} className={props.small ? 'tabs tabs-small' : 'tabs'}>
      {props.tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          aria-selected={tab.id === props.value}
          className={tab.id === props.value ? 'tab active' : 'tab'}
          onClick={() => props.onChange(tab.id)}
        >
          {tab.label}
          {tab.badge !== undefined && <span className="tab-badge">{tab.badge}</span>}
        </button>
      ))}
    </div>
  )
}

export function Bar(props: { label: string; value: number; tone?: 'bat' | 'bowl' | 'field' | 'brand' }) {
  return (
    <div className="bar" title={`${props.label}: ${props.value}`}>
      <span className="bar-label">{props.label}</span>
      <span className="bar-track">
        <span className={`bar-fill ${props.tone ?? ''}`} style={{ width: `${Math.min(100, props.value)}%` }} />
      </span>
      <span className="bar-value">{props.value}</span>
    </div>
  )
}

export function Badge(props: { children: ReactNode; tone?: 'warn' | 'good' | 'bad' | 'info' }) {
  return <span className={`badge ${props.tone ?? ''}`}>{props.children}</span>
}

/** Round team badge: initials only for now (PROJECT.md 4a). */
export function TeamBadge(props: { name: string; you?: boolean; size?: 'sm' | 'md' }) {
  return (
    <span className={`team-badge ${props.size ?? 'md'} ${props.you ? 'you' : ''}`} aria-hidden="true">
      {initials(props.name)}
    </span>
  )
}

export function PlayerTags({ player }: { player: Player }) {
  return (
    <div className="tags">
      <Badge tone="info">{TYPE_LABEL[player.type]}</Badge>
      {player.isKeeper && <Badge tone="info">Wicketkeeper</Badge>}
      {player.batType && <Badge>{BAT_LABEL[player.batType]}</Badge>}
      {player.bowlType && (
        <Badge>
          {BOWL_LABEL[player.bowlType]}
          {player.bowlingArm ? ` (${player.bowlingArm === 'L' ? 'left' : 'right'}-arm)` : ''}
        </Badge>
      )}
      {player.bowlPhases.map((phase) => (
        <Badge key={phase}>{PHASE_LABEL[phase]}</Badge>
      ))}
    </div>
  )
}

/** One line for a player in a list: role chip, name, and something on the right. */
export function PlayerRow(props: { player: Player; right?: ReactNode; sub?: ReactNode; left?: ReactNode }) {
  const { player } = props
  return (
    <li className="player-row">
      {props.left}
      <span className={`role-chip ${player.type}`}>{TYPE_SHORT[player.type]}</span>
      <span className="player-main">
        <span className="player-name">
          {player.displayName}
          {player.isKeeper && <span className="wk"> WK</span>}
          {isOverseas(player, rules) && <span className="os" title={player.nationality}> ✈</span>}
        </span>
        {props.sub && <span className="player-sub">{props.sub}</span>}
      </span>
      {props.right && <span className="player-right">{props.right}</span>}
    </li>
  )
}

export function PlayerCard({ player, base }: { player: Player; base?: number }) {
  return (
    <div className="player-card">
      <div className="player-card-head">
        <div>
          <h2>{player.displayName}</h2>
          <p className="muted">
            {player.nationality}
            {isOverseas(player, rules) && ' · overseas'} · {TIER_LABEL[player.auctionTier]}
            {player.battingHand === 'L' ? ' · left-hand bat' : ' · right-hand bat'}
          </p>
        </div>
        {base !== undefined && (
          <div className="base-price">
            <span className="muted">Base</span>
            <strong>{base >= 100 ? `₹${(base / 100).toFixed(2)} Cr` : `₹${base} L`}</strong>
          </div>
        )}
      </div>
      <PlayerTags player={player} />
      <div className="bars">
        <Bar label="Batting" value={player.batScore} tone="bat" />
        <Bar label="Bowling" value={player.bowlScore} tone="bowl" />
        <Bar label="Fielding" value={player.fieldScore} tone="field" />
        <Bar label="Brand" value={player.brandAppeal} tone="brand" />
      </div>
    </div>
  )
}
