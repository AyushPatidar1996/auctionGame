import { useEffect, useState, useSyncExternalStore } from 'react'
import type { AuctionState } from '@auction/engine'
import type { LocalHost } from '../host/localHost'

/** Re-renders whenever the host's state changes. */
export function useHostState(host: LocalHost): AuctionState {
  return useSyncExternalStore(host.subscribe, host.getState)
}

/** A ticking wall-clock reading, for countdowns. Display only; the host owns real time. */
export function useNow(intervalMs = 100): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
