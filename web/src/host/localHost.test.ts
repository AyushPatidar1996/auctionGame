import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chooseLineup, defaultTeams, nextBid, type TeamSetup } from '@auction/engine'
import { ctx, rules } from '../data'
import { LocalHost } from './localHost'

const T0 = 1_800_000_000_000

function teams(): TeamSetup[] {
  const cpu = defaultTeams(rules.teams - 1).map((team, i) => ({ ...team, id: `t${i + 2}` }))
  return [{ id: 't1', name: 'Me', kind: 'human', profileId: null, participantId: 'me' }, ...cpu]
}

const makeHost = (seed = 1, speed = 1) => new LocalHost({ ctx, rules, seed, teams: teams(), speed })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('LocalHost', () => {
  it('starts the game as soon as it is created', () => {
    const host = makeHost()
    const state = host.getState()
    expect(state.phase).toBe('BETWEEN_LOTS')
    expect(state.teamOrder).toHaveLength(rules.teams)
    expect(state.revision).toBe(1)
    host.dispose()
  })

  it('opens the first lot by itself after a short pause', () => {
    const host = makeHost()
    vi.advanceTimersByTime(1000)
    expect(host.getState().phase).toBe('BETWEEN_LOTS')
    vi.advanceTimersByTime(1000)
    expect(host.getState().phase).toBe('LOT_OPEN')
    expect(host.getState().lotIndex).toBe(0)
    host.dispose()
  })

  it('lets the CPU teams bid on their own', () => {
    const host = makeHost()
    vi.advanceTimersByTime(9000)
    const lot = host.getState().lot
    expect(lot?.highBid).not.toBeNull()
    expect(lot?.highBid?.teamId).not.toBe('t1')
    host.dispose()
  })

  it('closes a lot when its timer runs out, then moves on to the next', () => {
    const host = makeHost()
    vi.advanceTimersByTime(60_000)
    const state = host.getState()
    expect(state.history.length).toBeGreaterThanOrEqual(1)
    expect(state.lotIndex).toBeGreaterThanOrEqual(1)
    host.dispose()
  })

  it('accepts a human bid through dispatch', () => {
    const host = makeHost()
    vi.advanceTimersByTime(2000)
    const state = host.getState()
    const amount = nextBid(state)
    expect(amount).not.toBeNull()
    const result = host.dispatch({ type: 'BID', at: host.now(), teamId: 't1', amount: amount ?? 0 })
    expect(result.error).toBeNull()
    expect(host.getState().lot?.highBid?.teamId).toBe('t1')
    host.dispose()
  })

  it('rejects an illegal human action with a reason and leaves the state alone', () => {
    const host = makeHost()
    const before = host.getState()
    const result = host.dispatch({ type: 'BID', at: host.now(), teamId: 't1', amount: 20 })
    expect(result.error).toBe('WRONG_PHASE')
    expect(host.getState()).toBe(before)
    host.dispose()
  })

  it('notifies subscribers on every change, and stops when they unsubscribe', () => {
    const host = makeHost()
    const listener = vi.fn()
    const unsubscribe = host.subscribe(listener)
    vi.advanceTimersByTime(2000)
    expect(listener).toHaveBeenCalled()
    unsubscribe()
    listener.mockClear()
    vi.advanceTimersByTime(20_000)
    expect(listener).not.toHaveBeenCalled()
    host.dispose()
  })

  it('never reports a time earlier than the last accepted action', () => {
    const host = makeHost()
    vi.advanceTimersByTime(5000)
    const last = host.getState().lastActionAt
    vi.setSystemTime(T0 - 60_000) // the system clock steps backwards
    expect(host.now()).toBeGreaterThanOrEqual(last)
    host.dispose()
  })

  it('stops completely when disposed', () => {
    const host = makeHost()
    vi.advanceTimersByTime(3000)
    host.dispose()
    const frozen = host.getState()
    vi.advanceTimersByTime(120_000)
    expect(host.getState()).toBe(frozen)
    expect(host.dispatch({ type: 'TICK', at: host.now() }).state).toBe(frozen)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('runs a whole auction to FINISHED once the human picks a lineup', () => {
    const host = makeHost(1, 4)
    let guard = 0
    while (host.getState().phase !== 'SELECTING') {
      vi.advanceTimersByTime(500)
      if (++guard > 20_000) throw new Error('auction never reached selection')
    }
    vi.advanceTimersByTime(3000) // the CPU teams submit their lineups
    const state = host.getState()
    expect(state.teamOrder.filter((id) => id !== 't1').every((id) => state.teams[id]?.lineup)).toBe(true)
    expect(state.phase).toBe('SELECTING') // still waiting for the human

    const result = host.dispatch({
      type: 'SUBMIT_LINEUP',
      at: host.now(),
      teamId: 't1',
      playerIds: chooseLineup(ctx, state, 't1'),
    })
    expect(result.error).toBeNull()
    expect(host.getState().phase).toBe('FINISHED')
    expect(host.getState().history).toHaveLength(state.lots.length)
    host.dispose()
  })
})
