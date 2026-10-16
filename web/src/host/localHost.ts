// The offline host (PROJECT.md 3.2a): owns the clock, the timers and the CPU teams, and
// exposes the same small interface an online host will: dispatch / subscribe / now.
// The engine stays pure; everything impure (Date.now, setTimeout) lives here.
import {
  createGame,
  createRng,
  decide,
  deriveSeed,
  lineupAction,
  randomProfiles,
  reduce,
  viewFor,
  type Action,
  type AuctionState,
  type CpuProfile,
  type Ctx,
  type ReduceResult,
  type Rng,
  type RuleSet,
  type TeamId,
  type TeamSetup,
} from '@auction/engine'

export interface HostOptions {
  readonly ctx: Ctx
  readonly rules: RuleSet
  readonly seed: number
  /** The human team comes first (kind "human"); the rest are CPU teams. */
  readonly teams: readonly TeamSetup[]
  readonly speed?: number
}

const THINK_MIN_MS = 500
const THINK_SPREAD_MS = 3500
const FIRST_LOT_MS = 1500
const BANNER_MS = 2800
const CPU_LINEUP_MS = 900

export class LocalHost {
  private state: AuctionState
  private readonly ctx: Ctx
  private readonly listeners = new Set<() => void>()
  private readonly profiles = new Map<TeamId, CpuProfile>()
  private readonly nextAt = new Map<TeamId, number>()
  private readonly rng: Rng
  private timer: ReturnType<typeof setTimeout> | null = null
  private speed: number
  private disposed = false

  constructor(options: HostOptions) {
    this.ctx = options.ctx
    this.speed = options.speed ?? 1
    this.rng = createRng(deriveSeed(options.seed, 'host'))
    const cpuTeams = options.teams.filter((team) => team.kind === 'cpu')
    const profiles = randomProfiles(options.seed, cpuTeams.length)
    cpuTeams.forEach((team, i) => this.profiles.set(team.id, profiles[i] as CpuProfile))

    const created = Date.now()
    this.state = createGame({
      gameId: `local-${created}`,
      mode: 'offline',
      createdAt: created,
      hostId: options.teams.find((team) => team.kind === 'human')?.participantId ?? null,
      datasetVersion: options.ctx.datasetVersion,
      rules: options.rules,
    })
    this.dispatch({ type: 'START', at: this.now(), seed: options.seed, teams: options.teams })
  }

  // ───── the host interface ─────

  getState = (): AuctionState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Never earlier than the last accepted action, even if the system clock steps back. */
  now(): number {
    return Math.max(Date.now(), this.state.lastActionAt)
  }

  dispatch(action: Action): ReduceResult {
    if (this.disposed) return { state: this.state, error: null }
    const before = this.state
    const result = reduce(this.ctx, before, action)
    if (result.state !== before) {
      this.state = result.state
      this.afterChange(before, action)
      for (const listener of this.listeners) listener()
    }
    return result
  }

  // ───── extras the UI uses ─────

  setSpeed(speed: number): void {
    this.speed = speed
  }

  getSpeed(): number {
    return this.speed
  }

  dispose(): void {
    this.disposed = true
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.listeners.clear()
  }

  // ───── driving the CPU teams ─────

  private think(): number {
    return (THINK_MIN_MS + Math.floor(this.rng() * THINK_SPREAD_MS)) / this.speed
  }

  private afterChange(before: AuctionState, action: Action): void {
    const state = this.state
    if (state.phase === 'LOT_OPEN' && state.lot) {
      const opened = before.phase !== 'LOT_OPEN' || before.lotIndex !== state.lotIndex
      if (opened || action.type === 'BID') this.resetThinking(state)
      else if (action.type === 'PASS') this.nextAt.set(action.teamId, Infinity)
    }
    this.reschedule()
  }

  /** Every CPU team still in the lot starts a fresh think; leaders and passers wait. */
  private resetThinking(state: AuctionState): void {
    const lot = state.lot
    if (!lot) return
    const now = Date.now()
    for (const id of this.profiles.keys()) {
      const out = lot.passed.includes(id) || lot.highBid?.teamId === id
      this.nextAt.set(id, out ? Infinity : now + this.think())
    }
  }

  private reschedule(): void {
    if (this.disposed) return
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    const state = this.state
    let dueAt: number | null = null

    if (state.phase === 'LOT_OPEN' && state.lot) {
      dueAt = Math.min(state.lot.deadline, ...this.nextAt.values())
    } else if (state.phase === 'BETWEEN_LOTS') {
      const pause = state.lotIndex < 0 ? FIRST_LOT_MS : BANNER_MS
      dueAt = state.lastActionAt + pause / this.speed
    } else if (state.phase === 'SELECTING') {
      dueAt = Date.now() + CPU_LINEUP_MS / this.speed
    }
    if (dueAt === null || !Number.isFinite(dueAt)) return
    this.timer = setTimeout(() => this.fire(), Math.max(0, dueAt - Date.now()))
  }

  private fire(): void {
    this.timer = null
    if (this.disposed) return
    const state = this.state
    const now = this.now()

    if (state.phase === 'BETWEEN_LOTS') {
      this.dispatch({ type: 'NEXT_LOT', at: now })
    } else if (state.phase === 'SELECTING') {
      for (const id of this.profiles.keys()) {
        const action = lineupAction(this.ctx, viewFor(this.state, id), id, this.now())
        if (action) this.dispatch(action)
      }
    } else if (state.phase === 'LOT_OPEN' && state.lot) {
      if (now >= state.lot.deadline) {
        this.dispatch({ type: 'TICK', at: now })
      } else {
        this.runDueCpu(now)
      }
    }
    if (this.timer === null) this.reschedule()
  }

  /** Lets the CPU team whose think time is up (the earliest one) make its decision. */
  private runDueCpu(now: number): void {
    let actor: TeamId | undefined
    let earliest = Infinity
    for (const [id, at] of this.nextAt) {
      if (at <= now && at < earliest) {
        actor = id
        earliest = at
      }
    }
    if (actor === undefined) return
    const profile = this.profiles.get(actor)
    if (!profile) return
    const action = decide(this.ctx, viewFor(this.state, actor), actor, profile, this.rng, now)
    if (action) {
      this.dispatch(action)
      if (action.type === 'PASS') this.nextAt.set(actor, Infinity)
    } else {
      this.nextAt.set(actor, now + this.think())
    }
  }
}
